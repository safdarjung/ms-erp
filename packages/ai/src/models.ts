// Model routing by task — pick the cheapest model that does the job well
// (docs/05 §6). IDs are pinned there; change them in one place.

export const AI_MODELS = {
  /** NL analytics chat: question → SQL → summary. Fast + cheap enough for interactive use. */
  chat: 'claude-sonnet-5',
  /** Smart quotation & pricing: high-value, reasoning-heavy, structured output. */
  pricing: 'claude-opus-4-8',
  /** Document prose drafting/polish (EN + Hindi). */
  prose: 'claude-sonnet-5',
  /** Classification / tagging / short tasks. */
  classify: 'claude-haiku-4-5',
} as const;

export type AiFeature = 'assistant' | 'quote_draft' | 'prose' | 'transcribe';

/** List prices in USD per 1M tokens (docs/05 §6). Cache read ≈0.1×, write ≈1.25× input. */
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Gemini via AI Studio free tier — tokens metered, no billing.
  'gemini-3.5-flash-lite': { input: 0, output: 0 },
  'gemini-3.1-flash-lite': { input: 0, output: 0 },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
});

export function addUsage(into: TokenUsage, u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): void {
  into.inputTokens += u.input_tokens ?? 0;
  into.outputTokens += u.output_tokens ?? 0;
  into.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  into.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
}

export function estimateCostUsd(model: string, u: TokenUsage): number {
  const r = RATES[model] ?? { input: 0, output: 0 };
  const perTok = 1 / 1_000_000;
  const cost =
    u.inputTokens * r.input * perTok +
    u.outputTokens * r.output * perTok +
    u.cacheReadTokens * r.input * 0.1 * perTok +
    u.cacheWriteTokens * r.input * 1.25 * perTok;
  return Math.round(cost * 1e6) / 1e6;
}
