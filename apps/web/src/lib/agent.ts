import 'server-only';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  computeGst, isInterstate, formatINR,
  customerInput, leadInput, quotationInput, invoiceInput,
  INVOICE_STATUSES, LEAD_ACTIVITY_TYPES, LEAD_STAGE_LABELS, QUOTATION_SETTABLE_STATUSES,
  type LeadStage,
} from '@ms/core';
import {
  withTenant, aiAction, customer, lead, leadActivity, quotation, taxInvoice,
  and, count, eq, type Tx,
} from '@ms/db';
import type { StageResult, StagedAction } from '@ms/ai';
import type { CurrentUser } from './auth';
import { convertQuotationTx, getSupplierStateCode, insertInvoiceTx, insertQuotationTx } from './documents';

// The AI agent's write path (docs/05 §5 human-in-the-loop). `stageAction`
// validates a proposed write and parks it as a pending `ai_action` row with a
// human-readable preview; nothing touches business tables until the user
// confirms and `executeAction` runs it — with the same zod validation, RBAC
// and RLS as the manual forms. Every proposal/decision stays as audit trail.

const EXPIRE_MINUTES = 30;
const MAX_AI_ITEMS = 20;

type U = Pick<CurrentUser, 'tenantId' | 'userId'>;

// ── Input schemas (model payloads re-validated server-side) ─────────────────

const uuidField = z.string().uuid('Not a valid uuid — copy it from a query result');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

const leadExtras = { nextFollowupAt: dateOnly.optional() };
const createLeadInput = leadInput.extend(leadExtras);
const updateCustomerInput = customerInput.partial().extend({ id: uuidField });
const updateLeadInput = leadInput.extend(leadExtras).partial().extend({ id: uuidField });
const idOnly = z.object({ id: uuidField });
const leadIdOnly = z.object({ leadId: uuidField });
const logActivityInput = z.object({
  leadId: uuidField,
  type: z.enum(LEAD_ACTIVITY_TYPES).default('note'),
  notes: z.string().trim().min(1, 'Notes are required').max(2000),
});
const quotationStatusInput = z.object({ id: uuidField, status: z.enum(QUOTATION_SETTABLE_STATUSES) });
const invoiceStatusInput = z.object({ id: uuidField, status: z.enum(INVOICE_STATUSES) });
const convertQuotationInput = z.object({ quotationId: uuidField });

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Models sometimes emit literal "\n" sequences in multi-line fields — make them real. */
const realNewlines = (v: unknown) => (typeof v === 'string' ? v.replace(/\\n/g, '\n') : v);

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid input'}`);
  }
  return parsed.data;
}

// ── Preview helpers ─────────────────────────────────────────────────────────

type KV = { label: string; value: string };
type Stage = { payload: unknown; title: string; details: KV[]; items?: string[]; warning?: string };

const push = (details: KV[], label: string, value: string | number | null | undefined) => {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    details.push({ label, value: String(value) });
  }
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const CUSTOMER_LABELS: Record<string, string> = {
  name: 'Name', regType: 'GST reg. type', gstin: 'GSTIN', stateCode: 'State code',
  contactPerson: 'Contact person', phone: 'Phone', email: 'Email', address: 'Address',
  creditTermsDays: 'Credit terms (days)',
};
const LEAD_LABELS: Record<string, string> = {
  customerName: 'Customer', contact: 'Contact', phone: 'Phone', email: 'Email', source: 'Source',
  requirement: 'Requirement', stage: 'Stage', valueEstimate: 'Est. value (₹)', nextFollowupAt: 'Next follow-up',
};

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

function docItemsPreview(items: { description: string; qty: number; uom: string; rate: number; isToolingCharge?: boolean }[]): string[] {
  return items.map((it, i) =>
    `${i + 1}. ${it.description} — ${it.qty} ${it.uom} × ${formatINR(it.rate)} = ${formatINR(r2(it.qty * it.rate))}${it.isToolingCharge ? ' · tooling/NRE' : ''}`,
  );
}

