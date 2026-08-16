import { guardAnalyticsSql } from './sql-guard';
import { ACTION_TOOLS, resolvePage } from './agent-tools';
import type { TokenUsage } from './models';

// ── Provider-neutral protocol between the assistant loops and the UI ────────

export type ChartSpec = { title: string; kind: 'bar'; labels: string[]; values: number[] };

export type QueryResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  truncated: boolean;
};

/** An editable scalar field the user can tweak on the confirmation card. */
export type EditField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select';
  options?: string[];
};

/** An editable line item (documents) on the confirmation card. */
export type EditItem = {
  description: string; hsn?: string; qty: number; uom?: string; rate: number; gstRate: number;
  isToolingCharge?: boolean;
  /** Part/section this line sits under (blank = ungrouped). */
  groupLabel?: string;
  /** Custom-column values keyed by columnDef.id. */
  attributes?: Record<string, string>;
};

/** A write the agent proposed, staged server-side, awaiting user confirmation. */
export type StagedAction = {
  actionId: string;
  kind: string;
  title: string;
  details: { label: string; value: string }[];
  /** Line-item preview rows (documents). */
  items?: string[];
  warning?: string;
  /** Present when the user may edit the proposal inline before confirming. */
  editable?: EditField[];
  /** Raw current values keyed by field, for pre-filling the edit inputs. */
  payload?: Record<string, unknown>;
  /** Structured line items to edit (documents). */
  editItems?: EditItem[];
};

export type StageResult =
  | { ok: true; action: StagedAction }
  | { ok: false; error: string };

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; label: string }
  | { type: 'table'; title: string; columns: string[]; rows: QueryResult['rows'] }
  | { type: 'chart'; spec: ChartSpec }
  | { type: 'action'; action: StagedAction }
  | { type: 'nav'; path: string; label: string; newTab: boolean }
  | { type: 'done'; usage: TokenUsage; model: string }
  | { type: 'error'; message: string };

// ── Attachments (multimodal input) ──────────────────────────────────────────
// A user turn may carry images / PDFs the model reads to extract details
// (a visiting card → customer, a purchase order → quotation/invoice lines).
// Bytes are base64 (no data: prefix). Used transiently for extraction only —
// never persisted — so they ride on the turn that sends them and nowhere else.

export const ATTACH_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;
export type AttachMime = (typeof ATTACH_MIME_TYPES)[number];

export const MAX_ATTACHMENTS = 3;
/** Per-file raw byte cap (before base64). */
export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
/** Combined raw byte cap across a request. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 15 * 1024 * 1024;
/** Base64 length is ~4/3 of raw bytes — the length cap for a base64 string of `bytes`. */
export const base64LenCap = (bytes: number): number => Math.ceil(bytes / 3) * 4;

export type Attachment = { name?: string; mimeType: AttachMime; data: string };

export type ChatTurn = { role: 'user' | 'assistant'; content: string; attachments?: Attachment[] };

export type AssistantContext = {
  tenantName: string;
  userName: string;
  /** e.g. "Wednesday, 30 July 2026" in the business timezone. */
  today: string;
  /**
   * One line describing the screen/record the user is currently viewing (and,
   * for a record page, its trusted uuid) so "this invoice / current quote / here"
   * resolve without a lookup. Omitted when the page carries no useful context.
   */
  pageContext?: string;
  /** Permission keys this user holds — the loop refuses tools outside them. */
  permissions: ReadonlySet<string>;
  /** Execute already-guarded SQL inside a READ ONLY tenant transaction. */
  executeQuery: (wrappedSql: string) => Promise<QueryResult>;
  /** Validate + persist a proposed write as a pending ai_action row. */
  stageAction: (kind: string, input: Record<string, unknown>) => Promise<StageResult>;
  signal?: AbortSignal;
};

export const MAX_TOOL_ROUNDS = 6;
export const MODEL_ROW_CAP = 50; // rows fed back to the model; UI gets up to 200

// One source of truth for tool names/descriptions — each provider adapts the
// schema shape (Anthropic input_schema vs Gemini functionDeclarations).
export const TOOL_META = {
  query: {
    name: 'run_analytics_query',
    description:
      'Run one read-only PostgreSQL SELECT over the ERP tables and get the result rows. ' +
      'Use for every data question. The result table is also shown to the user automatically.',
    sqlDesc: 'A single SELECT (WITH allowed) following the SQL rules.',
    titleDesc: 'Very short label for what this query fetches, e.g. "Top customers FY 25-26".',
  },
  chart: {
    name: 'present_chart',
    description:
      'Show the user a small bar chart. Call at most once per answer, after querying, ' +
      'with values copied exactly from query results. Max 12 bars.',
  },
} as const;

