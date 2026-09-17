import { guardAnalyticsSql } from './sql-guard';
import {
  ACTION_TOOLS, ACTION_TOOL_NAMES, DRAFT_MESSAGE_TOOL, GET_DOCUMENT_TOOL, OPEN_PAGE_TOOL, PRICE_HISTORY_TOOL,
  resolvePage, type MessagePurpose,
} from './agent-tools';
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

/** price_history lookup — the web layer reads past quotation / bill lines. */
export type PriceHistoryInput = { q?: string; customerId?: string; limit?: number };
export type PriceHistoryLine = {
  date: string; customer: string; document: string; description: string;
  qty: number; uom: string; rate: number; gstRate: number; part?: string | null;
};
export type PriceHistoryResult =
  | { ok: true; lines: PriceHistoryLine[]; stats: { count: number; latest?: number; min?: number; max?: number; median?: number } }
  | { ok: false; error: string };

/** draft_message — the web layer resolves the recipient and builds the links. */
export type DraftMessageInput = {
  purpose?: string; customerId?: string; leadId?: string; phone?: string;
  text?: string; subject?: string; documentType?: string; documentId?: string;
};
/** A prepared message the user sends themselves (nothing is sent by the app). */
export type MessageDraft = {
  purpose: MessagePurpose;
  /** Who it is addressed to, for the card header ("Sharma Auto · 98123 45678"). */
  recipient: { name: string; phone?: string; email?: string; kind: 'customer' | 'lead' | 'phone' };
  text: string;
  subject?: string;
  /** wa.me deep link with the text pre-filled (absent when no usable phone). */
  whatsappUrl?: string;
  /** mailto: link with subject + body (absent when no email). */
  mailtoUrl?: string;
  /** Public PDF link that was inserted, if any. */
  pdfLink?: string;
  /** Document the link points to, for the card ("Quotation QT/26-27/0012"). */
  documentLabel?: string;
};
export type DraftMessageResult =
  | { ok: true; message: MessageDraft }
  | { ok: false; error: string };

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; label: string }
  | { type: 'table'; title: string; columns: string[]; rows: QueryResult['rows'] }
  | { type: 'chart'; spec: ChartSpec }
  | { type: 'action'; action: StagedAction }
  | { type: 'message'; message: MessageDraft }
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
  /** Past rates for similar items (tenant-scoped, read-only). */
  priceHistory: (input: PriceHistoryInput) => Promise<PriceHistoryResult>;
  /** Resolve a recipient + build WhatsApp / mail links for a drafted message. */
  draftMessage: (input: DraftMessageInput) => Promise<DraftMessageResult>;
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

const errorOutcome = (error: string, events: AssistantEvent[] = []): ToolOutcome => ({ events, isError: true, payload: { error } });
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Guard + execute the analytics query tool; provider loops surface the result. */
export async function runQueryTool(
  input: { sql?: string; title?: string },
  executeQuery: AssistantContext['executeQuery'],
): Promise<ToolOutcome> {
  const title = input.title || 'Query';
  const events: AssistantEvent[] = [{ type: 'tool', label: title }];

  const guarded = guardAnalyticsSql(input.sql ?? '');
  if (!guarded.ok) {
    return errorOutcome(`Query rejected: ${guarded.reason}. Rewrite the SQL following the rules and try again.`, events);
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
    return errorOutcome(`Query failed: ${errMsg(e, 'unknown error')}. Fix the SQL and retry.`, events);
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
    if (!res.ok) return errorOutcome(res.error, events);
    return { events, isError: false, payload: res.document };
  } catch (e) {
    return errorOutcome(`Could not read the document: ${errMsg(e, 'unknown error')}`, events);
  }
}

/** Handle price_history: read-only, instant; the user also sees the table. */
export async function runPriceHistoryTool(input: PriceHistoryInput, ctx: AssistantContext): Promise<ToolOutcome> {
  const q = (input.q ?? '').trim();
  const events: AssistantEvent[] = [{ type: 'tool', label: `Past rates for “${q || '…'}”` }];
  if (!q) return errorOutcome('Pass a few words of the item in q (e.g. "blanking die").', events);
  try {
    const res = await ctx.priceHistory({ ...input, q, limit: Math.min(Math.max(1, input.limit ?? 12), 30) });
    if (!res.ok) return errorOutcome(res.error, events);
    if (res.lines.length) {
      events.push({
        type: 'table',
        title: `Past rates — ${q}`,
        columns: ['date', 'customer', 'document', 'item', 'qty', 'rate', 'gst_%'],
        rows: res.lines.map((l) => [l.date, l.customer, l.document, l.description + (l.part ? ` (${l.part})` : ''), `${l.qty} ${l.uom}`, l.rate, l.gstRate]),
      });
    }
    return {
      events, isError: false,
      payload: {
        lines: res.lines, stats: res.stats,
        note: res.lines.length
          ? 'Rates are ex-GST per unit. Anchor a new rate on the latest/median and mention the precedent to the user ("last time ₹30,000 for Sharma Auto").'
          : 'No past line matches those words — try fewer or different words, or price with judgment and say so.',
      },
    };
  } catch (e) {
    return errorOutcome(`Could not read past rates: ${errMsg(e, 'unknown error')}`, events);
  }
}

