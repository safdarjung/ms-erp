import 'server-only';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  computeGst, isInterstate, formatINR,
  customerInput, leadInput, quotationInput, invoiceInput, quotationItemInput, invoiceItemInput, columnDef,
  INVOICE_SETTABLE_STATUSES, LEAD_ACTIVITY_TYPES, LEAD_STAGE_LABELS, LEAD_STAGES, QUOTATION_SETTABLE_STATUSES,
  ORDER_CATEGORIES, MATERIAL_OWNERSHIP, ORDER_SETTABLE_STATUSES, PAYMENT_METHODS, orderInput, splitColumns, MAX_DOC_COLUMNS,
  QUOTATION_STATUS_LABELS, INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS,
  MATERIAL_OWNERSHIP_LABELS, PAYMENT_METHOD_LABELS,
  type LeadStage, type ColumnDef, type QuotationStatus, type InvoiceStatus, type OrderStatus,
  type OrderCategory, type MaterialOwnership, type PaymentMethod,
} from '@ms/core';
import {
  withTenant, aiAction, customer, lead, leadActivity, quotation, quotationItem, salesOrder, orderItem,
  taxInvoice, taxInvoiceItem, payment,
  and, count, desc, eq, ilike, sum, type Tx,
} from '@ms/db';
import type {
  StageResult, StagedAction, StagedDocMeta, EditField, EditItem, GetDocumentInput, GetDocumentResult,
} from '@ms/ai';
import type { CurrentUser } from './auth';
import {
  convertQuotationTx, convertQuotationToOrderTx, convertOrderToInvoiceTx,
  recordPaymentTx, deletePaymentTx, insertOrderTx,
  getSupplierStateCode, insertInvoiceTx, insertQuotationTx,
  updateInvoiceTx, updateOrderTx, updateQuotationTx, createLeadRecord,
} from './documents';
import {
  applyDocEdits, diffDocLines, resolveAttributes, MAX_DOC_LINES,
  type DocLine, type DocColumn, type EditOp,
} from './doc-edits';

// The AI agent's write path (docs/05 §5 human-in-the-loop). `stageAction`
// validates a proposed write and parks it as a pending `ai_action` row with a
// human-readable preview; nothing touches business tables until the user
// confirms and `executeAction` runs it — with the same zod validation, RBAC
// and RLS as the manual forms. Every proposal/decision stays as audit trail.

const EXPIRE_MINUTES = 30;
const MAX_AI_ITEMS = MAX_DOC_LINES;

type U = Pick<CurrentUser, 'tenantId' | 'userId'>;
type DocKind = StagedDocMeta['type'];

// ── Input schemas (model payloads re-validated server-side) ─────────────────

// Plain messages only: whatever is thrown here can land on a failed card in
// front of the user (after they edit + confirm), not just in front of the model.
const NOT_FOUND = 'Couldn’t find that — check the name and try again.';
const uuidField = z.string().uuid(NOT_FOUND);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date (YYYY-MM-DD)');

const leadExtras = { nextFollowupAt: dateOnly.optional() };
const createLeadInput = leadInput.extend(leadExtras);
const updateCustomerInput = customerInput.partial().extend({ id: uuidField });
const updateLeadInput = leadInput.extend(leadExtras).partial().extend({ id: uuidField });
const idOnly = z.object({ id: uuidField });
const leadIdOnly = z.object({ leadId: uuidField });
const logActivityInput = z.object({
  leadId: uuidField,
  type: z.enum(LEAD_ACTIVITY_TYPES).default('note'),
  notes: z.string().trim().min(1, 'Write a short note first').max(2000),
});
const quotationStatusInput = z.object({ id: uuidField, status: z.enum(QUOTATION_SETTABLE_STATUSES) });
const invoiceStatusInput = z.object({ id: uuidField, status: z.enum(INVOICE_SETTABLE_STATUSES) });
const convertQuotationInput = z.object({ quotationId: uuidField });
const convertQuotationToOrderInputZ = z.object({
  quotationId: uuidField,
  orderCategory: z.enum(ORDER_CATEGORIES).optional(),
  materialOwnership: z.enum(MATERIAL_OWNERSHIP).optional(),
});
const convertOrderInput = z.object({ orderId: uuidField });
const recordPaymentInputZ = z.object({
  invoiceId: uuidField,
  amount: z.coerce.number().positive('must be more than ₹0'),
  paidOn: dateOnly.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(60).optional(),
});
const paymentIdOnly = z.object({ id: uuidField });
const orderStatusInput = z.object({ id: uuidField, status: z.enum(ORDER_SETTABLE_STATUSES) });
const customerStatusInput = z.object({ id: uuidField, status: z.enum(['active', 'archived']) });
const updateQuotationDocInput = z.object({
  id: uuidField,
  docDate: dateOnly.optional(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  terms: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(quotationItemInput).min(1, 'Add at least one line').optional(),
  columnDefs: z.array(columnDef).max(MAX_DOC_COLUMNS).optional(),
});
const updateInvoiceDocInput = z.object({
  id: uuidField,
  docDate: dateOnly.optional(),
  poRef: z.string().trim().max(40).optional(),
  terms: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(invoiceItemInput).min(1, 'Add at least one line').optional(),
  columnDefs: z.array(columnDef).max(MAX_DOC_COLUMNS).optional(),
});
const updateOrderDocInput = z.object({
  id: uuidField,
  docDate: dateOnly.optional(),
  deliveryDate: z.union([dateOnly, z.literal('')]).optional(),
  poRef: z.string().trim().max(40).optional(),
  orderCategory: z.enum(ORDER_CATEGORIES).optional(),
  materialOwnership: z.enum(MATERIAL_OWNERSHIP).optional(),
  items: z.array(invoiceItemInput).min(1, 'Add at least one line').optional(),
  columnDefs: z.array(columnDef).max(MAX_DOC_COLUMNS).optional(),
});
const duplicateQuotationInput = quotationInput.extend({ quotationId: uuidField });

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Models sometimes emit literal "\n" sequences in multi-line fields — make them real. */
const realNewlines = (v: unknown) => (typeof v === 'string' ? v.replace(/\\n/g, '\n') : v);

/** "items.2.rate" → "Line 3 rate"; "stateCode" → "State code"; unknown keys → spaced words. */
function fieldLabel(path: (string | number)[]): string {
  if (path[0] === 'items' && typeof path[1] === 'number') {
    const rest = path.slice(2).map((p) => (typeof p === 'number' ? `#${p + 1}` : FIELD_LABELS[p] ?? p)).join(' ');
    return `Line ${path[1] + 1}${rest ? ` ${rest.charAt(0).toLowerCase()}${rest.slice(1)}` : ''}`;
  }
  const head = path[0];
  if (typeof head !== 'string') return 'Input';
  const known = FIELD_LABELS[head] ?? CUSTOMER_LABELS[head] ?? LEAD_LABELS[head];
  if (known) return known;
  const spaced = head.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One plain sentence per zod issue — never the raw code or the word "uuid". */
function issueText(issue: z.ZodIssue): string {
  const isUuid = issue.code === 'invalid_string' && issue.validation === 'uuid';
  if (isUuid || /uuid/i.test(issue.message)) return NOT_FOUND;
  const label = fieldLabel(issue.path);
  let what: string;
  switch (issue.code) {
    case 'invalid_type':
      what = issue.received === 'undefined' || issue.received === 'null' ? 'is required'
        : issue.expected === 'number' ? 'must be a number'
        : issue.expected === 'array' ? 'must be a list'
        : `must be ${issue.expected === 'string' ? 'text' : issue.expected}`;
      break;
    case 'too_small':
      what = issue.type === 'string' && issue.minimum === 1 ? 'is required'
        : issue.type === 'array' ? `needs at least ${issue.minimum} line${issue.minimum === 1 ? '' : 's'}`
        : issue.type === 'number' ? `must be ${issue.inclusive ? 'at least' : 'more than'} ${issue.minimum}`
        : issue.message;
      break;
    case 'too_big':
      what = issue.type === 'string' ? `is too long (max ${issue.maximum} characters)`
        : issue.type === 'array' ? `has too many entries (max ${issue.maximum})`
        : issue.type === 'number' ? `must be ${issue.inclusive ? 'at most' : 'less than'} ${issue.maximum}`
        : issue.message;
      break;
    case 'invalid_enum_value':
      what = 'has a value that isn’t in the list — pick one of the options';
      break;
    default:
      what = issue.message.replace(/\bquery\b/gi, 'search');
  }
  if (issue.path[0] === 'stateCode') what = 'must be 2 digits (06 = Haryana)';
  // Custom messages already read as a sentence fragment ("Select a customer") —
  // keep them, lower-cased behind the label; generated ones start with a verb.
  const frag = what.charAt(0).toLowerCase() + what.slice(1);
  return `${label}: ${frag}`;
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue ? issueText(issue) : 'Something in that doesn’t look right — check the details and try again.');
  }
  return parsed.data;
}

// ── Line items: fold the model's column pairs, apply edits, load current ────

/** Column defs from a raw payload (card re-stage / duplicate), else none. */
function readColumns(raw: unknown): DocColumn[] {
  if (raw === undefined || raw === null) return [];
  const parsed = z.array(columnDef).max(MAX_DOC_COLUMNS).safeParse(raw);
  // Never swallow a bad list: dropping it would quietly lose every field and
  // the user's choice of where each one prints.
  if (!parsed.success) throw new Error(`Extra fields: ${parsed.error.issues[0]?.message ?? 'not valid'}.`);
  return parsed.data;
}

/**
 * The assistant supplies item specs as per-line `attributes: [{name,value}]`
 * pairs (the card re-stages id-keyed records). Resolve them against the base
 * columns — reusing an existing column by name, creating new ones — and return
 * id-keyed items plus the resulting column list.
 */
