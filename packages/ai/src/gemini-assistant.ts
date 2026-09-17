import { Type, type Content, type FunctionDeclaration, type Part, type Schema } from '@google/genai';
import {
  MAX_TOOL_ROUNDS, STUCK_MESSAGE, TOOL_META, dispatchTool, isTransientError, sleep,
  type AssistantContext, type AssistantEvent, type ChatTurn, type TurnState,
} from './assistant-core';
import { ACTION_TOOLS, GET_DOCUMENT_TOOL, INSTANT_TOOLS, OPEN_PAGE_TOOL, type ActionToolDef, type JsonSchemaProp } from './agent-tools';
import { GEMINI_MODELS, addTokenUsage, gemini, isGeminiRateLimit, usageFromGemini } from './gemini';
import { emptyUsage } from './models';
import { ASSISTANT_SYSTEM_PROMPT } from './schema-context';

// Translate the registry's plain JSON-Schema subset into Gemini's dialect.
const GEMINI_TYPE: Record<JsonSchemaProp['type'], Type> = {
  string: Type.STRING, number: Type.NUMBER, integer: Type.INTEGER,
  boolean: Type.BOOLEAN, array: Type.ARRAY, object: Type.OBJECT,
};

function toGeminiSchema(p: JsonSchemaProp): Schema {
  const s: Schema = { type: GEMINI_TYPE[p.type] };
  if (p.description) s.description = p.description;
  if (p.enum) s.enum = p.enum;
  if (p.items) s.items = toGeminiSchema(p.items);
  if (p.properties) {
    s.properties = Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (p.required?.length) s.required = p.required;
  return s;
}

const toGeminiFunction = (t: ActionToolDef): FunctionDeclaration => ({
  name: t.name,
  description: t.description,
  parameters: toGeminiSchema({ type: 'object', properties: t.properties, required: t.required }),
});

const FUNCTIONS: FunctionDeclaration[] = [
  {
    name: TOOL_META.query.name,
    description: TOOL_META.query.description,
    parameters: {
      type: Type.OBJECT,
      properties: {
        sql: { type: Type.STRING, description: TOOL_META.query.sqlDesc },
        title: { type: Type.STRING, description: TOOL_META.query.titleDesc },
      },
      required: ['sql', 'title'],
    },
  },
  {
    name: TOOL_META.chart.name,
    description: TOOL_META.chart.description,
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        kind: { type: Type.STRING, enum: ['bar'] },
        labels: { type: Type.ARRAY, items: { type: Type.STRING } },
        values: { type: Type.ARRAY, items: { type: Type.NUMBER } },
      },
      required: ['title', 'kind', 'labels', 'values'],
    },
  },
  toGeminiFunction(GET_DOCUMENT_TOOL),
  ...INSTANT_TOOLS.map(toGeminiFunction),
  toGeminiFunction(OPEN_PAGE_TOOL),
  ...ACTION_TOOLS.map(toGeminiFunction),
];

const RETRY_DELAY_MS = 900;

/** The ask-your-data agent loop on Gemini — same event protocol as the Claude loop. */
export async function* runGeminiAssistant(
  history: ChatTurn[],
  ctx: AssistantContext,
): AsyncGenerator<AssistantEvent> {
  const ai = gemini();
  const usage = emptyUsage();

  const contents: Content[] = history.map((t) => {
    const role = t.role === 'assistant' ? 'model' : 'user';
    // Attach images/PDFs inline on the user turn that carries them so the
    // model can read them (extraction); text-only turns stay as before.
    if (t.role === 'user' && t.attachments?.length) {
      const parts: Part[] = [];
      if (t.content.trim()) parts.push({ text: t.content });
      for (const a of t.attachments) parts.push({ inlineData: { mimeType: a.mimeType, data: a.data } });
      return { role, parts };
    }
    return { role, parts: [{ text: t.content }] };
  });

  const config = {
    systemInstruction:
      `${ASSISTANT_SYSTEM_PROMPT}\n\nToday is ${ctx.today}. Business: ${ctx.tenantName}. You are talking to ${ctx.userName}. ` +
      `Their permissions: ${[...ctx.permissions].sort().join(', ') || '(none)'}.` +
      (ctx.pageContext ? `\nCurrent page: ${ctx.pageContext}` : ''),
    tools: [{ functionDeclarations: FUNCTIONS }],
    abortSignal: ctx.signal,
  };

  // Sticks to the fallback model for the rest of the conversation once the
  // primary rate-limits (user preference: 3.5-flash-lite → 3.1-flash-lite).
  let model: string = GEMINI_MODELS.primary;
  const state: TurnState = { chartShown: false, actionPending: false };
  let spoke = false;
  let exhausted = true;

  /** Open the stream: one quiet retry on a transient blip, fallback model on 429. */
  const openStream = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ai.models.generateContentStream({ model, contents, config });
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        if (isGeminiRateLimit(e) && model === GEMINI_MODELS.primary) { model = GEMINI_MODELS.fallback; continue; }
        if (attempt === 0 && isTransientError(e)) { await sleep(RETRY_DELAY_MS); continue; }
        throw e;
      }
    }
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = await openStream();

    // Echo the model turn back EXACTLY as streamed — Gemini 3.x attaches a
    // thoughtSignature to functionCall parts and rejects follow-up requests
    // that drop it, so parts must be preserved verbatim (no reconstruction).
    const modelParts: Part[] = [];
    const calls: { id?: string; name?: string; args?: Record<string, unknown> }[] = [];
    let roundUsage = emptyUsage();

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.text && !part.thought) { spoke = true; yield { type: 'text', delta: part.text }; }
        if (part.functionCall) {
          calls.push({
            id: part.functionCall.id,
            name: part.functionCall.name,
            args: part.functionCall.args as Record<string, unknown> | undefined,
          });
        }
      }
      if (chunk.usageMetadata) roundUsage = usageFromGemini(chunk.usageMetadata);
    }
    addTokenUsage(usage, roundUsage);

    if (!calls.length) { exhausted = false; break; }

    contents.push({ role: 'model', parts: modelParts });

    const responseParts: Part[] = [];
    for (const c of calls) {
      const out = await dispatchTool(c.name, (c.args ?? {}) as Record<string, unknown>, ctx, state);
      for (const ev of out.events) yield ev;
      responseParts.push({
        functionResponse: { name: c.name ?? 'unknown', response: out.payload, ...(c.id ? { id: c.id } : {}) },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  if (exhausted && !spoke) yield { type: 'text', delta: STUCK_MESSAGE };
  yield { type: 'done', usage, model };
}