export type ToolOutcome = {
  /** Events to surface to the UI, in order. */
  events: AssistantEvent[];
  /** Payload for the model (JSON-serializable). */
  payload: Record<string, unknown>;
  isError: boolean;
};

/** Guard + execute the analytics query tool; provider loops surface the result. */
export async function runQueryTool(
  input: { sql?: string; title?: string },
  executeQuery: AssistantContext['executeQuery'],
): Promise<ToolOutcome> {
  const title = input.title || 'Query';
  const events: AssistantEvent[] = [{ type: 'tool', label: title }];

  const guarded = guardAnalyticsSql(input.sql ?? '');
  if (!guarded.ok) {
    return {
      events, isError: true,
      payload: { error: `Query rejected: ${guarded.reason}. Rewrite the SQL following the rules and try again.` },
    };
  }
  try {
    const res = await executeQuery(guarded.wrapped);
    events.push({ type: 'table', title, columns: res.columns, rows: res.rows });
    return {
      events, isError: false,
      payload: {
        columns: res.columns,
        rows: res.rows.slice(0, MODEL_ROW_CAP),
        rowCount: res.rowCount,
        note: res.rowCount > MODEL_ROW_CAP
          ? `showing first ${MODEL_ROW_CAP} of ${res.rowCount} rows${res.truncated ? ' (result capped)' : ''}`
          : res.truncated ? 'result capped at 200 rows' : undefined,
      },
    };
  } catch (e) {
    return {
      events, isError: true,
      payload: { error: `Query failed: ${e instanceof Error ? e.message : 'unknown error'}. Fix the SQL and retry.` },
    };
  }
}

// Per-turn mutable state shared by the provider loops.
export type TurnState = { chartShown: boolean; actionPending: boolean };

const ACTION_PERMISSION = new Map(ACTION_TOOLS.map((t) => [t.name, t.permission]));

/** Handle open_page: resolve, surface a nav event, tell the model it happened. */
export function runOpenPageTool(input: { page?: string; id?: string }): ToolOutcome {
  const nav = resolvePage(input);
  if ('error' in nav) return { events: [], isError: true, payload: { error: nav.error } };
  return {
    events: [{ type: 'nav', path: nav.path, label: nav.label, newTab: nav.newTab }],
    isError: false,
    payload: { result: `Opened ${nav.label} (${nav.path}) for the user.` },
  };
}

/**
 * Handle a write tool: permission-check, stage via the web layer, surface the
 * confirmation card. One pending action at a time; the model is told to wrap up.
 */
export async function runActionTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AssistantContext,
  state: TurnState,
): Promise<ToolOutcome> {
  const permission = ACTION_PERMISSION.get(name);
  if (permission === undefined) return { events: [], isError: true, payload: { error: 'Unknown tool.' } };
  if (permission && !ctx.permissions.has(permission)) {
    return {
      events: [], isError: true,
      payload: { error: `The user does not have the "${permission}" permission — tell them so and do not retry.` },
    };
  }
  if (state.actionPending) {
    return {
      events: [], isError: true,
      payload: { error: 'An action is already awaiting the user’s confirmation. Do not propose another one — end your reply.' },
    };
  }

  const staged = await ctx.stageAction(name, input);
  if (!staged.ok) return { events: [], isError: true, payload: { error: staged.error } };

  state.actionPending = true;
  return {
    events: [{ type: 'action', action: staged.action }],
    isError: false,
    payload: {
      staged: true,
      summary: staged.action.title,
      note:
        'Proposed to the user — a confirmation card with full details is on their screen. ' +
        'In one short sentence tell them what you proposed and to confirm or cancel, then STOP (no more tool calls this turn). ' +
        'You will get the result after they decide.',
    },
  };
}

/** Validate + surface the chart tool. Returns the updated chartShown flag. */
export function runChartTool(
  input: Partial<ChartSpec>,
  chartShown: boolean,
): ToolOutcome & { chartShown: boolean } {
  const n = Math.min(input.labels?.length ?? 0, input.values?.length ?? 0, 12);
  if (chartShown || n < 2) {
    return {
      events: [], chartShown, isError: true,
      payload: { error: chartShown ? 'A chart was already shown for this answer.' : 'Chart needs 2–12 label/value pairs.' },
    };
  }
  const spec: ChartSpec = {
    title: input.title || 'Chart', kind: 'bar',
    labels: input.labels!.slice(0, n).map(String),
    values: input.values!.slice(0, n).map((v) => Number(v) || 0),
  };
  return {
    events: [{ type: 'chart', spec }], chartShown: true, isError: false,
    payload: { result: 'Chart shown to the user.' },
  };
}