function foldItems(rawItems: unknown, baseColumns: DocColumn[]): { items: Record<string, unknown>[]; columnDefs: DocColumn[] } {
  if (!Array.isArray(rawItems)) throw new Error('Items: add at least one line.');
  if (rawItems.length > MAX_AI_ITEMS) throw new Error(`Too many lines — a document can have up to ${MAX_AI_ITEMS}.`);
  let columns = baseColumns;
  const items = rawItems.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const r = resolveAttributes(columns, it.attributes as Parameters<typeof resolveAttributes>[1]);
    columns = r.columns;
    return { ...it, attributes: r.attributes };
  });
  return { items, columnDefs: columns };
}

type StoredLine = {
  description: string; hsn: string | null; qty: string; uom: string; rate: string; gstRate: string;
  isToolingCharge?: boolean; groupLabel: string | null; groupNote?: string | null; attributes: Record<string, string>;
};

const toDocLine = (it: StoredLine, tooling: boolean): DocLine => ({
  description: it.description, hsn: it.hsn ?? undefined, qty: Number(it.qty), uom: it.uom,
  rate: Number(it.rate), gstRate: Number(it.gstRate),
  ...(tooling ? { isToolingCharge: !!it.isToolingCharge } : {}),
  ...(it.groupLabel ? { groupLabel: it.groupLabel } : {}),
  ...(it.groupLabel && it.groupNote ? { groupNote: it.groupNote } : {}),
  attributes: { ...(it.attributes ?? {}) },
});

async function loadDocLines(tx: Tx, kind: DocKind, id: string): Promise<DocLine[]> {
  if (kind === 'quotation') {
    const rows = await tx.select().from(quotationItem).where(eq(quotationItem.quotationId, id)).orderBy(quotationItem.seq);
    return rows.map((r) => toDocLine(r, true));
  }
  if (kind === 'invoice') {
    const rows = await tx.select().from(taxInvoiceItem).where(eq(taxInvoiceItem.invoiceId, id)).orderBy(taxInvoiceItem.seq);
    return rows.map((r) => toDocLine(r, false));
  }
  const rows = await tx.select().from(orderItem).where(eq(orderItem.orderId, id)).orderBy(orderItem.seq);
  return rows.map((r) => toDocLine(r, false));
}

type ResolvedItems = {
  items: Record<string, unknown>[];
  columnDefs: DocColumn[];
  /** Human-readable line changes (empty when the lines are untouched). */
  changes: string[];
  /** True only when the model sent a full `items` list (wholesale replacement). */
  replaced: boolean;
};

/**
 * Work out the document's new lines from what the model sent: `edits` (ops
 * against the current lines), `items` (wholesale replacement), or neither
 * (header-only edit → lines unchanged). Always returns a complete list so the
 * staged payload is self-contained and the card can show/edit the whole doc.
 */
function resolveDocItems(current: DocLine[], currentColumns: DocColumn[], input: Record<string, unknown>): ResolvedItems {
  const hasEdits = Array.isArray(input.edits) && input.edits.length > 0;
  const hasItems = Array.isArray(input.items) && input.items.length > 0;
  if (hasEdits && hasItems) throw new Error('Send either line changes or a full list of lines, not both.');
  if (hasEdits) {
    const r = applyDocEdits(current, currentColumns, input.edits as EditOp[]);
    return { items: r.lines as unknown as Record<string, unknown>[], columnDefs: r.columns, changes: r.changes, replaced: false };
  }
  if (hasItems) {
    const base = Array.isArray(input.columnDefs) ? readColumns(input.columnDefs) : currentColumns;
    const folded = foldItems(input.items, base);
    const after = folded.items as unknown as DocLine[];
    return { ...folded, changes: diffDocLines(current, after, folded.columnDefs), replaced: true };
  }
  return { items: current as unknown as Record<string, unknown>[], columnDefs: currentColumns, changes: [], replaced: false };
}

// ── Preview helpers ─────────────────────────────────────────────────────────

type KV = { label: string; value: string };
type Stage = {
  payload: unknown; title: string; details: KV[]; items?: string[]; changes?: string[]; warning?: string; doc?: StagedDocMeta;
};

const push = (details: KV[], label: string, value: string | number | null | undefined) => {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    details.push({ label, value: String(value) });
  }
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const CUSTOMER_LABELS: Record<string, string> = {
  name: 'Name', regType: 'GST registration', gstin: 'GSTIN', stateCode: 'State code',
  contactPerson: 'Contact person', phone: 'Phone', email: 'Email', address: 'Address',
  creditTermsDays: 'Credit terms (days)',
};
const LEAD_LABELS: Record<string, string> = {
  customerName: 'Company / name', contact: 'Contact', phone: 'Phone', email: 'Email', source: 'Source',
  requirement: 'Requirement', stage: 'Stage', valueEstimate: 'Est. value (₹)', nextFollowupAt: 'Next follow-up',
};
/** Plain names for document/payment fields in validation messages. */
const FIELD_LABELS: Record<string, string> = {
  docDate: 'Date', validityDays: 'Validity (days)', poRef: 'PO number', terms: 'Terms', notes: 'Notes',
  items: 'Items', amount: 'Amount', paidOn: 'Payment date', stateCode: 'State code', customerId: 'Customer',
  quotationId: 'Quotation', invoiceId: 'Bill', orderId: 'Order', leadId: 'Enquiry', id: 'Record',
  deliveryDate: 'Delivery date', orderCategory: 'Category', materialOwnership: 'Material', method: 'Payment method',
  reference: 'Reference', status: 'Status', description: 'Description', qty: 'Qty', rate: 'Rate (₹)', gstRate: 'GST %',
  hsn: 'HSN code', uom: 'Unit', groupLabel: 'Part', columnDefs: 'Extra columns', type: 'Type',
};
const ACTIVITY_NOUN: Record<string, string> = { call: 'call note', email: 'email note', meeting: 'meeting note', note: 'note' };
const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

// Fields the user may edit inline on the confirmation card, per action kind.
const CUSTOMER_EDIT: EditField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'regType', label: 'GST registration', type: 'select', options: ['unregistered', 'registered'] },
  { key: 'gstin', label: 'GSTIN', type: 'text' },
  { key: 'stateCode', label: 'State code', type: 'text' },
  { key: 'contactPerson', label: 'Contact person', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'creditTermsDays', label: 'Credit terms (days)', type: 'number' },
];
const LEAD_EDIT: EditField[] = [
  { key: 'customerName', label: 'Company / name', type: 'text' },
  { key: 'contact', label: 'Contact', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'requirement', label: 'Requirement', type: 'textarea' },
  { key: 'stage', label: 'Stage', type: 'select', options: [...LEAD_STAGES] },
  { key: 'valueEstimate', label: 'Est. value (₹)', type: 'number' },
  { key: 'nextFollowupAt', label: 'Next follow-up', type: 'date' },
];
const F_DATE: EditField = { key: 'docDate', label: 'Date', type: 'date' };
const F_TERMS: EditField = { key: 'terms', label: 'Terms', type: 'textarea' };
const F_NOTES: EditField = { key: 'notes', label: 'Notes', type: 'textarea' };
const F_PO: EditField = { key: 'poRef', label: 'PO number', type: 'text' };
const F_VALIDITY: EditField = { key: 'validityDays', label: 'Validity (days)', type: 'number' };
const ORDER_FIELDS: EditField[] = [
  F_DATE, { key: 'deliveryDate', label: 'Delivery date', type: 'date' }, F_PO,
  { key: 'orderCategory', label: 'Category', type: 'select', options: [...ORDER_CATEGORIES] },
  { key: 'materialOwnership', label: 'Material', type: 'select', options: [...MATERIAL_OWNERSHIP] },
];

/** The editable spec for a staged action, or undefined for non-editable kinds. */
function editableFor(kind: string, payload: unknown): { fields: EditField[]; items?: EditItem[] } | undefined {
  const p = (payload ?? {}) as Record<string, unknown>;
  const items = Array.isArray(p.items) ? (p.items as EditItem[]) : undefined;
  // Every staged payload here is COMPLETE (document edits carry the full
  // resolved line list), so the card can pre-fill and re-stage it cleanly.
  switch (kind) {
    case 'create_customer': return { fields: CUSTOMER_EDIT };
    case 'create_lead': return { fields: LEAD_EDIT };
    case 'create_quotation':
    case 'duplicate_quotation':
    case 'update_quotation':
      return { fields: [F_DATE, F_VALIDITY, F_TERMS, F_NOTES], items };
    case 'create_invoice':
    case 'update_invoice':
      return { fields: [F_DATE, F_PO, F_TERMS, F_NOTES], items };
    case 'create_order':
    case 'update_order':
      return { fields: ORDER_FIELDS, items };
    case 'record_payment':
      return { fields: [{ key: 'amount', label: 'Amount (₹)', type: 'number' }, { key: 'paidOn', label: 'Payment date', type: 'date' },
        { key: 'method', label: 'Payment method', type: 'select', options: [...PAYMENT_METHODS] }, { key: 'reference', label: 'Reference (UTR / cheque no.)', type: 'text' }] };
    default: return undefined;
  }
}

/** "field: old → new" rows for update previews, only for the fields provided. */
function diffDetails(
  labels: Record<string, string>,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): KV[] {
  const out: KV[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (next[key] === undefined) continue;
    const before = current[key];
    const beforeStr = before === null || before === undefined || before === '' ? '—' : String(before);
    if (beforeStr === String(next[key])) continue;
    out.push({ label, value: `${beforeStr} → ${next[key]}` });
  }
  return out;
}

