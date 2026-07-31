import type Anthropic from '@anthropic-ai/sdk';
import { activeProvider, anthropic } from './client';
import { AI_MODELS, addUsage, emptyUsage } from './models';
import { ASSISTANT_SYSTEM_PROMPT } from './schema-context';
import { ACTION_TOOLS, ACTION_TOOL_NAMES, OPEN_PAGE_TOOL, type ActionToolDef } from './agent-tools';
import {
  MAX_TOOL_ROUNDS, TOOL_META, runActionTool, runChartTool, runOpenPageTool, runQueryTool,
  type AssistantContext, type AssistantEvent, type ChartSpec, type ChatTurn, type TurnState,
} from './assistant-core';
import { runGeminiAssistant } from './gemini-assistant';

export type {
  AssistantContext, AssistantEvent, ChartSpec, ChatTurn, QueryResult, StagedAction, StageResult,
} from './assistant-core';

// Action/nav tools keep optional fields optional, so no strict mode — the
// server re-validates with zod before staging anyway.
const toAnthropicTool = (t: ActionToolDef): Anthropic.Messages.Tool => ({
  name: t.name,
  description: t.description,
  input_schema: { type: 'object', properties: t.properties, required: t.required },
});

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: TOOL_META.query.name,
    description: TOOL_META.query.description,
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: TOOL_META.query.sqlDesc },
        title: { type: 'string', description: TOOL_META.query.titleDesc },
      },
      required: ['sql', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_META.chart.name,
    description: TOOL_META.chart.description,
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: ['bar'] },
        labels: { type: 'array', items: { type: 'string' } },
        values: { type: 'array', items: { type: 'number' } },
      },
      required: ['title', 'kind', 'labels', 'values'],
      additionalProperties: false,
    },
  },
  toAnthropicTool(OPEN_PAGE_TOOL),
  ...ACTION_TOOLS.map(toAnthropicTool),
];

/**
 * The ask-your-data agent (docs/05 §2): stream the answer, executing guarded
 * analytics queries and chart presentations as requested. Dispatches to the
 * active provider (Claude per the blueprint, or Gemini when configured).
 */
export async function* runAssistant(
  history: ChatTurn[],
  ctx: AssistantContext,
): AsyncGenerator<AssistantEvent> {
  if (activeProvider() === 'gemini') {
    yield* runGeminiAssistant(history, ctx);
    return;
  }
  yield* runClaudeAssistant(history, ctx);
}

async function* runClaudeAssistant(
  history: ChatTurn[],
  ctx: AssistantContext,
): AsyncGenerator<AssistantEvent> {
  const client = anthropic();
  const usage = emptyUsage();

  const system: Anthropic.Messages.TextBlockParam[] = [
    // Stable block first — cacheable prefix (docs/05 §1 prompt caching).
    { type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: `Today is ${ctx.today}. Business: ${ctx.tenantName}. You are talking to ${ctx.userName}. ` +
        `Their permissions: ${[...ctx.permissions].sort().join(', ') || '(none)'}.`,
    },
  ];

  const messages: Anthropic.Messages.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const state: TurnState = { chartShown: false, actionPending: false };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream(
      {
        model: AI_MODELS.chat,
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        system,
        tools: TOOLS,
        messages,
      },
      { signal: ctx.signal },
    );

    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        yield { type: 'text', delta: ev.delta.text };
      }
    }

    const msg = await stream.finalMessage();
    addUsage(usage, msg.usage);

    if (msg.stop_reason !== 'tool_use') break;

    const toolUses = msg.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      let payload: Record<string, unknown>;
      let isError: boolean;
      if (tu.name === TOOL_META.query.name) {
        const out = await runQueryTool(tu.input as { sql?: string; title?: string }, ctx.executeQuery);
        for (const ev of out.events) yield ev;
        payload = out.payload;
        isError = out.isError;
      } else if (tu.name === TOOL_META.chart.name) {
        const out = runChartTool(tu.input as Partial<ChartSpec>, state.chartShown);
        state.chartShown = out.chartShown;
        for (const ev of out.events) yield ev;
        payload = out.payload;
        isError = out.isError;
      } else if (tu.name === OPEN_PAGE_TOOL.name) {
        const out = runOpenPageTool(tu.input as { page?: string; id?: string });
        for (const ev of out.events) yield ev;
        payload = out.payload;
        isError = out.isError;
      } else if (ACTION_TOOL_NAMES.has(tu.name)) {
        const out = await runActionTool(tu.name, tu.input as Record<string, unknown>, ctx, state);
        for (const ev of out.events) yield ev;
        payload = out.payload;
        isError = out.isError;
      } else {
        payload = { error: 'Unknown tool.' };
        isError = true;
      }
      results.push({
        type: 'tool_result', tool_use_id: tu.id, is_error: isError,
        content: JSON.stringify(payload),
      });
    }

    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: results });
  }

  yield { type: 'done', usage, model: AI_MODELS.chat };
}
