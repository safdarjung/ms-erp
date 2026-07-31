import { GoogleGenAI, ApiError, type GenerateContentResponseUsageMetadata } from '@google/genai';
import { AiDisabledError } from './client';
import { emptyUsage, type TokenUsage } from './models';

// Google Gemini provider (AI Studio). Chosen models per user preference:
// primary 3.5 Flash-Lite, falling back to 3.1 Flash-Lite when rate-limited.
export const GEMINI_MODELS = {
  primary: 'gemini-3.5-flash-lite',
  fallback: 'gemini-3.1-flash-lite',
} as const;

let _client: GoogleGenAI | null = null;

export function geminiEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function gemini(): GoogleGenAI {
  if (!geminiEnabled()) throw new AiDisabledError();
  _client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

export function isGeminiRateLimit(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 429;
  return /RESOURCE_EXHAUSTED|\b429\b/.test(String((e as Error)?.message ?? e));
}

/** Run `fn` on the primary model; on a 429, retry once on the fallback model. */
export async function withGeminiFallback<T>(
  fn: (model: string) => Promise<T>,
): Promise<{ result: T; model: string }> {
  try {
    return { result: await fn(GEMINI_MODELS.primary), model: GEMINI_MODELS.primary };
  } catch (e) {
    if (!isGeminiRateLimit(e)) throw e;
    return { result: await fn(GEMINI_MODELS.fallback), model: GEMINI_MODELS.fallback };
  }
}

export function usageFromGemini(md: GenerateContentResponseUsageMetadata | undefined): TokenUsage {
  const u = emptyUsage();
  if (!md) return u;
  u.inputTokens = md.promptTokenCount ?? 0;
  u.outputTokens = (md.candidatesTokenCount ?? 0) + (md.thoughtsTokenCount ?? 0);
  u.cacheReadTokens = md.cachedContentTokenCount ?? 0;
  return u;
}

export function addTokenUsage(into: TokenUsage, add: TokenUsage): void {
  into.inputTokens += add.inputTokens;
  into.outputTokens += add.outputTokens;
  into.cacheReadTokens += add.cacheReadTokens;
  into.cacheWriteTokens += add.cacheWriteTokens;
}