type PreviewItem = {
  description: string; qty: number; uom: string; rate: number;
  isToolingCharge?: boolean; groupLabel?: string; groupNote?: string; attributes?: Record<string, string>;
};
function docItemsPreview(items: PreviewItem[], columnDefs?: ColumnDef[]): string[] {
  const labelById = new Map((columnDefs ?? []).map((c) => [c.id, c.label]));
  const lines: string[] = [];
  let lastGroup: string | undefined;
  items.forEach((it, i) => {
    const g = (it.groupLabel ?? '').trim();
    if (g && g !== lastGroup) {
      const note = (it.groupNote ?? '').trim();
      lines.push(`▸ ${g}${note ? ` — ${note}` : ''}`);
    }
    lastGroup = g || undefined;
    const attrs = Object.entries(it.attributes ?? {})
      .map(([k, v]) => `${labelById.get(k) ?? k}: ${v}`)
      .join(' · ');
    lines.push(
      `${i + 1}. ${it.description} — ${it.qty} ${it.uom} × ${formatINR(it.rate)} = ${formatINR(r2(it.qty * it.rate))}` +
      `${it.isToolingCharge ? ' · one-time charge' : ''}${attrs ? ` · ${attrs}` : ''}`,
    );
  });
  return lines;
}

/** Totals rows for the card (the panel hides them under the document preview); returns the grand total for the title. */
function docTotalsDetails(details: KV[], interstate: boolean, items: { qty: number; rate: number; gstRate: number }[]): number {
  const totals = computeGst(items, interstate);
  push(details, 'Subtotal (before GST)', formatINR(totals.subtotal));
  if (interstate) push(details, 'IGST', formatINR(totals.igst));
  else push(details, 'CGST + SGST', `${formatINR(totals.cgst)} + ${formatINR(totals.sgst)}`);
  push(details, 'Total', formatINR(totals.grand));
  return totals.grand;
}

const gstLine = (interstate: boolean) => (interstate ? 'IGST (other state)' : 'CGST + SGST (same state)');
/** Card title with the money on the end: "New quotation for X · ₹56,000". */
const withMoney = (title: string, amount: number) => `${title} · ${formatINR(amount)}`;

const orderValue = (items: { qty: number; rate: number }[]) => r2(items.reduce((s, it) => s + it.qty * it.rate, 0));

/** "Terms: 4 lines → 6 lines" style summary for a replaced prose field. */
function proseChange(label: string, before: string | null | undefined, after: string | undefined): KV | undefined {
  if (after === undefined) return undefined;
  const b = (before ?? '').trim(), a = after.trim();
  if (b === a) return undefined;
  const n = (s: string) => s.split(/\r?\n/).filter((l) => l.trim()).length;
  return { label, value: b ? `replaced (${n(b)} → ${n(a)} line${n(a) === 1 ? '' : 's'})` : `added (${n(a)} line${n(a) === 1 ? '' : 's'})` };
}

// ── Stage: validate + preview + park as pending ─────────────────────────────

async function requireCustomer(tx: Tx, id: string) {
  const [c] = await tx.select().from(customer).where(eq(customer.id, id)).limit(1);
  if (!c) throw new Error('Couldn’t find that customer — check the name and try again.');
  return c;
}
async function requireLead(tx: Tx, id: string) {
  const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
  if (!l) throw new Error('Couldn’t find that enquiry — check the name and try again.');
  return l;
}
/** "INV/26-27/0012" for a converted-invoice id, so lock messages can name the bill. */
async function invoiceNumber(tx: Tx, id: string | null | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const [inv] = await tx.select({ number: taxInvoice.number }).from(taxInvoice).where(eq(taxInvoice.id, id)).limit(1);
  return inv?.number;
}
async function orderNumber(tx: Tx, id: string | null | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const [o] = await tx.select({ number: salesOrder.number }).from(salesOrder).where(eq(salesOrder.id, id)).limit(1);
  return o?.number;
}
const hasBill = (docNumber: string, billNumber?: string) =>
  `${docNumber} can’t be changed because a bill was already made from it${billNumber ? ` (${billNumber})` : ''}. ` +
  `Change that bill instead, or make a fresh copy of ${docNumber}.`;
const hasOrder = (docNumber: string, orderNo?: string) =>
  `${docNumber} can’t be changed because the work was already ordered${orderNo ? ` (order ${orderNo})` : ''}. ` +
  `Change that order instead, or make a fresh copy of ${docNumber} with the new prices.`;
const noChange = (what: string) => `Nothing would change — ${what} already looks like that. Tell me what to change.`;

type StageOpts = {
  /** Re-validating the user's own card edits — a no-change save is fine then. */
  restage?: boolean;
};

