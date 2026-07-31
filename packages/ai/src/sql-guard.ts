// Guardrail for AI-proposed analytics SQL (docs/05 §2). The model may only
// run a single read-only SELECT over an allowlist of business tables; the
// query is additionally wrapped with a hard row cap and executed inside a
// READ ONLY transaction with the tenant RLS context and a statement timeout.

export const ANALYTICS_TABLES = [
  'customer', 'lead', 'lead_activity',
  'quotation', 'quotation_item',
  'sales_order', 'order_item',
  'tax_invoice', 'tax_invoice_item',
] as const;

export const ROW_CAP = 200;

const ALLOWED = new Set<string>(ANALYTICS_TABLES);

// DDL/DML, session/config, and escape hatches. Checked on a literal-stripped
// copy so words inside user-visible strings don't false-positive.
const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|explain|call|do|listen|notify|load|reset|discard|comment|lock|prepare|deallocate|import|reindex|cluster|checkpoint|set|into|set_config|current_setting|pg_sleep|dblink|information_schema)\b|pg_[a-z_]+/i;

export type GuardResult =
  | { ok: true; wrapped: string }
  | { ok: false; reason: string };

/** Strip -- and C-style comments, collapse whitespace. */
function stripComments(s: string): string {
  return s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Replace '…' string literals (with '' escapes) so keyword scans skip them. */
function stripLiterals(s: string): string {
  return s.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * `extract(month FROM d)`, `substring(x FROM 1)`, `trim(both FROM x)` contain a
 * FROM that is not a relation reference — neutralize it so the relation scan
 * doesn't false-positive on the following identifier.
 */
function neutralizeFunctionFrom(s: string): string {
  return s
    .replace(/\bextract\s*\(\s*[a-z_]+\s+from\b/gi, (m) => m.replace(/\bfrom\b/i, '__f'))
    .replace(/\b(substring|trim|overlay)\s*\([^()]*?\bfrom\b/gi, (m) => m.replace(/\bfrom\b/i, '__f'));
}

export function guardAnalyticsSql(raw: string): GuardResult {
  let q = stripComments(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  q = q.replace(/;+\s*$/, '');
  if (!q) return { ok: false, reason: 'Empty query' };
  if (q.includes(';')) return { ok: false, reason: 'Multiple statements are not allowed' };
  if (q.includes('"')) return { ok: false, reason: 'Quoted identifiers are not allowed — use plain lowercase names' };
  if (/\$\w*\$/.test(q)) return { ok: false, reason: 'Dollar-quoting is not allowed' };

  const scan = stripLiterals(q);
  if (!/^(select|with)\b/i.test(scan)) return { ok: false, reason: 'Only SELECT queries are allowed' };

  const bad = scan.match(FORBIDDEN);
  if (bad) return { ok: false, reason: `Not allowed in analytics queries: "${bad[0]}"` };
  if (/\bfor\s+(update|share|no\s+key|key\s+share)\b/i.test(scan)) {
    return { ok: false, reason: 'Row locking is not allowed' };
  }

  // CTE names defined in the query are legal relation references.
  const relScan = neutralizeFunctionFrom(scan);
  const cteNames = new Set<string>();
  for (const m of relScan.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) cteNames.add(m[1]!.toLowerCase());

  // Every FROM/JOIN relation must be an allowlisted table or a CTE.
  for (const m of relScan.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
    const rel = m[1]!.toLowerCase();
    if (rel.includes('.')) return { ok: false, reason: `Schema-qualified names are not allowed: "${rel}"` };
    if (ALLOWED.has(rel) || cteNames.has(rel)) continue;
    return { ok: false, reason: `Table "${rel}" is not available. Allowed: ${ANALYTICS_TABLES.join(', ')}` };
  }

  // Hard row cap regardless of what the query says.
  return { ok: true, wrapped: `select * from (${q}) __ai_result limit ${ROW_CAP}` };
}