function docTotalsDetails(details: KV[], interstate: boolean, items: { qty: number; rate: number; gstRate: number }[]) {
  const totals = computeGst(items, interstate);
  push(details, 'Taxable', formatINR(totals.subtotal));
  if (interstate) push(details, 'IGST', formatINR(totals.igst));
  else push(details, 'CGST + SGST', `${formatINR(totals.cgst)} + ${formatINR(totals.sgst)}`);
  push(details, 'Grand total', formatINR(totals.grand));
}

// ── Stage: validate + preview + park as pending ─────────────────────────────

async function requireCustomer(tx: Tx, id: string) {
  const [c] = await tx.select().from(customer).where(eq(customer.id, id)).limit(1);
  if (!c) throw new Error('Customer not found — look the uuid up with a query first.');
  return c;
}
async function requireLead(tx: Tx, id: string) {
  const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
  if (!l) throw new Error('Lead not found — look the uuid up with a query first.');
  return l;
}

async function buildStage(tx: Tx, kind: string, input: Record<string, unknown>): Promise<Stage> {
  switch (kind) {
    case 'create_customer': {
      const d = parseOrThrow(customerInput, input);
      const details: KV[] = [];
      push(details, 'GST reg. type', d.regType);
      push(details, 'GSTIN', d.gstin);
      push(details, 'State code', d.stateCode);
      push(details, 'Contact', d.contactPerson);
      push(details, 'Phone', d.phone);
      push(details, 'Email', d.email);
      push(details, 'Address', d.address);
      if (d.creditTermsDays) push(details, 'Credit terms', `${d.creditTermsDays} days`);
      return { payload: d, title: `Create customer “${d.name}”`, details };
    }
    case 'update_customer': {
      const d = parseOrThrow(updateCustomerInput, input);
      const cur = await requireCustomer(tx, d.id);
      const details = diffDetails(CUSTOMER_LABELS, cur as unknown as Record<string, unknown>, d as unknown as Record<string, unknown>);
      if (!details.length) throw new Error('No changes — every provided field already has that value.');
      return { payload: d, title: `Update customer “${cur.name}”`, details };
    }
    case 'delete_customer': {
      const d = parseOrThrow(idOnly, input);
      const cur = await requireCustomer(tx, d.id);
      const [nq] = await tx.select({ n: count() }).from(quotation).where(eq(quotation.customerId, d.id));
      const [ni] = await tx.select({ n: count() }).from(taxInvoice).where(eq(taxInvoice.customerId, d.id));
      const docs = Number(nq?.n ?? 0) + Number(ni?.n ?? 0);
      return {
        payload: d, title: `Delete customer “${cur.name}”`, details: [],
        warning: `Permanent — this cannot be undone.${docs ? ` ${Number(nq?.n ?? 0)} quotation(s) and ${Number(ni?.n ?? 0)} invoice(s) will keep their data but lose the customer link.` : ''}`,
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
      return { payload: d, title: `Record lead “${d.customerName}”`, details };
    }
    case 'update_lead': {
      const d = parseOrThrow(updateLeadInput, input);
      const cur = await requireLead(tx, d.id);
      const details = diffDetails(LEAD_LABELS, {
        ...cur,
        valueEstimate: cur.valueEstimate ? Number(cur.valueEstimate) : null,
        nextFollowupAt: cur.nextFollowupAt?.toISOString().slice(0, 10) ?? null,
      }, d as unknown as Record<string, unknown>);
      if (!details.length) throw new Error('No changes — every provided field already has that value.');
      return { payload: d, title: `Update lead “${cur.customerName}”`, details };
    }
    case 'delete_lead': {
      const d = parseOrThrow(idOnly, input);
      const cur = await requireLead(tx, d.id);
      return {
        payload: d, title: `Delete lead “${cur.customerName}”`, details: [],
        warning: 'Permanent — the lead and its activity log will be removed.',
      };
    }
    case 'log_lead_activity': {
      const d = parseOrThrow(logActivityInput, input);
      const cur = await requireLead(tx, d.leadId);
      return {
        payload: d, title: `Log ${d.type} on lead “${cur.customerName}”`,
        details: [{ label: 'Notes', value: d.notes.length > 140 ? d.notes.slice(0, 140) + '…' : d.notes }],
      };
    }
    case 'convert_lead_to_customer': {
      const d = parseOrThrow(leadIdOnly, input);
      const cur = await requireLead(tx, d.leadId);
      if (cur.convertedCustomerId) {
        throw new Error(`Lead “${cur.customerName}” is already converted (customer id ${cur.convertedCustomerId}).`);
      }
      const details: KV[] = [];
      push(details, 'Stage', `${LEAD_STAGE_LABELS[cur.stage as LeadStage] ?? cur.stage} → Won`);
      push(details, 'Contact', [cur.contact, cur.phone].filter(Boolean).join(' · '));
      return { payload: d, title: `Convert lead “${cur.customerName}” to customer`, details };
    }
    case 'create_quotation': {
      const d = parseOrThrow(quotationInput, {
        ...input,
        docDate: input.docDate ?? todayIST(),
        terms: realNewlines(input.terms),
        notes: realNewlines(input.notes),
      });
      if (d.items.length > MAX_AI_ITEMS) throw new Error(`Too many items (max ${MAX_AI_ITEMS}).`);
      const cust = await requireCustomer(tx, d.customerId);
      const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
      const details: KV[] = [];
      push(details, 'Customer', cust.name);
      push(details, 'Date', d.docDate);
      push(details, 'Validity', `${d.validityDays} days`);
      push(details, 'Tax', interstate ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)');
      docTotalsDetails(details, interstate, d.items);
      return {
        payload: d, title: `Create quotation for ${cust.name}`, details,
        items: docItemsPreview(d.items),
      };
    }
    case 'set_quotation_status': {
      const d = parseOrThrow(quotationStatusInput, input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.id)).limit(1);
      if (!q) throw new Error('Quotation not found — look the uuid up with a query first.');
      if (q.convertedInvoiceId) throw new Error(`${q.number} is converted to an invoice and locked.`);
      if (q.status === d.status) throw new Error(`${q.number} is already ${d.status}.`);
      return {
        payload: d, title: `Mark quotation ${q.number} as ${d.status}`,
        details: [{ label: 'Status', value: `${q.status} → ${d.status}` }],
      };
    }
    case 'convert_quotation_to_invoice': {
      const d = parseOrThrow(convertQuotationInput, input);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.quotationId)).limit(1);
      if (!q) throw new Error('Quotation not found — look the uuid up with a query first.');
      if (q.convertedInvoiceId) {
        throw new Error(`${q.number} is already converted — the invoice id is ${q.convertedInvoiceId}.`);
      }
      const cust = await requireCustomer(tx, q.customerId);
      return {
        payload: d, title: `Convert ${q.number} to a tax invoice`,
        details: [
          { label: 'Customer', value: cust.name },
          { label: 'Grand total', value: formatINR(q.grandTotal) },
          { label: 'Invoice number', value: 'next in INV series (assigned on confirm)' },
        ],
      };
    }
    case 'create_invoice': {
      const d = parseOrThrow(invoiceInput, {
        ...input,
        docDate: input.docDate ?? todayIST(),
        terms: realNewlines(input.terms),
      });
      if (d.items.length > MAX_AI_ITEMS) throw new Error(`Too many items (max ${MAX_AI_ITEMS}).`);
      const cust = await requireCustomer(tx, d.customerId);
      const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
      const details: KV[] = [];
      push(details, 'Customer', cust.name);
      push(details, 'Date', d.docDate);
      push(details, 'PO ref', d.poRef);
      push(details, 'Tax', interstate ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)');
      docTotalsDetails(details, interstate, d.items);
      return {
        payload: d, title: `Create tax invoice for ${cust.name}`, details,
        items: docItemsPreview(d.items),
        warning: 'Issues a numbered GST invoice on confirm.',
      };
    }
    case 'set_invoice_status': {
      const d = parseOrThrow(invoiceStatusInput, input);
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.id)).limit(1);
      if (!inv) throw new Error('Invoice not found — look the uuid up with a query first.');
      if (inv.status === d.status) throw new Error(`${inv.number} is already ${d.status}.`);
      return {
        payload: d, title: `Mark invoice ${inv.number} as ${d.status}`,
        details: [{ label: 'Status', value: `${inv.status} → ${d.status}` }],
        warning: d.status === 'cancelled' ? 'Cancelling an issued GST invoice — make sure it has not been filed.' : undefined,
      };
    }
    default:
      throw new Error('Unknown action.');
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
      const action: StagedAction = {
        actionId: row!.id, kind, title: staged.title, details: staged.details,
        items: staged.items, warning: staged.warning,
      };
      return { ok: true as const, action };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not stage the action.' };
  }
}