/** Handle draft_message: resolve the recipient, build links, show the message card. */
export async function runDraftMessageTool(input: DraftMessageInput, ctx: AssistantContext): Promise<ToolOutcome> {
  const events: AssistantEvent[] = [{ type: 'tool', label: 'Preparing the message' }];
  if (!(input.text ?? '').trim()) return errorOutcome('Write the message text in `text` first.', events);
  try {
    const res = await ctx.draftMessage(input);
    if (!res.ok) return errorOutcome(res.error, events);
    events.push({ type: 'message', message: res.message });
    const m = res.message;
    return {
      events, isError: false,
      payload: {
        shown: true,
        recipient: m.recipient.name,
        whatsapp: !!m.whatsappUrl, email: !!m.mailtoUrl, pdfLink: m.pdfLink ?? null,
        note:
          'The message card is on the user’s screen with ' +
          [m.whatsappUrl ? 'a WhatsApp button' : null, m.mailtoUrl ? 'an email button' : null, 'Copy'].filter(Boolean).join(', ') +
          '. Nothing has been sent. Tell the user in one short sentence to check it and tap the button; do not repeat the message text.' +
          (!m.whatsappUrl && !m.mailtoUrl ? ' They have no phone or email on record — suggest adding one, or they can copy the text.' : ''),
      },
    };
  } catch (e) {
    return errorOutcome(`Could not prepare the message: ${errMsg(e, 'unknown error')}`, events);
  }
}

/** Handle open_page: resolve, surface a nav event, tell the model it happened. */
export function runOpenPageTool(input: { page?: string; id?: string }): ToolOutcome {
  const nav = resolvePage(input);
  if ('error' in nav) return errorOutcome(nav.error);
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
  if (permission === undefined) return errorOutcome('Unknown tool.');
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
    return errorOutcome('A card is already waiting for the user to tap Yes. Do not propose another one — end your reply.');
  }

  const staged = await ctx.stageAction(name, input);
  if (!staged.ok) return errorOutcome(staged.error);

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

/**
 * Route one tool call to its handler. Both provider loops (Claude, Gemini) go
 * through here so a new tool is wired in exactly one place.
 */
export async function dispatchTool(
  name: string | undefined,
  args: Record<string, unknown>,
  ctx: AssistantContext,
  state: TurnState,
): Promise<ToolOutcome> {
  switch (name) {
    case TOOL_META.query.name:
      return runQueryTool(args as { sql?: string; title?: string }, ctx.executeQuery);
    case TOOL_META.chart.name: {
      const out = runChartTool(args as Partial<ChartSpec>, state.chartShown);
      state.chartShown = out.chartShown;
      return out;
    }
    case OPEN_PAGE_TOOL.name:
      return runOpenPageTool(args as { page?: string; id?: string });
    case GET_DOCUMENT_TOOL.name:
      return runGetDocumentTool(args as GetDocumentInput, ctx);
    case PRICE_HISTORY_TOOL.name:
      return runPriceHistoryTool(args as PriceHistoryInput, ctx);
    case DRAFT_MESSAGE_TOOL.name:
      return runDraftMessageTool(args as DraftMessageInput, ctx);
    default:
      if (name && ACTION_TOOL_NAMES.has(name)) return runActionTool(name, args, ctx, state);
      // A hallucinated tool name — tell the model what exists so it can correct itself.
      console.warn('assistant: unknown tool called:', name, JSON.stringify(args).slice(0, 200));
      return errorOutcome(
        `There is no tool called "${name}". To prepare a WhatsApp/email message use draft_message; to read past rates use price_history; ` +
        'to read a document use get_document; to change data use the create_/update_/set_/convert_ tools.',
      );
  }
}

/** Provider errors worth one quiet retry (overloaded / brief network blip). */
export function isTransientError(e: unknown): boolean {
  const status = Number((e as { status?: number })?.status ?? (e as { code?: number })?.code);
  if ([500, 502, 503, 504].includes(status)) return true;
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return /unavailable|overloaded|timed? ?out|econnreset|fetch failed|socket hang up|network/.test(msg);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Said when the tool loop runs out of rounds before the model wrote anything — the user must never get a blank reply. */
export const STUCK_MESSAGE =
  'I got stuck looking that up and didn’t finish. Tell me the document number or the customer’s name and I’ll try again.';
