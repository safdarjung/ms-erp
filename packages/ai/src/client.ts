import Anthropic from '@anthropic-ai/sdk';

/**
 * Provider selection. Keys are read from the environment server-side only —
 * they never reach the browser. With no key at all, AI features are disabled
 * and the rest of the ERP works untouched (docs/05 "graceful degradation").
 *
 * - `ANTHROPIC_API_KEY` → Claude (the blueprint's provider)
 * - `GEMINI_API_KEY`    → Google Gemini (AI Studio)
 * - both set            → Claude wins unless `AI_PROVIDER=gemini`
 */
export type AiProvider = 'claude' | 'gemini';

export function activeProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === 'claude') return process.env.ANTHROPIC_API_KEY ? 'claude' : null;
  if (forced === 'gemini') return process.env.GEMINI_API_KEY ? 'gemini' : null;
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export function aiEnabled(): boolean {
  return activeProvider() !== null;
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI features are disabled — set ANTHROPIC_API_KEY or GEMINI_API_KEY to enable them.');
    this.name = 'AiDisabledError';
  }
}

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiDisabledError();
  _client ??= new Anthropic({ maxRetries: 2 });
  return _client;
}