async function buildStage(tx: Tx, kind: string, input: Record<string, unknown>, opts: StageOpts = {}): Promise<Stage> {
  switch (kind) {
    case 'create_customer': {
      const d = parseOrThrow(customerInput, input);
      const details: KV[] = [];
      push(details, 'GST registration', d.regType === 'registered' ? 'Registered' : 'Not registered');
      push(details, 'GSTIN', d.gstin);
      push(details, 'State code', d.stateCode);
      push(details, 'Contact person', d.contactPerson);
      push(details, 'Phone', d.phone);
      push(details, 'Email', d.email);
      push(details, 'Address', d.address);
      if (d.creditTermsDays) push(details, 'Credit terms', `${d.creditTermsDays} days`);
      return { payload: d, title: `Add customer “${d.name}”`, details };
    }
    case 'update_customer': {
      const d = parseOrThrow(updateCustomerInput, input);
      const cur = await requireCustomer(tx, d.id);
      const details = diffDetails(CUSTOMER_LABELS, cur as unknown as Record<string, unknown>, d as unknown as Record<string, unknown>);
      if (!details.length && !opts.restage) throw new Error(noChange(`customer “${cur.name}”`));
      return { payload: d, title: `Edit customer “${cur.name}”`, details };
    }
    case 'delete_customer': {
      const d = parseOrThrow(idOnly, input);
      const cur = await requireCustomer(tx, d.id);
      const [nq] = await tx.select({ n: count() }).from(quotation).where(eq(quotation.customerId, d.id));
      const [ni] = await tx.select({ n: count() }).from(taxInvoice).where(eq(taxInvoice.customerId, d.id));
      const quotes = Number(nq?.n ?? 0), bills = Number(ni?.n ?? 0);
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      return {
        payload: d, title: `Delete customer “${cur.name}”`, details: [],
        warning: `This can’t be undone.${quotes + bills
          ? ` Their ${plural(quotes, 'quotation')} and ${plural(bills, 'bill')} stay, but will no longer show this customer.`
          : ''}`,
      };
    }
    case 'create_lead': {
      const d = parseOrThrow(createLeadInput, input);
      const details: KV[] = [];
      push(details, 'Source', d.source);
      push(details, 'Contact', [d.contact, d.phone].filter(Boolean).join(' · '));
      push(details, 'Requirement', d.requirement && d.requirement.length > 90 ? d.requirement.slice(0, 90) + '…' : d.requirement);
      push(details, 'Stage', LEAD_STAGE_LABELS[d.stage]);
      if (d.valueEstimate != null) push(details, 'Est. value', formatINR(d.valueEstimate));
      push(details, 'Next follow-up', d.nextFollowupAt);
      return { payload: d, title: `Add enquiry “${d.customerName}”`, details };
    }
    case 'update_lead': {
      const d = parseOrThrow(updateLeadInput, input);
      const cur = await requireLead(tx, d.id);
      const details = diffDetails(LEAD_LABELS, {
        ...cur,
        valueEstimate: cur.valueEstimate ? Number(cur.valueEstimate) : null,
        nextFollowupAt: cur.nextFollowupAt?.toISOString().slice(0, 10) ?? null,
      }, d as unknown as Record<string, unknown>);
      if (!details.length && !opts.restage) throw new Error(noChange(`enquiry “${cur.customerName}”`));
      // Show the stage as its label, not the stored key.
      const pretty = details.map((kv) => kv.label === 'Stage'
        ? { ...kv, value: kv.value.replace(/\b(new|contacted|negotiation|won|lost)\b/g, (s) => LEAD_STAGE_LABELS[s as LeadStage] ?? s) }
        : kv);
      return { payload: d, title: `Edit enquiry “${cur.customerName}”`, details: pretty };
    }
    case 'delete_lead': {
      const d = parseOrThrow(idOnly, input);
      const cur = await requireLead(tx, d.id);
      return {
        payload: d, title: `Delete enquiry “${cur.customerName}”`, details: [],
        warning: 'This can’t be undone. The enquiry and its call notes will be removed.',
      };
    }
    case 'log_lead_activity': {
      const d = parseOrThrow(logActivityInput, input);
      const cur = await requireLead(tx, d.leadId);
      return {
        payload: d, title: `Add ${withArticle(ACTIVITY_NOUN[d.type] ?? 'note')} for “${cur.customerName}”`,
        details: [{ label: 'Note', value: d.notes.length > 140 ? d.notes.slice(0, 140) + '…' : d.notes }],
      };
    }
    case 'convert_lead_to_customer': {
      const d = parseOrThrow(leadIdOnly, input);
      const cur = await requireLead(tx, d.leadId);
      if (cur.convertedCustomerId) {
        throw new Error(`“${cur.customerName}” is already a customer — open Customers to see them.`);
      }
      const details: KV[] = [];
      push(details, 'Stage', `${LEAD_STAGE_LABELS[cur.stage as LeadStage] ?? cur.stage} → Won`);
      push(details, 'Contact', [cur.contact, cur.phone].filter(Boolean).join(' · '));
      return { payload: d, title: `Add “${cur.customerName}” as a customer`, details };
    }

    // ── Quotations ──────────────────────────────────────────────────────
    case 'create_quotation': {
      const folded = foldItems(input.items, readColumns(input.columnDefs));
      const d = parseOrThrow(quotationInput, {
        ...input,
        docDate: input.docDate || todayIST(),
        terms: realNewlines(input.terms),
        notes: realNewlines(input.notes),
        items: folded.items,
        columnDefs: folded.columnDefs,
      });
      const cust = await requireCustomer(tx, d.customerId);
      const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
      const details: KV[] = [];
      push(details, 'Customer', cust.name);
      push(details, 'Date', d.docDate);
      push(details, 'Validity', `${d.validityDays} days`);
      push(details, 'GST', gstLine(interstate));
      const grand = docTotalsDetails(details, interstate, d.items);
      return {
        payload: d, title: withMoney(`New quotation for ${cust.name}`, grand), details,
        items: docItemsPreview(d.items, d.columnDefs),
        doc: { type: 'quotation', interstate, tooling: true },
      };
    }
    case 'duplicate_quotation': {
      const src = parseOrThrow(z.object({ quotationId: uuidField }), input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, src.quotationId)).limit(1);
      if (!q) throw new Error('Couldn’t find the quotation to copy — check the number and try again.');
      const current = await loadDocLines(tx, 'quotation', q.id);
      const resolved = resolveDocItems(current, q.columnDefs ?? [], input);
      const d = parseOrThrow(duplicateQuotationInput, {
        quotationId: q.id,
        customerId: input.customerId || q.customerId,
        docDate: input.docDate || todayIST(),
        validityDays: input.validityDays || q.validityDays,
        terms: input.terms !== undefined ? realNewlines(input.terms) : (q.terms ?? undefined),
        notes: input.notes !== undefined ? realNewlines(input.notes) : (q.notes ?? undefined),
        items: resolved.items,
        columnDefs: resolved.columnDefs,
      });
      const cust = await requireCustomer(tx, d.customerId);
      const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
      const details: KV[] = [];
      push(details, 'Copy of', `${q.number} (${formatINR(q.grandTotal)})`);
      push(details, 'Customer', cust.name + (d.customerId !== q.customerId ? ' (a different customer)' : ''));
      push(details, 'Date', d.docDate);
      push(details, 'Validity', `${d.validityDays} days`);
      push(details, 'GST', gstLine(interstate));
      const grand = docTotalsDetails(details, interstate, d.items);
      return {
        payload: d, title: withMoney(`New quotation for ${cust.name} — copy of ${q.number}`, grand), details,
        items: docItemsPreview(d.items, d.columnDefs), changes: resolved.changes,
        doc: { type: 'quotation', interstate, tooling: true },
      };
    }
    case 'set_quotation_status': {
      const d = parseOrThrow(quotationStatusInput, input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.id)).limit(1);
      if (!q) throw new Error('Couldn’t find that quotation — check the number and try again.');
      if (q.convertedInvoiceId) throw new Error(hasBill(q.number, await invoiceNumber(tx, q.convertedInvoiceId)));
      const from = QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status;
      const to = QUOTATION_STATUS_LABELS[d.status] ?? d.status;
      if (q.status === d.status) throw new Error(`${q.number} is already marked “${to}”.`);
      return {
        payload: d, title: `Mark quotation ${q.number} as ${to}`,
        details: [{ label: 'Status', value: `${from} → ${to}` }],
      };
    }
    case 'update_quotation': {
      const { id } = parseOrThrow(idOnly, { id: input.id });
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, id)).limit(1);
      if (!q) throw new Error('Couldn’t find that quotation — check the number and try again.');
      if (q.convertedInvoiceId) throw new Error(hasBill(q.number, await invoiceNumber(tx, q.convertedInvoiceId)));
      if (q.convertedOrderId) throw new Error(hasOrder(q.number, await orderNumber(tx, q.convertedOrderId)));
      const current = await loadDocLines(tx, 'quotation', q.id);
      const resolved = resolveDocItems(current, q.columnDefs ?? [], input);
      const d = parseOrThrow(updateQuotationDocInput, {
        id,
        docDate: input.docDate || isoDay(q.docDate),
        validityDays: input.validityDays || q.validityDays,
        terms: input.terms !== undefined ? realNewlines(input.terms) : (q.terms ?? undefined),
        notes: input.notes !== undefined ? realNewlines(input.notes) : (q.notes ?? undefined),
        items: resolved.items,
        columnDefs: resolved.columnDefs,
      });
      const details: KV[] = [];
      if (d.docDate !== isoDay(q.docDate)) push(details, 'Date', `${isoDay(q.docDate)} → ${d.docDate}`);
      if (d.validityDays !== q.validityDays) push(details, 'Validity', `${q.validityDays} → ${d.validityDays} days`);
      const t = proseChange('Terms', q.terms, d.terms); if (t) details.push(t);
      const n = proseChange('Notes', q.notes, d.notes); if (n) details.push(n);
      if (!details.length && !resolved.changes.length && !opts.restage) throw new Error(noChange(q.number));
      let grand = Number(q.grandTotal);
      if (resolved.changes.length) {
        grand = docTotalsDetails(details, q.isInterstate, d.items!);
        push(details, 'Previous total', formatINR(q.grandTotal));
      }
      return {
        payload: d, title: withMoney(`Edit quotation ${q.number}`, grand), details,
        items: docItemsPreview(d.items!, d.columnDefs), changes: resolved.changes,
        warning: resolved.replaced ? `All lines of ${q.number} will be replaced by the list shown.` : undefined,
        doc: { type: 'quotation', interstate: q.isInterstate, tooling: true, number: q.number },
      };
    }
    case 'convert_quotation_to_invoice': {
      const d = parseOrThrow(convertQuotationInput, input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.quotationId)).limit(1);
      if (!q) throw new Error('Couldn’t find that quotation — check the number and try again.');
      if (q.convertedInvoiceId) {
        const billNo = await invoiceNumber(tx, q.convertedInvoiceId);
        throw new Error(`${q.number} already has a bill${billNo ? ` (${billNo})` : ''}.`);
      }
      const cust = await requireCustomer(tx, q.customerId);
      return {
        payload: d, title: `Make a bill from ${q.number}`,
        details: [
          { label: 'Customer', value: cust.name },
          { label: 'Total', value: formatINR(q.grandTotal) },
          { label: 'Bill number', value: 'given automatically when you say yes' },
        ],
        warning: 'This creates a numbered GST bill. The number can’t be reused.',
      };
    }

    // ── Invoices ────────────────────────────────────────────────────────
    case 'create_invoice': {
      const folded = foldItems(input.items, readColumns(input.columnDefs));
      const d = parseOrThrow(invoiceInput, {
        ...input,
        docDate: input.docDate || todayIST(),
        terms: realNewlines(input.terms),
        notes: realNewlines(input.notes),
        items: folded.items,
        columnDefs: folded.columnDefs,
      });
      const cust = await requireCustomer(tx, d.customerId);
      const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
      const details: KV[] = [];
      push(details, 'Customer', cust.name);
      push(details, 'Date', d.docDate);
      push(details, 'PO number', d.poRef);
      push(details, 'GST', gstLine(interstate));
      const grand = docTotalsDetails(details, interstate, d.items);
      return {
        payload: d, title: withMoney(`New bill for ${cust.name}`, grand), details,
        items: docItemsPreview(d.items, d.columnDefs),
        warning: 'This creates a numbered GST bill. The number can’t be reused.',
        doc: { type: 'invoice', interstate, tooling: false },
      };
    }
    case 'set_invoice_status': {
      const d = parseOrThrow(invoiceStatusInput, input);
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.id)).limit(1);
      if (!inv) throw new Error('Couldn’t find that bill — check the number and try again.');
      const from = INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status;
      const to = INVOICE_STATUS_LABELS[d.status] ?? d.status;
      if (inv.status === d.status) throw new Error(`${inv.number} is already marked “${to}”.`);
      return {
        payload: d, title: `Mark bill ${inv.number} as ${to}`,
        details: [{ label: 'Status', value: `${from} → ${to}` }],
        warning: d.status === 'cancelled'
          ? `This cancels an issued GST bill (${inv.number}). Make sure it isn’t already in your GST return.`
          : undefined,
      };
    }
    case 'update_invoice': {
      const { id } = parseOrThrow(idOnly, { id: input.id });
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, id)).limit(1);
      if (!inv) throw new Error('Couldn’t find that bill — check the number and try again.');
      if (inv.status === 'cancelled') throw new Error(`${inv.number} is cancelled and can’t be changed.`);
      const current = await loadDocLines(tx, 'invoice', inv.id);
      const resolved = resolveDocItems(current, inv.columnDefs ?? [], input);
      const d = parseOrThrow(updateInvoiceDocInput, {
        id,
        docDate: input.docDate || isoDay(inv.docDate),
        poRef: input.poRef !== undefined ? input.poRef : (inv.poRef ?? undefined),
        terms: input.terms !== undefined ? realNewlines(input.terms) : (inv.terms ?? undefined),
        notes: input.notes !== undefined ? realNewlines(input.notes) : (inv.notes ?? undefined),
        items: resolved.items,
        columnDefs: resolved.columnDefs,
      });
      const details: KV[] = [];
      if (d.docDate !== isoDay(inv.docDate)) push(details, 'Date', `${isoDay(inv.docDate)} → ${d.docDate}`);
      if ((d.poRef ?? '') !== (inv.poRef ?? '')) push(details, 'PO number', `${inv.poRef || '—'} → ${d.poRef || '—'}`);
      const t = proseChange('Terms', inv.terms, d.terms); if (t) details.push(t);
      const n = proseChange('Notes', inv.notes, d.notes); if (n) details.push(n);
      if (!details.length && !resolved.changes.length && !opts.restage) throw new Error(noChange(inv.number));
      let grand = Number(inv.grandTotal);
      if (resolved.changes.length) {
        grand = docTotalsDetails(details, inv.isInterstate, d.items!);
        push(details, 'Previous total', formatINR(inv.grandTotal));
      }
      const warnings = [
        resolved.replaced ? `All lines of ${inv.number} will be replaced by the list shown.` : undefined,
        resolved.changes.length ? `This changes an issued GST bill (${inv.number}). Make sure it isn’t already in your GST return.` : undefined,
        inv.status === 'paid' && resolved.changes.length ? 'This bill is marked Paid — changing the amount may no longer match the payment received.' : undefined,
      ].filter(Boolean);
      return {
        payload: d, title: withMoney(`Edit bill ${inv.number}`, grand), details,
        items: docItemsPreview(d.items!, d.columnDefs), changes: resolved.changes,
        warning: warnings.length ? warnings.join(' ') : undefined,
        doc: { type: 'invoice', interstate: inv.isInterstate, tooling: false, number: inv.number },
      };
    }

    // ── Orders ──────────────────────────────────────────────────────────
    case 'convert_quotation_to_order': {
      const d = parseOrThrow(convertQuotationToOrderInputZ, input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.quotationId)).limit(1);
      if (!q) throw new Error('Couldn’t find that quotation — check the number and try again.');
      if (q.convertedInvoiceId) {
        const billNo = await invoiceNumber(tx, q.convertedInvoiceId);
        throw new Error(`${q.number} already has a bill${billNo ? ` (${billNo})` : ''} — an order can’t be made from it now.`);
      }
      if (q.convertedOrderId) {
        const orderNo = await orderNumber(tx, q.convertedOrderId);
        throw new Error(`${q.number} already has an order${orderNo ? ` (${orderNo})` : ''}.`);
      }
      const cust = await requireCustomer(tx, q.customerId);
      const details: KV[] = [
        { label: 'Customer', value: cust.name },
        { label: 'Order value (before GST)', value: formatINR(q.subtotal) },
      ];
      push(details, 'Category', d.orderCategory ? ORDER_CATEGORY_LABELS[d.orderCategory] : undefined);
      push(details, 'Material', d.materialOwnership ? MATERIAL_OWNERSHIP_LABELS[d.materialOwnership] : undefined);
      return { payload: d, title: `Make an order from ${q.number}`, details };
    }
    case 'convert_order_to_invoice': {
      const d = parseOrThrow(convertOrderInput, input);
      const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, d.orderId)).limit(1);
      if (!o) throw new Error('Couldn’t find that order — check the number and try again.');
      if (o.convertedInvoiceId) {
        const billNo = await invoiceNumber(tx, o.convertedInvoiceId);
        throw new Error(`${o.number} already has a bill${billNo ? ` (${billNo})` : ''}.`);
      }
      if (o.status === 'cancelled') throw new Error(`${o.number} is cancelled — no bill can be made from it.`);
      const cust = await requireCustomer(tx, o.customerId);
      return {
        payload: d, title: `Make the bill for order ${o.number}`,
        details: [
          { label: 'Customer', value: cust.name },
          { label: 'Order value (before GST)', value: formatINR(o.totalValue) },
          { label: 'Bill number', value: 'given automatically when you say yes' },
        ],
        warning: 'This creates a numbered GST bill. The number can’t be reused.',
      };
    }
    case 'create_order': {
      const folded = foldItems(input.items, readColumns(input.columnDefs));
      const d = parseOrThrow(orderInput, {
        ...input, docDate: input.docDate || todayIST(), items: folded.items, columnDefs: folded.columnDefs,
      });
      const cust = await requireCustomer(tx, d.customerId);
      const details: KV[] = [];
      push(details, 'Customer', cust.name);
      push(details, 'Date', d.docDate);
      push(details, 'Delivery date', d.deliveryDate);
      push(details, 'Category', ORDER_CATEGORY_LABELS[d.orderCategory as OrderCategory] ?? d.orderCategory);
      push(details, 'Material', MATERIAL_OWNERSHIP_LABELS[d.materialOwnership as MaterialOwnership] ?? d.materialOwnership);
      const value = orderValue(d.items);
      push(details, 'Order value (before GST)', formatINR(value));
      return {
        payload: d, title: withMoney(`New order for ${cust.name}`, value), details, items: docItemsPreview(d.items, d.columnDefs),
        doc: { type: 'order', interstate: false, tooling: false },
      };
    }
    case 'update_order': {
      const { id } = parseOrThrow(idOnly, { id: input.id });
      const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id)).limit(1);
      if (!o) throw new Error('Couldn’t find that order — check the number and try again.');
      if (o.convertedInvoiceId) throw new Error(hasBill(o.number, await invoiceNumber(tx, o.convertedInvoiceId)));
      if (o.status === 'cancelled') throw new Error(`${o.number} is cancelled and can’t be changed.`);
      const current = await loadDocLines(tx, 'order', o.id);
      const resolved = resolveDocItems(current, o.columnDefs ?? [], input);
      const curDelivery = o.deliveryDate ? isoDay(o.deliveryDate) : '';
      const d = parseOrThrow(updateOrderDocInput, {
        id,
        docDate: input.docDate || isoDay(o.docDate),
        deliveryDate: input.deliveryDate !== undefined ? input.deliveryDate : curDelivery,
        poRef: input.poRef !== undefined ? input.poRef : (o.poRef ?? undefined),
        orderCategory: input.orderCategory || o.orderCategory,
        materialOwnership: input.materialOwnership || o.materialOwnership,
        items: resolved.items,
        columnDefs: resolved.columnDefs,
      });
      const details: KV[] = [];
      if (d.docDate !== isoDay(o.docDate)) push(details, 'Date', `${isoDay(o.docDate)} → ${d.docDate}`);
      if ((d.deliveryDate ?? '') !== curDelivery) push(details, 'Delivery date', `${curDelivery || '—'} → ${d.deliveryDate || '—'}`);
      if ((d.poRef ?? '') !== (o.poRef ?? '')) push(details, 'PO number', `${o.poRef || '—'} → ${d.poRef || '—'}`);
      const catLabel = (c: string | undefined) => ORDER_CATEGORY_LABELS[c as OrderCategory] ?? c ?? '—';
      const matLabel = (m: string | undefined) => MATERIAL_OWNERSHIP_LABELS[m as MaterialOwnership] ?? m ?? '—';
      if (d.orderCategory !== o.orderCategory) push(details, 'Category', `${catLabel(o.orderCategory)} → ${catLabel(d.orderCategory)}`);
      if (d.materialOwnership !== o.materialOwnership) push(details, 'Material', `${matLabel(o.materialOwnership)} → ${matLabel(d.materialOwnership)}`);
      if (!details.length && !resolved.changes.length && !opts.restage) throw new Error(noChange(o.number));
      let value = Number(o.totalValue);
      if (resolved.changes.length) {
        value = orderValue(d.items!);
        push(details, 'Order value (before GST)', formatINR(value));
        push(details, 'Previous value', formatINR(o.totalValue));
      }
      return {
        payload: d, title: withMoney(`Edit order ${o.number}`, value), details,
        items: docItemsPreview(d.items!, d.columnDefs), changes: resolved.changes,
        warning: resolved.replaced ? `All lines of ${o.number} will be replaced by the list shown.` : undefined,
        doc: { type: 'order', interstate: false, tooling: false, number: o.number },
      };
    }
    case 'set_order_status': {
      const d = parseOrThrow(orderStatusInput, input);
      const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, d.id)).limit(1);
      if (!o) throw new Error('Couldn’t find that order — check the number and try again.');
      const from = ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status;
      const to = ORDER_STATUS_LABELS[d.status] ?? d.status;
      if (o.status === d.status) throw new Error(`${o.number} is already marked “${to}”.`);
      return {
        payload: d, title: `Mark order ${o.number} as ${to}`,
        details: [{ label: 'Status', value: `${from} → ${to}` }],
        warning: d.status === 'cancelled' ? `This cancels order ${o.number}. It can be reopened later by changing the status.` : undefined,
      };
    }

    // ── Payments / customers ────────────────────────────────────────────
    case 'record_payment': {
      const d = parseOrThrow(recordPaymentInputZ, input);
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.invoiceId)).limit(1);
      if (!inv) throw new Error('Couldn’t find that bill — check the number and try again.');
      if (inv.status === 'cancelled') throw new Error(`${inv.number} is cancelled — no payment can be recorded on it.`);
      const [agg] = await tx.select({ received: sum(payment.amount) }).from(payment).where(eq(payment.invoiceId, d.invoiceId));
      const outstanding = r2(Number(inv.grandTotal) - Number(agg?.received ?? 0));
      if (d.amount > outstanding + 0.5) throw new Error(`That’s more than the ${formatINR(outstanding)} still due on ${inv.number}.`);
      const details: KV[] = [
        { label: 'Bill', value: `${inv.number} · ${formatINR(outstanding)} still due` },
        { label: 'Payment method', value: PAYMENT_METHOD_LABELS[(d.method ?? 'bank') as PaymentMethod] ?? d.method ?? 'Bank transfer' },
        { label: 'Payment date', value: d.paidOn ?? todayIST() },
        { label: 'Still due after this', value: formatINR(r2(outstanding - d.amount)) },
      ];
      push(details, 'Reference', d.reference);
      return { payload: d, title: `${formatINR(d.amount)} received against ${inv.number}`, details };
    }
    case 'delete_payment': {
      const d = parseOrThrow(paymentIdOnly, input);
      const [p] = await tx.select().from(payment).where(eq(payment.id, d.id)).limit(1);
      if (!p) throw new Error('Couldn’t find that payment — check the bill and try again.');
      const [inv] = await tx.select({ number: taxInvoice.number }).from(taxInvoice).where(eq(taxInvoice.id, p.invoiceId)).limit(1);
      return {
        payload: d, title: `Remove the ${formatINR(p.amount)} payment from ${inv?.number ?? 'the bill'}`,
        details: [{ label: 'Payment date', value: p.paidOn.toISOString().slice(0, 10) }],
        warning: `That ${formatINR(p.amount)} will show as due again.`,
      };
    }
    case 'set_customer_status': {
      const d = parseOrThrow(customerStatusInput, input);
      const cur = await requireCustomer(tx, d.id);
      const label = (s: string) => (s === 'archived' ? 'Archived' : 'Active');
      if (cur.status === d.status) throw new Error(`“${cur.name}” is already ${label(d.status).toLowerCase()}.`);
      return {
        payload: d, title: `${d.status === 'archived' ? 'Archive' : 'Restore'} customer “${cur.name}”`,
        details: [{ label: 'Status', value: `${label(cur.status)} → ${label(d.status)}` }],
        warning: d.status === 'archived' ? 'Archived customers are hidden from lists. You can restore them any time.' : undefined,
      };
    }
    default:
      throw new Error('I can’t do that one yet.');
  }
}

