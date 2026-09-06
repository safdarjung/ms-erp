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
  /** Part this line sits under (blank = no part). */
  groupLabel?: string;
  /** Detail printed beside the part heading (drawing no., material…). */
  groupNote?: string;
  /** Custom-field values keyed by columnDef.id. */
  attributes?: Record<string, string>;
};

/** What the confirmation card needs to render + edit a document proposal. */
export type StagedDocMeta = {
  type: 'quotation' | 'invoice' | 'order';
  /** Inter-state supply → IGST, else CGST + SGST (orders: ex-GST only). */
  interstate: boolean;
  /** Whether lines may carry the one-time tooling / NRE flag. */
  tooling: boolean;
  /** Document number when editing an existing record. */
  number?: string;
};

/** A write the agent proposed, staged server-side, awaiting user confirmation. */
export type StagedAction = {
  actionId: string;
  kind: string;
  title: string;
  details: { label: string; value: string }[];
  /** Line-item preview rows (documents). */
  items?: string[];
  /** Human-readable change list for edits of an existing document. */
  changes?: string[];
  warning?: string;
  /** Present when the user may edit the proposal inline before confirming. */
  editable?: EditField[];
  /** Raw current values keyed by field, for pre-filling the edit inputs. */
  payload?: Record<string, unknown>;
  /** Structured line items to edit (documents). */
  editItems?: EditItem[];
  /** Document rendering/editing hints (documents). */
  doc?: StagedDocMeta;
};

export type StageResult =
  | { ok: true; action: StagedAction }
  | { ok: false; error: string };

/** get_document lookup — the web layer shapes the snapshot for the model. */
export type GetDocumentInput = { type?: string; id?: string; number?: string };
export type GetDocumentResult =
  | { ok: true; document: Record<string, unknown> }
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
  /** Read one document in full for the model (tenant-scoped). */
  getDocument: (input: GetDocumentInput) => Promise<GetDocumentResult>;
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

/** What a missing permission stops the user doing, in shop words — for a one-sentence refusal. */
const PERMISSION_VERB: Record<string, string> = {
  'customer.create': 'add customers',
  'customer.edit': 'change customer details',
  'customer.delete': 'delete customers',
  'lead.create': 'add enquiries',
  'lead.edit': 'change enquiries',
  'lead.delete': 'delete enquiries',
  'quotation.create': 'create quotations',
  'quotation.edit': 'change quotations',
  'invoice.create': 'make bills',
  'invoice.edit': 'change bills or record payments',
  'order.create': 'make orders',
  'order.edit': 'change orders',
};
const permissionSentence = (permission: string) =>
  `Your login can’t ${PERMISSION_VERB[permission] ?? 'do that'} — ask the owner for access.`;

/** Handle get_document: read-only, instant; the model gets the full snapshot. */
export async function runGetDocumentTool(input: GetDocumentInput, ctx: AssistantContext): Promise<ToolOutcome> {
  const what = input.type === 'invoice' ? 'invoice' : input.type === 'order' ? 'order' : 'quotation';
  const label = `Reading ${what}${input.number ? ` ${input.number}` : ''}`;
  const events: AssistantEvent[] = [{ type: 'tool', label }];
  try {
    const res = await ctx.getDocument(input);
    if (!res.ok) return { events, isError: true, payload: { error: res.error } };
    return { events, isError: false, payload: res.document };
  } catch (e) {
    return { events, isError: true, payload: { error: `Could not read the document: ${e instanceof Error ? e.message : 'unknown error'}` } };
  }
}

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
      payload: {
        error: permissionSentence(permission),
        note: 'Say exactly this sentence to the user and do not retry.',
      },
    };
  }
  if (state.actionPending) {
    return {
      events: [], isError: true,
      payload: { error: 'A card is already waiting for the user to tap Yes. Do not propose another one — end your reply.' },
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
      changes: staged.action.changes,
      note:
        'Proposed to the user — a confirmation card with full details is on their screen' +
        (staged.action.doc ? ' (a document preview with totals; they can tap "Check or change the lines" to fine-tune any line before saying yes)' : '') +
        '. Tell them in one short sentence what the card will save and to tap Yes (or Not now), then STOP (no more tool calls this turn). ' +
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