// ── Execute / cancel (called from the confirmation UI) ──────────────────────

export type ExecResult =
  | { ok: true; message: string; entity?: { type: string; id: string }; path?: string }
  | { ok: false; error: string };

type Performed = {
  message: string;
  entity?: { type: string; id: string };
  path?: string;
  revalidate: string[];
};

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
        message: `Customer “${d.name}” created.`,
        entity: { type: 'customer', id: c!.id }, path: '/customers',
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
      return {
        message: `Customer “${cur.name}” updated (${Object.keys(set).join(', ')}).`,
        entity: { type: 'customer', id }, path: '/customers',
        revalidate: ['/customers', '/dashboard'],
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
      const [l] = await tx.insert(lead).values({
        tenantId: u.tenantId, customerName: d.customerName, contact: d.contact, phone: d.phone,
        email: d.email, source: d.source, requirement: d.requirement, stage: d.stage,
        ownerUserId: u.userId,
        valueEstimate: d.valueEstimate != null ? String(d.valueEstimate) : undefined,
        nextFollowupAt: d.nextFollowupAt ? new Date(d.nextFollowupAt) : undefined,
      }).returning({ id: lead.id });
      return {
        message: `Lead “${d.customerName}” recorded${d.stage !== 'new' ? ` (stage: ${d.stage})` : ''}.`,
        entity: { type: 'lead', id: l!.id }, path: '/leads',
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
        message: `Lead “${cur.customerName}” updated (${changed.join(', ')}).`,
        entity: { type: 'lead', id }, path: '/leads',
        revalidate: ['/leads', '/dashboard'],
      };
    }
    case 'delete_lead': {
      const d = idOnly.parse(payload);
      const cur = await requireLead(tx, d.id);
      await tx.delete(leadActivity).where(eq(leadActivity.leadId, d.id));
      await tx.delete(lead).where(eq(lead.id, d.id));
      return {
        message: `Lead “${cur.customerName}” deleted.`, path: '/leads',
        revalidate: ['/leads', '/dashboard'],
      };
    }
    case 'log_lead_activity': {
      const d = logActivityInput.parse(payload);
      const cur = await requireLead(tx, d.leadId);
      await tx.insert(leadActivity).values({
        tenantId: u.tenantId, leadId: d.leadId, type: d.type, notes: d.notes, byUserId: u.userId,
      });
      return {
        message: `${d.type[0]!.toUpperCase()}${d.type.slice(1)} logged on lead “${cur.customerName}”.`,
        entity: { type: 'lead', id: d.leadId }, path: '/leads',
        revalidate: ['/leads'],
      };
    }
    case 'convert_lead_to_customer': {
      const d = leadIdOnly.parse(payload);
      const cur = await requireLead(tx, d.leadId);
      if (cur.convertedCustomerId) {
        return {
          message: `Lead “${cur.customerName}” was already converted.`,
          entity: { type: 'customer', id: cur.convertedCustomerId }, path: '/customers',
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
        message: `Lead “${cur.customerName}” marked won — customer created.`,
        entity: { type: 'customer', id: c!.id }, path: '/customers',
        revalidate: ['/leads', '/customers', '/dashboard'],
      };
    }
    case 'create_quotation': {
      const d = quotationInput.parse(payload);
      const created = await insertQuotationTx(tx, u, d);
      return {
        message: `Quotation ${created.number} created — ${formatINR(created.grand)} incl. GST.`,
        entity: { type: 'quotation', id: created.id }, path: `/quotations/${created.id}`,
        revalidate: ['/quotations', `/quotations/${created.id}`, '/dashboard'],
      };
    }
    case 'set_quotation_status': {
      const d = quotationStatusInput.parse(payload);
      const [q] = await tx.select().from(quotation).where(eq(quotation.id, d.id)).limit(1);
      if (!q) throw new Error('Quotation not found.');
      if (q.convertedInvoiceId) throw new Error(`${q.number} is converted and locked.`);
      await tx.update(quotation).set({ status: d.status, updatedAt: new Date() }).where(eq(quotation.id, d.id));
      return {
        message: `Quotation ${q.number} marked ${d.status}.`,
        entity: { type: 'quotation', id: d.id }, path: `/quotations/${d.id}`,
        revalidate: ['/quotations', `/quotations/${d.id}`, '/dashboard'],
      };
    }
    case 'convert_quotation_to_invoice': {
      const d = convertQuotationInput.parse(payload);
      const res = await convertQuotationTx(tx, u, d.quotationId);
      return {
        message: res.existing
          ? `Already converted — invoice ${res.number}.`
          : `Invoice ${res.number} created from the quotation.`,
        entity: { type: 'invoice', id: res.invoiceId }, path: `/invoices/${res.invoiceId}`,
        revalidate: ['/quotations', `/quotations/${d.quotationId}`, '/invoices', `/invoices/${res.invoiceId}`, '/dashboard'],
      };
    }
    case 'create_invoice': {
      const d = invoiceInput.parse(payload);
      const created = await insertInvoiceTx(tx, u, d);
      return {
        message: `Tax invoice ${created.number} created — ${formatINR(created.grand)} incl. GST.`,
        entity: { type: 'invoice', id: created.id }, path: `/invoices/${created.id}`,
        revalidate: ['/invoices', `/invoices/${created.id}`, '/dashboard'],
      };
    }
    case 'set_invoice_status': {
      const d = invoiceStatusInput.parse(payload);
      const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.id)).limit(1);
      if (!inv) throw new Error('Invoice not found.');
      await tx.update(taxInvoice).set({ status: d.status, updatedAt: new Date() }).where(eq(taxInvoice.id, d.id));
      return {
        message: `Invoice ${inv.number} marked ${d.status}.`,
        entity: { type: 'invoice', id: d.id }, path: `/invoices/${d.id}`,
        revalidate: ['/invoices', `/invoices/${d.id}`, '/dashboard'],
      };
    }
    default:
      throw new Error('Unknown action.');
  }
}

