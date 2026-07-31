import { Type, type Content, type FunctionDeclaration, type Part, type Schema } from '@google/genai';
import {
  MAX_TOOL_ROUNDS, TOOL_META, runActionTool, runChartTool, runOpenPageTool, runQueryTool,
  type AssistantContext, type AssistantEvent, type ChartSpec, type ChatTurn, type TurnState,
} from './assistant-core';
import { ACTION_TOOLS, ACTION_TOOL_NAMES, OPEN_PAGE_TOOL, type ActionToolDef, type JsonSchemaProp } from './agent-tools';
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
  toGeminiFunction(OPEN_PAGE_TOOL),
  ...ACTION_TOOLS.map(toGeminiFunction),
];

/** The ask-your-data agent loop on Gemini — same event protocol as the Claude loop. */
export async function* runGeminiAssistant(
  history: ChatTurn[],
  ctx: AssistantContext,
): AsyncGenerator<AssistantEvent> {
  const ai = gemini();
  const usage = emptyUsage();

  const contents: Content[] = history.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content }],
  }));

  const config = {
    systemInstruction:
      `${ASSISTANT_SYSTEM_PROMPT}\n\nToday is ${ctx.today}. Business: ${ctx.tenantName}. You are talking to ${ctx.userName}. ` +
      `Their permissions: ${[...ctx.permissions].sort().join(', ') || '(none)'}.`,
    tools: [{ functionDeclarations: FUNCTIONS }],
    abortSignal: ctx.signal,
  };

  // Sticks to the fallback model for the rest of the conversation once the
  // primary rate-limits (user preference: 3.5-flash-lite → 3.1-flash-lite).
  let model: string = GEMINI_MODELS.primary;
  const state: TurnState = { chartShown: false, actionPending: false };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let stream;
    try {
      stream = await ai.models.generateContentStream({ model, contents, config });
    } catch (e) {
      if (isGeminiRateLimit(e) && model === GEMINI_MODELS.primary) {
        model = GEMINI_MODELS.fallback;
        stream = await ai.models.generateContentStream({ model, contents, config });
      } else throw e;
    }

    // Echo the model turn back EXACTLY as streamed — Gemini 3.x attaches a
    // thoughtSignature to functionCall parts and rejects follow-up requests
    // that drop it, so parts must be preserved verbatim (no reconstruction).
    const modelParts: Part[] = [];
    const calls: { id?: string; name?: string; args?: Record<string, unknown> }[] = [];
    let roundUsage = emptyUsage();

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.text && !part.thought) yield { type: 'text', delta: part.text };
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

    if (!calls.length) break;

    contents.push({ role: 'model', parts: modelParts });

    const responseParts: Part[] = [];
    for (const c of calls) {
      let payload: Record<string, unknown>;
      if (c.name === TOOL_META.query.name) {
        const out = await runQueryTool(c.args as { sql?: string; title?: string }, ctx.executeQuery);
        for (const ev of out.events) yield ev;
        payload = out.payload;
      } else if (c.name === TOOL_META.chart.name) {
        const out = runChartTool(c.args as Partial<ChartSpec>, state.chartShown);
        state.chartShown = out.chartShown;
        for (const ev of out.events) yield ev;
        payload = out.payload;
      } else if (c.name === OPEN_PAGE_TOOL.name) {
        const out = runOpenPageTool((c.args ?? {}) as { page?: string; id?: string });
        for (const ev of out.events) yield ev;
        payload = out.payload;
      } else if (c.name && ACTION_TOOL_NAMES.has(c.name)) {
        const out = await runActionTool(c.name, (c.args ?? {}) as Record<string, unknown>, ctx, state);
        for (const ev of out.events) yield ev;
        payload = out.payload;
      } else {
        payload = { error: 'Unknown tool.' };
      }
      responseParts.push({
        functionResponse: { name: c.name ?? 'unknown', response: payload, ...(c.id ? { id: c.id } : {}) },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  yield { type: 'done', usage, model };
}
