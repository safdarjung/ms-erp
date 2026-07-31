import 'server-only';
import { withTenant, withTenantReadOnly, aiUsage, sql } from '@ms/db';
import { estimateCostUsd, ROW_CAP, type AiFeature, type QueryResult, type TokenUsage } from '@ms/ai';

const DISPLAY_ROW_CAP = 100;
const STATEMENT_TIMEOUT_MS = 4000;

/** Render a DB cell into something JSON-serializable and chart-friendly. */
function toCell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  // numeric() columns arrive as strings — surface them as numbers when safe
  if (/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) return Number(s);
  return s;
}

/**
 * Execute guarded analytics SQL inside a READ ONLY tenant transaction with a
 * statement timeout. `wrappedSql` must come from `guardAnalyticsSql`.
 */
export async function executeAnalyticsQuery(
  tenantId: string,
  userId: string,
  wrappedSql: string,
): Promise<QueryResult> {
  return withTenantReadOnly(tenantId, userId, async (tx) => {
    await tx.execute(sql`set local statement_timeout = ${sql.raw(String(STATEMENT_TIMEOUT_MS))}`);
    const res = await tx.execute(sql.raw(wrappedSql));
    const raw = (Array.isArray(res) ? res : []) as Record<string, unknown>[];
    const columns = raw.length ? Object.keys(raw[0]!) : [];
    const rows = raw.slice(0, DISPLAY_ROW_CAP).map((r) => columns.map((c) => toCell(r[c])));
    return { columns, rows, rowCount: raw.length, truncated: raw.length >= ROW_CAP };
  });
}

/** Best-effort usage metering (docs/05 §1) — must never break the response. */
export function recordAiUsage(
  tenantId: string,
  userId: string,
  feature: AiFeature,
  model: string,
  usage: TokenUsage,
): void {
  withTenant(tenantId, userId, (tx) =>
    tx.insert(aiUsage).values({
      tenantId, userId, feature, model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: String(estimateCostUsd(model, usage)),
    }),
  ).catch((e) => console.error('ai_usage insert failed:', e));
}

// Per-tenant sliding-window rate limit (per server instance — good enough for
// Phase 1; move to Redis when scaling out).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30; // headroom for post-confirmation continuation turns
const hits = new Map<string, number[]>();

export function checkAiRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const list = (hits.get(tenantId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(tenantId, list); return false; }
  list.push(now);
  hits.set(tenantId, list);
  return true;
}