export async function executeAction(user: CurrentUser, actionId: string): Promise<ExecResult> {
  let performed: Performed;
  try {
    performed = await withTenant(user.tenantId, user.userId, async (tx) => {
      // Atomic claim — a double-click or second tab cannot execute twice.
      const claimed = await tx.update(aiAction)
        .set({ status: 'executed', decidedAt: new Date() })
        .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending')))
        .returning({ kind: aiAction.kind, payload: aiAction.payload, expiresAt: aiAction.expiresAt });
      const row = claimed[0];
      if (!row) throw new Error('This proposal is no longer pending — ask the assistant again.');
      if (row.expiresAt.getTime() < Date.now()) throw new Error('This proposal expired — ask the assistant again.');
      const out = await performAction(tx, user, row.kind, row.payload);
      await tx.update(aiAction).set({ result: out }).where(eq(aiAction.id, actionId));
      return out;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'The action failed.';
    // The transaction rolled back (row is pending again) — record the failure.
    await withTenant(user.tenantId, user.userId, (tx) =>
      tx.update(aiAction)
        .set({ status: 'failed', error: msg, decidedAt: new Date() })
        .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending'))),
    ).catch(() => { /* best-effort */ });
    return { ok: false, error: msg };
  }
  for (const p of performed.revalidate) revalidatePath(p);
  return { ok: true, message: performed.message, entity: performed.entity, path: performed.path };
}

export async function cancelAction(user: CurrentUser, actionId: string): Promise<void> {
  await withTenant(user.tenantId, user.userId, (tx) =>
    tx.update(aiAction)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(aiAction.id, actionId), eq(aiAction.userId, user.userId), eq(aiAction.status, 'pending'))),
  );
}