export async function stageAction(
  user: CurrentUser,
  kind: string,
  input: Record<string, unknown>,
): Promise<StageResult> {
  try {
    return await withTenant(user.tenantId, user.userId, async (tx) => {
      const staged = await buildStage(tx, kind, input);
      // One pending proposal per user — a new one supersedes the old.
      await tx.update(aiAction)
        .set({ status: 'cancelled', error: 'superseded', decidedAt: new Date() })
        .where(and(eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending')));
      const [row] = await tx.insert(aiAction).values({
        tenantId: user.tenantId, userId: user.userId, kind,
        payload: staged.payload, summary: staged.title,
        expiresAt: new Date(Date.now() + EXPIRE_MINUTES * 60_000),
      }).returning({ id: aiAction.id });
      const spec = editableFor(kind, staged.payload);
      const action: StagedAction = {
        actionId: row!.id, kind, title: staged.title, details: staged.details,
        items: staged.items, changes: staged.changes, warning: staged.warning, doc: staged.doc,
        editable: spec?.fields,
        payload: spec ? (staged.payload as Record<string, unknown>) : undefined,
        editItems: spec?.items,
      };
      return { ok: true as const, action };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Couldn’t prepare that — please try again.' };
  }
}

// ── get_document: a full, line-numbered snapshot for the model ──────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

type DocRow = {
  id: string; number: string; docDate: Date; customerId: string; status: string; columnDefs: ColumnDef[] | null;
  isInterstate?: boolean; subtotal?: string; cgst?: string; sgst?: string; igst?: string; grandTotal?: string;
  validityDays?: number; terms?: string | null; notes?: string | null;
  convertedInvoiceId?: string | null; convertedOrderId?: string | null;
  dueDate?: Date | null; poRef?: string | null; quotationId?: string | null; orderId?: string | null;
  deliveryDate?: Date | null; orderCategory?: string; materialOwnership?: string; totalValue?: string;
};

async function findDoc(tx: Tx, kind: DocKind, input: GetDocumentInput): Promise<DocRow | { error: string }> {
  const table = kind === 'quotation' ? quotation : kind === 'invoice' ? taxInvoice : salesOrder;
  const label = kind === 'invoice' ? 'invoice' : kind === 'order' ? 'sales order' : 'quotation';
  const id = (input.id ?? '').trim();
  if (id) {
    if (!UUID_RE.test(id)) return { error: `"${id}" is not a uuid — pass the number instead, or look the uuid up with a query.` };
    const [row] = await tx.select().from(table).where(eq(table.id, id)).limit(1);
    return row ? (row as DocRow) : { error: `No ${label} with id ${id}.` };
  }
  const number = (input.number ?? '').trim();
  if (!number) return { error: 'Pass either the uuid (id) or the document number.' };
  const rows = await tx.select({ id: table.id, number: table.number, docDate: table.docDate, customerId: table.customerId })
    .from(table).where(ilike(table.number, `%${likeEscape(number)}%`)).orderBy(desc(table.docDate)).limit(8);
  if (!rows.length) return { error: `No ${label} number matches "${number}". Ask the user for the number, or find it with a query (e.g. latest ${label}s for the customer).` };
  const exact = rows.find((r) => r.number.toLowerCase() === number.toLowerCase());
  const pick = exact ?? (rows.length === 1 ? rows[0] : undefined);
  if (!pick) {
    const custs = await tx.select({ id: customer.id, name: customer.name }).from(customer);
    const nameOf = new Map(custs.map((c) => [c.id, c.name]));
    const list = rows.map((r) => `${r.number} (${isoDay(r.docDate)}, ${nameOf.get(r.customerId) ?? '—'}, id ${r.id})`).join('; ');
    return { error: `"${number}" matches several ${label}s — ask the user which one, or pass the id: ${list}` };
  }
  const [row] = await tx.select().from(table).where(eq(table.id, pick.id)).limit(1);
  return row as DocRow;
}

/**
 * Read one document for the assistant: header, customer, the lines numbered
 * exactly as printed (with its part + detail / specs by NAME / one-time flag),
 * totals, prose and lock state. Read-only; RLS scopes it to the tenant.
 */
export async function getDocumentSnapshot(user: CurrentUser, input: GetDocumentInput): Promise<GetDocumentResult> {
  const kind = input.type === 'invoice' ? 'invoice' : input.type === 'order' ? 'order' : input.type === 'quotation' ? 'quotation' : undefined;
  if (!kind) return { ok: false, error: 'type must be quotation, invoice or order.' };
  try {
    return await withTenant(user.tenantId, user.userId, async (tx) => {
      const row = await findDoc(tx, kind, input);
      if ('error' in row) return { ok: false as const, error: row.error };
      const [cust] = await tx.select({ id: customer.id, name: customer.name, stateCode: customer.stateCode, gstin: customer.gstin, creditTermsDays: customer.creditTermsDays })
        .from(customer).where(eq(customer.id, row.customerId)).limit(1);
      const lines = await loadDocLines(tx, kind, row.id);
      const columns = row.columnDefs ?? [];
      const labelOf = new Map(columns.map((c) => [c.id, c.label]));
      const tableColIds = new Set(splitColumns(columns).tableCols.map((c) => c.id));

      const numbered = lines.map((l, i) => ({
        line: i + 1,
        description: l.description, hsn: l.hsn ?? '', qty: l.qty, uom: l.uom, rate: l.rate, gstRate: l.gstRate,
        amount: r2(l.qty * l.rate),
        part: l.groupLabel ?? null,
        ...(kind === 'quotation' ? { isToolingCharge: !!l.isToolingCharge } : {}),
        specs: Object.fromEntries(Object.entries(l.attributes).map(([k, v]) => [labelOf.get(k) ?? k, v])),
      }));
      // Parts as printed: heading, its detail, which lines belong to it, subtotal.
      const parts: { name: string; detail: string | null; lines: number[]; subtotal: number }[] = [];
      lines.forEach((l, i) => {
        const name = (l.groupLabel ?? '').trim();
        if (!name) return;
        const last = parts[parts.length - 1];
        const amount = r2(l.qty * l.rate);
        if (last && last.name === name) {
          last.lines.push(i + 1);
          last.subtotal = r2(last.subtotal + amount);
          if (!last.detail && (l.groupNote ?? '').trim()) last.detail = l.groupNote!.trim();
        } else {
          parts.push({ name, detail: (l.groupNote ?? '').trim() || null, lines: [i + 1], subtotal: amount });
        }
      });

      const base: Record<string, unknown> = {
        type: kind, id: row.id, number: row.number, status: row.status, docDate: isoDay(row.docDate),
        customer: cust ? { id: cust.id, name: cust.name, stateCode: cust.stateCode, gstin: cust.gstin } : null,
        fields: columns.map((c) => ({
          name: c.label,
          shownAs: tableColIds.has(c.id) ? 'column' : 'under the item',
        })),
        lineCount: numbered.length,
        lines: numbered,
        parts,
        terms: row.terms ?? '',
        notes: row.notes ?? '',
      };

      if (kind === 'order') {
        const locked = !!row.convertedInvoiceId || row.status === 'cancelled';
        return {
          ok: true as const,
          document: {
            ...base,
            poRef: row.poRef ?? '', deliveryDate: row.deliveryDate ? isoDay(row.deliveryDate) : '',
            orderCategory: row.orderCategory, materialOwnership: row.materialOwnership,
            totals: { orderValueExGst: Number(row.totalValue ?? 0) },
            quotationId: row.quotationId ?? null, convertedInvoiceId: row.convertedInvoiceId ?? null,
            locked, lockedReason: locked ? (row.convertedInvoiceId ? 'already invoiced' : 'cancelled') : null,
            note: 'Line numbers are the printed S.No — use them in `edits` (update_order). Totals are ex-GST; GST is finalised when invoiced.',
          },
        };
      }

      const totals = {
        taxType: row.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)',
        taxable: Number(row.subtotal ?? 0), cgst: Number(row.cgst ?? 0), sgst: Number(row.sgst ?? 0), igst: Number(row.igst ?? 0),
        grandTotal: Number(row.grandTotal ?? 0),
      };

      if (kind === 'quotation') {
        const locked = !!row.convertedInvoiceId || !!row.convertedOrderId;
        return {
          ok: true as const,
          document: {
            ...base,
            validityDays: row.validityDays,
            validUntil: isoDay(new Date(row.docDate.getTime() + (row.validityDays ?? 0) * 86_400_000)),
            totals,
            convertedOrderId: row.convertedOrderId ?? null, convertedInvoiceId: row.convertedInvoiceId ?? null,
            locked, lockedReason: locked ? (row.convertedInvoiceId ? 'converted to an invoice' : 'converted to a sales order') : null,
            note: 'Line numbers are the printed S.No — use them in `edits` (update_quotation / duplicate_quotation). Tooling/NRE lines are one-time charges.',
          },
        };
      }

      const [agg] = await tx.select({ received: sum(payment.amount) }).from(payment).where(eq(payment.invoiceId, row.id));
      const received = Number(agg?.received ?? 0);
      const locked = row.status === 'cancelled';
      return {
        ok: true as const,
        document: {
          ...base,
          dueDate: row.dueDate ? isoDay(row.dueDate) : null, poRef: row.poRef ?? '',
          totals,
          received, outstanding: r2(totals.grandTotal - received),
          quotationId: row.quotationId ?? null, orderId: row.orderId ?? null,
          locked, lockedReason: locked ? 'cancelled' : null,
          note: 'Line numbers are the printed S.No — use them in `edits` (update_invoice). Paid/partly-paid is derived from recorded payments.',
        },
      };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the document.' };
  }
}

// ── Execute / cancel (called from the confirmation UI) ──────────────────────

export type ExecResult =
  | { ok: true; message: string; entity?: { type: string; id: string }; path?: string; printPath?: string }
  | { ok: false; error: string };

type Performed = {
  message: string;
  entity?: { type: string; id: string };
  /** In-app page to open ("Open quotation →"). */
  path?: string;
  /** Print/PDF page for quotations and bills — the card renders it as a second link. */
  printPath?: string;
  revalidate: string[];
};

/** "Contact person, Credit terms (days)" — changed fields by their labels, never camelCase keys. */
const changedLabels = (keys: string[], labels: Record<string, string>) => keys.map((k) => labels[k] ?? k).join(', ');

async function performAction(tx: Tx, u: U, kind: string, payload: unknown): Promise<Performed> {
  switch (kind) {
    case 'create_customer': {
      const d = customerInput.parse(payload);
      const [c] = await tx.insert(customer).values({
        tenantId: u.tenantId, name: d.name, regType: d.regType, gstin: d.gstin, stateCode: d.stateCode,
        contactPerson: d.contactPerson, phone: d.phone, email: d.email, address: d.address,
        creditTermsDays: d.creditTermsDays,
      }).returning({ id: customer.id });
      return {
        message: `Customer “${d.name}” added.`,
        entity: { type: 'customer', id: c!.id }, path: `/customers/${c!.id}`,
        revalidate: ['/customers', '/dashboard'],
      };
    }
    case 'update_customer': {
      const { id, ...rest } = updateCustomerInput.parse(payload);
      const cur = await requireCustomer(tx, id);
      const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length) {
        await tx.update(customer).set({ ...set, updatedAt: new Date() }).where(eq(customer.id, id));
      }
      const changed = Object.keys(set);
      return {
        message: changed.length
          ? `Customer “${cur.name}” updated (${changedLabels(changed, CUSTOMER_LABELS)}).`
          : `Customer “${cur.name}” saved — nothing changed.`,
        entity: { type: 'customer', id }, path: `/customers/${id}`,
        revalidate: ['/customers', `/customers/${id}`, '/dashboard'],
      };
    }
    case 'delete_customer': {
      const d = idOnly.parse(payload);
      const cur = await requireCustomer(tx, d.id);
      await tx.delete(customer).where(eq(customer.id, d.id));
      return {
        message: `Customer “${cur.name}” deleted.`, path: '/customers',
        revalidate: ['/customers', '/dashboard'],
      };
    }
    case 'create_lead': {
      const d = createLeadInput.parse(payload);
      const l = await createLeadRecord(tx, u.tenantId, { ...d, ownerUserId: u.userId });
      return {
        message: `Enquiry “${d.customerName}” added${d.stage !== 'new' ? ` (${LEAD_STAGE_LABELS[d.stage] ?? d.stage})` : ''}.`,
        entity: { type: 'lead', id: l.id }, path: `/leads/${l.id}`,
        revalidate: ['/leads', '/dashboard'],
      };
    }
    case 'update_lead': {
      const { id, nextFollowupAt, valueEstimate, ...rest } = updateLeadInput.parse(payload);
      const cur = await requireLead(tx, id);
      const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (valueEstimate !== undefined) set.valueEstimate = String(valueEstimate);
      if (nextFollowupAt !== undefined) set.nextFollowupAt = new Date(nextFollowupAt);
      const changed = Object.keys(set);
      if (changed.length) {
        await tx.update(lead).set({ ...set, updatedAt: new Date() }).where(eq(lead.id, id));
      }
      return {
        message: changed.length
          ? `Enquiry “${cur.customerName}” updated (${changedLabels(changed, LEAD_LABELS)}).`
          : `Enquiry “${cur.customerName}” saved — nothing changed.`,
        entity: { type: 'lead', id }, path: `/leads/${id}`,
        revalidate: ['/leads', `/leads/${id}`, '/dashboard'],
      };
    }
    case 'delete_lead': {
      const d = idOnly.parse(payload);
      const cur = await requireLead(tx, d.id);
      await tx.delete(leadActivity).where(eq(leadActivity.leadId, d.id));
      await tx.delete(lead).where(eq(lead.id, d.id));
      return {
        message: `Enquiry “${cur.customerName}” deleted.`, path: '/leads',
        revalidate: ['/leads', '/dashboard'],
      };
    }
    case 'log_lead_activity': {
      const d = logActivityInput.parse(payload);
      const cur = await requireLead(tx, d.leadId);
      await tx.insert(leadActivity).values({
        tenantId: u.tenantId, leadId: d.leadId, type: d.type, notes: d.notes, byUserId: u.userId,
      });
      const noun = ACTIVITY_NOUN[d.type] ?? 'note';
      return {
        message: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} added for “${cur.customerName}”.`,
        entity: { type: 'lead', id: d.leadId }, path: `/leads/${d.leadId}`,
        revalidate: ['/leads', `/leads/${d.leadId}`],
      };
    }
    case 'convert_lead_to_customer': {
      const d = leadIdOnly.parse(payload);
      const cur = await requireLead(tx, d.leadId);
      if (cur.convertedCustomerId) {
        return {
          message: `“${cur.customerName}” was already a customer — nothing changed.`,
          entity: { type: 'customer', id: cur.convertedCustomerId }, path: `/customers/${cur.convertedCustomerId}`,
          revalidate: ['/leads', '/customers'],
        };
      }
      const [c] = await tx.insert(customer).values({
        tenantId: u.tenantId, name: cur.customerName, contactPerson: cur.contact,
        phone: cur.phone, email: cur.email,
      }).returning({ id: customer.id });
      await tx.update(lead)
        .set({ stage: 'won', convertedCustomerId: c!.id, updatedAt: new Date() })
        .where(eq(lead.id, d.leadId));
      return {
        message: `“${cur.customerName}” added as a customer — the enquiry is marked Won.`,
        entity: { type: 'customer', id: c!.id }, path: `/customers/${c!.id}`,
        revalidate: ['/leads', '/customers', '/dashboard'],
      };
    }
    case 'create_quotation': {
      const d = quotationInput.parse(payload);
      const created = await insertQuotationTx(tx, u, d);
      return {
        message: `Quotation ${created.number} saved — ${formatINR(created.grand)} with GST.`,
        entity: { type: 'quotation', id: created.id }, path: `/quotations/${created.id}`,
        printPath: `/print/quotation/${created.id}`,
        revalidate: ['/quotations', `/quotations/${created.id}`, '/dashboard'],
      };
    }
    case 'duplicate_quotation': {
      const { quotationId, ...d } = duplicateQuotationInput.parse(payload);
      const [src] = await tx.select({ number: quotation.number }).from(quotation).where(eq(quotation.id, quotationId)).limit(1);
      const created = await insertQuotationTx(tx, u, d);
      return {
        message: `Quotation ${created.number} saved as a copy of ${src?.number ?? 'the original'} — ${formatINR(created.grand)} with GST.`,
        entity: { type: 'quotation', id: created.id }, path: `/quotations/${created.id}`,
        printPath: `/print/quotation/${created.id}`,
        revalidate: ['/quotations', `/quotations/${created.id}`, '/dashboard'],
      };
    }
    case 'set_quotation_status': {
      const d = quotationStatusInput.parse(payload);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.id)).limit(1);
      if (!q) throw new Error('Couldn’t find that quotation.');
      if (q.convertedInvoiceId) throw new Error(hasBill(q.number, await invoiceNumber(tx, q.convertedInvoiceId)));
      await tx.update(quotation).set({ status: d.status, updatedAt: new Date() }).where(eq(quotation.id, d.id));
      return {
        message: `Quotation ${q.number} marked “${QUOTATION_STATUS_LABELS[d.status] ?? d.status}”.`,
        entity: { type: 'quotation', id: d.id }, path: `/quotations/${d.id}`,
        revalidate: ['/quotations', `/quotations/${d.id}`, '/dashboard'],
      };
    }
    case 'update_quotation': {
      const { id, ...rest } = updateQuotationDocInput.parse(payload);
      const res = await updateQuotationTx(tx, u, id, rest);
      return {
        message: `Quotation ${res.number} saved — ${formatINR(res.grand)} with GST.`,
        entity: { type: 'quotation', id }, path: `/quotations/${id}`,
        printPath: `/print/quotation/${id}`,
        revalidate: ['/quotations', `/quotations/${id}`, '/dashboard'],
      };
    }
    case 'update_invoice': {
      const { id, ...rest } = updateInvoiceDocInput.parse(payload);
      const res = await updateInvoiceTx(tx, u, id, rest);
      return {
        message: `Bill ${res.number} saved — ${formatINR(res.grand)} with GST.`,
        entity: { type: 'invoice', id }, path: `/invoices/${id}`,
        printPath: `/print/invoice/${id}`,
        revalidate: ['/invoices', `/invoices/${id}`, '/dashboard'],
      };
    }
    case 'update_order': {
      const { id, ...rest } = updateOrderDocInput.parse(payload);
      const res = await updateOrderTx(tx, u, id, rest);
      return {
        message: `Order ${res.number} saved — ${formatINR(res.total)} before GST.`,
        entity: { type: 'order', id }, path: `/orders/${id}`,
        revalidate: ['/orders', `/orders/${id}`, '/dashboard'],
      };
    }
    case 'convert_quotation_to_invoice': {
      const d = convertQuotationInput.parse(payload);
      const res = await convertQuotationTx(tx, u, d.quotationId);
      return {
        message: res.existing
          ? `This quotation already had a bill — ${res.number}.`
          : `Bill ${res.number} made from the quotation.`,
        entity: { type: 'invoice', id: res.invoiceId }, path: `/invoices/${res.invoiceId}`,
        printPath: `/print/invoice/${res.invoiceId}`,
        revalidate: ['/quotations', `/quotations/${d.quotationId}`, '/invoices', `/invoices/${res.invoiceId}`, '/dashboard'],
      };
    }
    case 'create_invoice': {
      const d = invoiceInput.parse(payload);
      const created = await insertInvoiceTx(tx, u, d);
      return {
        message: `Bill ${created.number} saved — ${formatINR(created.grand)} with GST.`,
        entity: { type: 'invoice', id: created.id }, path: `/invoices/${created.id}`,
        printPath: `/print/invoice/${created.id}`,
        revalidate: ['/invoices', `/invoices/${created.id}`, '/dashboard'],
      };
    }
    case 'set_invoice_status': {
      const d = invoiceStatusInput.parse(payload);
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.id)).limit(1);
      if (!inv) throw new Error('Couldn’t find that bill.');
      await tx.update(taxInvoice).set({ status: d.status, updatedAt: new Date() }).where(eq(taxInvoice.id, d.id));
      return {
        message: `Bill ${inv.number} marked “${INVOICE_STATUS_LABELS[d.status] ?? d.status}”.`,
        entity: { type: 'invoice', id: d.id }, path: `/invoices/${d.id}`,
        revalidate: ['/invoices', `/invoices/${d.id}`, '/dashboard'],
      };
    }
    case 'convert_quotation_to_order': {
      const d = convertQuotationToOrderInputZ.parse(payload);
      const res = await convertQuotationToOrderTx(tx, u, d.quotationId, {
        orderCategory: d.orderCategory, materialOwnership: d.materialOwnership,
      });
      return {
        message: res.existing ? `This quotation already had an order — ${res.number}.` : `Order ${res.number} made from the quotation.`,
        entity: { type: 'order', id: res.orderId }, path: `/orders/${res.orderId}`,
        revalidate: ['/orders', `/orders/${res.orderId}`, '/quotations', `/quotations/${d.quotationId}`, '/dashboard'],
      };
    }
    case 'convert_order_to_invoice': {
      const d = convertOrderInput.parse(payload);
      const res = await convertOrderToInvoiceTx(tx, u, d.orderId);
      return {
        message: res.existing ? `This order already had a bill — ${res.number}.` : `Bill ${res.number} made from the order.`,
        entity: { type: 'invoice', id: res.invoiceId }, path: `/invoices/${res.invoiceId}`,
        printPath: `/print/invoice/${res.invoiceId}`,
        revalidate: ['/orders', `/orders/${d.orderId}`, '/invoices', `/invoices/${res.invoiceId}`, '/dashboard'],
      };
    }
    case 'record_payment': {
      const d = recordPaymentInputZ.parse(payload);
      await recordPaymentTx(tx, u, {
        invoiceId: d.invoiceId, amount: d.amount, paidOn: d.paidOn ?? todayIST(),
        method: d.method ?? 'bank', reference: d.reference,
      });
      const [inv] = await tx.select({ number: taxInvoice.number, grandTotal: taxInvoice.grandTotal })
        .from(taxInvoice).where(eq(taxInvoice.id, d.invoiceId)).limit(1);
      const [agg] = await tx.select({ received: sum(payment.amount) }).from(payment).where(eq(payment.invoiceId, d.invoiceId));
      const due = inv ? r2(Number(inv.grandTotal) - Number(agg?.received ?? 0)) : undefined;
      return {
        message: due === undefined ? `${formatINR(d.amount)} received.`
          : due <= 0.5 ? `${formatINR(d.amount)} received · ${inv!.number} fully paid ✓`
          : `${formatINR(d.amount)} received · ${formatINR(due)} still due on ${inv!.number}.`,
        entity: { type: 'invoice', id: d.invoiceId }, path: `/invoices/${d.invoiceId}`,
        revalidate: ['/invoices', `/invoices/${d.invoiceId}`, '/dashboard'],
      };
    }
    case 'delete_payment': {
      const d = paymentIdOnly.parse(payload);
      const [p] = await tx.select().from(payment).where(eq(payment.id, d.id)).limit(1);
      if (!p) throw new Error('Couldn’t find that payment.');
      await deletePaymentTx(tx, u, d.id);
      return {
        message: `The ${formatINR(p.amount)} payment was removed — that amount shows as due again.`,
        entity: { type: 'invoice', id: p.invoiceId }, path: `/invoices/${p.invoiceId}`,
        revalidate: ['/invoices', `/invoices/${p.invoiceId}`, '/dashboard'],
      };
    }
    case 'create_order': {
      const d = orderInput.parse(payload);
      const created = await insertOrderTx(tx, u, d);
      return {
        message: `Order ${created.number} saved — ${formatINR(created.total)} before GST.`,
        entity: { type: 'order', id: created.id }, path: `/orders/${created.id}`,
        revalidate: ['/orders', `/orders/${created.id}`, '/dashboard'],
      };
    }
    case 'set_order_status': {
      const d = orderStatusInput.parse(payload);
      const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, d.id)).limit(1);
      if (!o) throw new Error('Couldn’t find that order.');
      await tx.update(salesOrder).set({ status: d.status, updatedAt: new Date() }).where(eq(salesOrder.id, d.id));
      return {
        message: `Order ${o.number} marked “${ORDER_STATUS_LABELS[d.status] ?? d.status}”.`,
        entity: { type: 'order', id: d.id }, path: `/orders/${d.id}`,
        revalidate: ['/orders', `/orders/${d.id}`, '/dashboard'],
      };
    }
    case 'set_customer_status': {
      const d = customerStatusInput.parse(payload);
      const cur = await requireCustomer(tx, d.id);
      await tx.update(customer).set({ status: d.status, updatedAt: new Date() }).where(eq(customer.id, d.id));
      return {
        message: `Customer “${cur.name}” ${d.status === 'archived' ? 'archived' : 'restored'}.`,
        entity: { type: 'customer', id: d.id }, path: `/customers/${d.id}`,
        revalidate: ['/customers', `/customers/${d.id}`, '/dashboard'],
      };
    }
    default:
      throw new Error('I can’t do that one yet.');
  }
}

export async function executeAction(user: CurrentUser, actionId: string, edited?: Record<string, unknown>): Promise<ExecResult> {
  let performed: Performed;
  try {
    performed = await withTenant(user.tenantId, user.userId, async (tx) => {
      // Atomic claim — a double-click or second tab cannot execute twice.
      const claimed = await tx.update(aiAction)
        .set({ status: 'executed', decidedAt: new Date() })
        .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending')))
        .returning({ kind: aiAction.kind, payload: aiAction.payload, expiresAt: aiAction.expiresAt });
      const row = claimed[0];
      const stale = 'This card has expired or was already used — ask again and I’ll make a fresh one.';
      if (!row) throw new Error(stale);
      if (row.expiresAt.getTime() < Date.now()) throw new Error(stale);
      let payload = row.payload;
      // The user edited the proposal on the card — re-validate their input through
      // the SAME staging pipeline (zod + business checks) before executing.
      if (edited && editableFor(row.kind, row.payload)) {
        const restaged = await buildStage(tx, row.kind, edited, { restage: true });
        payload = restaged.payload as typeof row.payload;
        await tx.update(aiAction).set({ payload, summary: restaged.title }).where(eq(aiAction.id, actionId));
      }
      const out = await performAction(tx, user, row.kind, payload);
      await tx.update(aiAction).set({ result: out }).where(eq(aiAction.id, actionId));
      return out;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Something went wrong on our side. Please try again — if it keeps happening, tell the owner.';
    // The transaction rolled back (row is pending again) — record the failure.
    await withTenant(user.tenantId, user.userId, (tx) =>
      tx.update(aiAction)
        .set({ status: 'failed', error: msg, decidedAt: new Date() })
        .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending'))),
    ).catch(() => { /* best-effort */ });
    return { ok: false, error: msg };
  }
  for (const p of performed.revalidate) revalidatePath(p);
  return { ok: true, message: performed.message, entity: performed.entity, path: performed.path, printPath: performed.printPath };
}

export async function cancelAction(user: CurrentUser, actionId: string): Promise<void> {
  await withTenant(user.tenantId, user.userId, (tx) =>
    tx.update(aiAction)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending'))),
  );
}
