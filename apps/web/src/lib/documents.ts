import 'server-only';
import {
  computeGst, isInterstate, parseLetterhead,
  type InvoiceInput, type QuotationInput, type OrderInput, type PaymentInput, type LeadStage, type ColumnDef,
} from '@ms/core';
import {
  customer, lead, quotation, quotationItem, salesOrder, orderItem, taxInvoice, taxInvoiceItem, payment,
  tenant, issueDocNumber, eq, sum, type Tx,
} from '@ms/db';

// Document creation cores, shared by the form server actions and the AI agent
// executors so numbering, GST math and locking never drift between the two.

type U = { tenantId: string; userId: string };

export async function getSupplierStateCode(tx: Tx): Promise<string> {
  const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
  return parseLetterhead(t?.settings)?.stateCode ?? '06';
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

// One validated lead insert, shared by the manual form action, the AI agent's
// `create_lead` executor and the inbound-capture pipeline so they never drift.
// Callers validate their own input (zod) and pass already-clean fields.
export type CreateLeadFields = {
  customerName: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  requirement?: string | null;
  stage?: LeadStage;
  valueEstimate?: number | null;
  nextFollowupAt?: string | Date | null;
  ownerUserId?: string | null;
  inboundMessageId?: string | null;
};

export async function createLeadRecord(
  tx: Tx, tenantId: string, d: CreateLeadFields,
): Promise<{ id: string }> {
  const [l] = await tx.insert(lead).values({
    tenantId,
    customerName: d.customerName,
    contact: d.contact ?? undefined,
    phone: d.phone ?? undefined,
    email: d.email ?? undefined,
    source: d.source ?? undefined,
    requirement: d.requirement ?? undefined,
    stage: d.stage ?? 'new',
    ownerUserId: d.ownerUserId ?? undefined,
    valueEstimate: d.valueEstimate != null ? String(d.valueEstimate) : undefined,
    nextFollowupAt: d.nextFollowupAt ? new Date(d.nextFollowupAt) : undefined,
    inboundMessageId: d.inboundMessageId ?? undefined,
  }).returning({ id: lead.id });
  return { id: l!.id };
}

export async function insertQuotationTx(
  tx: Tx, u: U, d: QuotationInput,
): Promise<{ id: string; number: string; grand: number }> {
  const [cust] = await tx.select().from(customer).where(eq(customer.id, d.customerId)).limit(1);
  if (!cust) throw new Error('Customer not found');
  const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
  const totals = computeGst(d.items, interstate);
  const when = new Date(d.docDate);
  const number = await issueDocNumber(tx, u.tenantId, 'quotation', when);

  const [q] = await tx.insert(quotation).values({
    tenantId: u.tenantId, number, docDate: when, customerId: d.customerId,
    placeOfSupply: cust.stateCode, isInterstate: interstate, status: 'draft', validityDays: d.validityDays,
    subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
    igst: String(totals.igst), grandTotal: String(totals.grand), terms: d.terms, notes: d.notes,
    columnDefs: d.columnDefs ?? [], createdBy: u.userId,
  }).returning({ id: quotation.id });

  await tx.insert(quotationItem).values(d.items.map((it, i) => ({
    tenantId: u.tenantId, quotationId: q!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
    taxableValue: String(r2(it.qty * it.rate)), isToolingCharge: it.isToolingCharge ?? false,
    groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
  })));

  return { id: q!.id, number, grand: totals.grand };
}

export async function insertInvoiceTx(
  tx: Tx, u: U, d: InvoiceInput,
): Promise<{ id: string; number: string; grand: number }> {
  const [cust] = await tx.select().from(customer).where(eq(customer.id, d.customerId)).limit(1);
  if (!cust) throw new Error('Customer not found');
  const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
  const totals = computeGst(d.items, interstate);
  const when = new Date(d.docDate);
  const number = await issueDocNumber(tx, u.tenantId, 'invoice', when);

  const [inv] = await tx.insert(taxInvoice).values({
    tenantId: u.tenantId, number, docDate: when, dueDate: addDays(when, cust.creditTermsDays ?? 0),
    customerId: d.customerId, poRef: d.poRef,
    placeOfSupply: cust.stateCode, isInterstate: interstate,
    subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
    igst: String(totals.igst), grandTotal: String(totals.grand),
    terms: d.terms, status: 'issued', columnDefs: d.columnDefs ?? [], createdBy: u.userId,
  }).returning({ id: taxInvoice.id });

  await tx.insert(taxInvoiceItem).values(d.items.map((it, i) => ({
    tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1,
    description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom,
    rate: String(it.rate), gstRate: String(it.gstRate),
    taxableValue: String(r2(it.qty * it.rate)),
    groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
  })));

  return { id: inv!.id, number, grand: totals.grand };
}

export type DocEdit = {
  docDate?: string;
  validityDays?: number;
  poRef?: string;
  terms?: string;
  notes?: string;
  /** When present, REPLACES this doc's custom column definitions. */
  columnDefs?: ColumnDef[];
  /** When present, REPLACES all line items; totals recompute deterministically. */
  items?: {
    description: string; hsn?: string; qty: number; uom: string;
    rate: number; gstRate: number; isToolingCharge?: boolean;
    groupLabel?: string; attributes?: Record<string, string>;
  }[];
};

/** Edit a quotation in place (same number). Items replace wholesale; GST recomputes. */
export async function updateQuotationTx(
  tx: Tx, u: U, id: string, d: DocEdit,
): Promise<{ number: string; grand: number }> {
  const [q] = await tx.select().from(quotation).where(eq(quotation.id, id)).limit(1);
  if (!q) throw new Error('Quotation not found');
  if (q.convertedInvoiceId) throw new Error(`${q.number} is converted to an invoice and locked.`);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.docDate !== undefined) set.docDate = new Date(d.docDate);
  if (d.validityDays !== undefined) set.validityDays = d.validityDays;
  if (d.terms !== undefined) set.terms = d.terms;
  if (d.notes !== undefined) set.notes = d.notes;
  if (d.columnDefs !== undefined) set.columnDefs = d.columnDefs;

  let grand = Number(q.grandTotal);
  if (d.items) {
    const interstate = q.isInterstate;
    const totals = computeGst(d.items, interstate);
    grand = totals.grand;
    set.subtotal = String(totals.subtotal);
    set.cgst = String(totals.cgst);
    set.sgst = String(totals.sgst);
    set.igst = String(totals.igst);
    set.grandTotal = String(totals.grand);
    await tx.delete(quotationItem).where(eq(quotationItem.quotationId, id));
    await tx.insert(quotationItem).values(d.items.map((it, i) => ({
      tenantId: u.tenantId, quotationId: id, seq: i + 1, description: it.description, hsn: it.hsn,
      qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
      taxableValue: String(r2(it.qty * it.rate)), isToolingCharge: it.isToolingCharge ?? false,
      groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
    })));
  }
  await tx.update(quotation).set(set).where(eq(quotation.id, id));
  return { number: q.number, grand };
}

/** Edit a tax invoice in place (same number). Items replace wholesale; GST recomputes. */
export async function updateInvoiceTx(
  tx: Tx, u: U, id: string, d: DocEdit,
): Promise<{ number: string; grand: number }> {
  const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, id)).limit(1);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'cancelled') throw new Error(`${inv.number} is cancelled and locked.`);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.docDate !== undefined) set.docDate = new Date(d.docDate);
  if (d.poRef !== undefined) set.poRef = d.poRef;
  if (d.terms !== undefined) set.terms = d.terms;
  if (d.notes !== undefined) set.notes = d.notes;
  if (d.columnDefs !== undefined) set.columnDefs = d.columnDefs;

  let grand = Number(inv.grandTotal);
  if (d.items) {
    const totals = computeGst(d.items, inv.isInterstate);
    grand = totals.grand;
    set.subtotal = String(totals.subtotal);
    set.cgst = String(totals.cgst);
    set.sgst = String(totals.sgst);
    set.igst = String(totals.igst);
    set.grandTotal = String(totals.grand);
    await tx.delete(taxInvoiceItem).where(eq(taxInvoiceItem.invoiceId, id));
    await tx.insert(taxInvoiceItem).values(d.items.map((it, i) => ({
      tenantId: u.tenantId, invoiceId: id, seq: i + 1, description: it.description, hsn: it.hsn,
      qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
      taxableValue: String(r2(it.qty * it.rate)),
      groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
    })));
  }
  await tx.update(taxInvoice).set(set).where(eq(taxInvoice.id, id));
  return { number: inv.number, grand };
}

// ── Sales orders ────────────────────────────────────────────────────────────

export async function insertOrderTx(
  tx: Tx, u: U, d: OrderInput,
): Promise<{ id: string; number: string; total: number }> {
  const [cust] = await tx.select().from(customer).where(eq(customer.id, d.customerId)).limit(1);
  if (!cust) throw new Error('Customer not found');
  const subtotal = r2(d.items.reduce((s, it) => s + it.qty * it.rate, 0));
  const when = new Date(d.docDate);
  const number = await issueDocNumber(tx, u.tenantId, 'order', when);

  const [o] = await tx.insert(salesOrder).values({
    tenantId: u.tenantId, number, docDate: when, customerId: d.customerId, quotationId: d.quotationId,
    poRef: d.poRef, orderCategory: d.orderCategory, materialOwnership: d.materialOwnership, status: 'open',
    deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : undefined,
    totalValue: String(subtotal), columnDefs: d.columnDefs ?? [], createdBy: u.userId,
  }).returning({ id: salesOrder.id });

  await tx.insert(orderItem).values(d.items.map((it, i) => ({
    tenantId: u.tenantId, orderId: o!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
    taxableValue: String(r2(it.qty * it.rate)),
    groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
  })));

  return { id: o!.id, number, total: subtotal };
}

export type OrderEdit = {
  docDate?: string;
  poRef?: string;
  orderCategory?: OrderInput['orderCategory'];
  materialOwnership?: OrderInput['materialOwnership'];
  deliveryDate?: string;
  columnDefs?: ColumnDef[];
  items?: {
    description: string; hsn?: string; qty: number; uom: string;
    rate: number; gstRate: number; groupLabel?: string; attributes?: Record<string, string>;
  }[];
};

/** Edit a sales order in place (same number). Items replace wholesale; total recomputes.
 *  Locked once invoiced or cancelled. */
export async function updateOrderTx(
  tx: Tx, u: U, id: string, d: OrderEdit,
): Promise<{ number: string; total: number }> {
  const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id)).limit(1);
  if (!o) throw new Error('Order not found');
  if (o.convertedInvoiceId) throw new Error(`${o.number} is invoiced and locked.`);
  if (o.status === 'cancelled') throw new Error(`${o.number} is cancelled and locked.`);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.docDate !== undefined) set.docDate = new Date(d.docDate);
  if (d.poRef !== undefined) set.poRef = d.poRef;
  if (d.orderCategory !== undefined) set.orderCategory = d.orderCategory;
  if (d.materialOwnership !== undefined) set.materialOwnership = d.materialOwnership;
  if (d.deliveryDate !== undefined) set.deliveryDate = d.deliveryDate ? new Date(d.deliveryDate) : null;
  if (d.columnDefs !== undefined) set.columnDefs = d.columnDefs;

  let total = Number(o.totalValue);
  if (d.items) {
    total = r2(d.items.reduce((s, it) => s + it.qty * it.rate, 0));
    set.totalValue = String(total);
    await tx.delete(orderItem).where(eq(orderItem.orderId, id));
    await tx.insert(orderItem).values(d.items.map((it, i) => ({
      tenantId: u.tenantId, orderId: id, seq: i + 1, description: it.description, hsn: it.hsn,
      qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
      taxableValue: String(r2(it.qty * it.rate)),
      groupLabel: it.groupLabel ?? null, attributes: it.attributes ?? {},
    })));
  }
  await tx.update(salesOrder).set(set).where(eq(salesOrder.id, id));
  return { number: o.number, total };
}

type OrderConvertMeta = { orderCategory?: OrderInput['orderCategory']; materialOwnership?: OrderInput['materialOwnership']; poRef?: string; deliveryDate?: string };

/** Quotation → sales order. Idempotent: an already-ordered quotation returns its order. */
export async function convertQuotationToOrderTx(
  tx: Tx, u: U, quotationId: string, meta: OrderConvertMeta = {},
): Promise<{ orderId: string; number: string; existing: boolean }> {
  const [q] = await tx.select().from(quotation).where(eq(quotation.id, quotationId)).limit(1);
  if (!q) throw new Error('Quotation not found');
  if (q.convertedInvoiceId) throw new Error(`${q.number} is already invoiced.`);
  if (q.convertedOrderId) {
    const [o] = await tx.select({ number: salesOrder.number }).from(salesOrder).where(eq(salesOrder.id, q.convertedOrderId)).limit(1);
    return { orderId: q.convertedOrderId, number: o?.number ?? '', existing: true };
  }

  const qitems = await tx.select().from(quotationItem).where(eq(quotationItem.quotationId, quotationId)).orderBy(quotationItem.seq);
  const number = await issueDocNumber(tx, u.tenantId, 'order', new Date());

  const [o] = await tx.insert(salesOrder).values({
    tenantId: u.tenantId, number, docDate: new Date(), customerId: q.customerId, quotationId: q.id,
    poRef: meta.poRef, orderCategory: meta.orderCategory ?? 'tool_build',
    materialOwnership: meta.materialOwnership ?? 'customer', status: 'open',
    deliveryDate: meta.deliveryDate ? new Date(meta.deliveryDate) : undefined,
    totalValue: q.subtotal, columnDefs: q.columnDefs, createdBy: u.userId,
  }).returning({ id: salesOrder.id });

  await tx.insert(orderItem).values(qitems.map((it, i) => ({
    tenantId: u.tenantId, orderId: o!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
    groupLabel: it.groupLabel, attributes: it.attributes,
  })));

  await tx.update(quotation).set({ convertedOrderId: o!.id, updatedAt: new Date() }).where(eq(quotation.id, q.id));
  return { orderId: o!.id, number, existing: false };
}

/** Sales order → tax invoice. Idempotent: an already-invoiced order returns its invoice. */
export async function convertOrderToInvoiceTx(
  tx: Tx, u: U, orderId: string,
): Promise<{ invoiceId: string; number: string; existing: boolean }> {
  const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, orderId)).limit(1);
  if (!o) throw new Error('Order not found');
  if (o.status === 'cancelled') throw new Error(`${o.number} is cancelled.`);
  if (o.convertedInvoiceId) {
    const [inv] = await tx.select({ number: taxInvoice.number }).from(taxInvoice).where(eq(taxInvoice.id, o.convertedInvoiceId)).limit(1);
    return { invoiceId: o.convertedInvoiceId, number: inv?.number ?? '', existing: true };
  }

  const [cust] = await tx.select().from(customer).where(eq(customer.id, o.customerId)).limit(1);
  if (!cust) throw new Error('Customer not found');
  const interstate = isInterstate(await getSupplierStateCode(tx), cust.stateCode);
  const oitems = await tx.select().from(orderItem).where(eq(orderItem.orderId, orderId)).orderBy(orderItem.seq);
  const totals = computeGst(oitems.map((it) => ({ qty: it.qty, rate: it.rate, gstRate: it.gstRate })), interstate);
  const number = await issueDocNumber(tx, u.tenantId, 'invoice', new Date());

  const invDate = new Date();
  const [inv] = await tx.insert(taxInvoice).values({
    tenantId: u.tenantId, number, docDate: invDate, dueDate: addDays(invDate, cust.creditTermsDays ?? 0),
    customerId: o.customerId, quotationId: o.quotationId, orderId: o.id, poRef: o.poRef,
    placeOfSupply: cust.stateCode, isInterstate: interstate,
    subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
    igst: String(totals.igst), grandTotal: String(totals.grand), status: 'issued',
    columnDefs: o.columnDefs, createdBy: u.userId,
  }).returning({ id: taxInvoice.id });

  await tx.insert(taxInvoiceItem).values(oitems.map((it, i) => ({
    tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
    groupLabel: it.groupLabel, attributes: it.attributes,
  })));

  await tx.update(salesOrder).set({ convertedInvoiceId: inv!.id, updatedAt: new Date() }).where(eq(salesOrder.id, o.id));
  return { invoiceId: inv!.id, number, existing: false };
}

// ── Payments (accounts-receivable) ──────────────────────────────────────────

export async function recordPaymentTx(tx: Tx, u: U, d: PaymentInput): Promise<{ amount: number; fullyPaid: boolean }> {
  const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, d.invoiceId)).limit(1);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'cancelled') throw new Error(`${inv.number} is cancelled — no payments can be recorded.`);

  const [agg] = await tx.select({ received: sum(payment.amount) }).from(payment).where(eq(payment.invoiceId, d.invoiceId));
  const received = Number(agg?.received ?? 0);
  const outstanding = r2(Number(inv.grandTotal) - received);
  if (d.amount > outstanding + 0.5) throw new Error(`That exceeds the ₹${outstanding.toFixed(2)} still outstanding on ${inv.number}.`);

  await tx.insert(payment).values({
    tenantId: u.tenantId, invoiceId: d.invoiceId, amount: String(d.amount), paidOn: new Date(d.paidOn),
    method: d.method, reference: d.reference, notes: d.notes, createdBy: u.userId,
  });
  return { amount: d.amount, fullyPaid: d.amount >= outstanding - 0.5 };
}

export async function deletePaymentTx(tx: Tx, _u: U, paymentId: string): Promise<void> {
  await tx.delete(payment).where(eq(payment.id, paymentId));
}

/** Quotation → tax invoice. Idempotent: an already-converted quotation returns its invoice. */
export async function convertQuotationTx(
  tx: Tx, u: U, quotationId: string,
): Promise<{ invoiceId: string; number: string; existing: boolean }> {
  const [q] = await tx.select().from(quotation).where(eq(quotation.id, quotationId)).limit(1);
  if (!q) throw new Error('Quotation not found');

  if (q.convertedInvoiceId) {
    const [inv] = await tx.select({ number: taxInvoice.number })
      .from(taxInvoice).where(eq(taxInvoice.id, q.convertedInvoiceId)).limit(1);
    return { invoiceId: q.convertedInvoiceId, number: inv?.number ?? '', existing: true };
  }

  const qitems = await tx.select().from(quotationItem)
    .where(eq(quotationItem.quotationId, quotationId)).orderBy(quotationItem.seq);
  const [cust] = await tx.select({ creditTermsDays: customer.creditTermsDays }).from(customer).where(eq(customer.id, q.customerId)).limit(1);
  const invDate = new Date();
  const number = await issueDocNumber(tx, u.tenantId, 'invoice', invDate);

  const [inv] = await tx.insert(taxInvoice).values({
    tenantId: u.tenantId, number, docDate: invDate, dueDate: addDays(invDate, cust?.creditTermsDays ?? 0),
    customerId: q.customerId, quotationId: q.id,
    placeOfSupply: q.placeOfSupply, isInterstate: q.isInterstate,
    subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst, grandTotal: q.grandTotal,
    terms: q.terms, status: 'issued', columnDefs: q.columnDefs, createdBy: u.userId,
  }).returning({ id: taxInvoice.id });

  await tx.insert(taxInvoiceItem).values(qitems.map((it, i) => ({
    tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
    groupLabel: it.groupLabel, attributes: it.attributes,
  })));

  await tx.update(quotation).set({ status: 'converted', convertedInvoiceId: inv!.id }).where(eq(quotation.id, q.id));
  return { invoiceId: inv!.id, number, existing: false };
}

// ── Duplicate (re-issue a repeat job) ───────────────────────────────────────

/** Duplicate a quotation into a fresh draft: new number + today's date, same customer,
 *  totals copied verbatim (no recompute) and all line items cloned. */
export async function duplicateQuotationTx(
  tx: Tx, u: U, sourceId: string,
): Promise<{ id: string; number: string }> {
  const [q] = await tx.select().from(quotation).where(eq(quotation.id, sourceId)).limit(1);
  if (!q) throw new Error('Quotation not found');

  const qitems = await tx.select().from(quotationItem)
    .where(eq(quotationItem.quotationId, sourceId)).orderBy(quotationItem.seq);
  const when = new Date();
  const number = await issueDocNumber(tx, u.tenantId, 'quotation', when);

  const [dup] = await tx.insert(quotation).values({
    tenantId: u.tenantId, number, docDate: when, customerId: q.customerId,
    placeOfSupply: q.placeOfSupply, isInterstate: q.isInterstate, status: 'draft', validityDays: q.validityDays,
    subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst, grandTotal: q.grandTotal,
    terms: q.terms, notes: q.notes, columnDefs: q.columnDefs, createdBy: u.userId,
  }).returning({ id: quotation.id });

  await tx.insert(quotationItem).values(qitems.map((it) => ({
    tenantId: u.tenantId, quotationId: dup!.id, seq: it.seq, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate,
    taxableValue: it.taxableValue, isToolingCharge: it.isToolingCharge,
    groupLabel: it.groupLabel, attributes: it.attributes,
  })));

  return { id: dup!.id, number };
}

/** Duplicate a sales order into a fresh open order: new number + today's date, same customer
 *  and terms, no delivery date, all line items cloned. */
export async function duplicateOrderTx(
  tx: Tx, u: U, sourceId: string,
): Promise<{ id: string; number: string }> {
  const [o] = await tx.select().from(salesOrder).where(eq(salesOrder.id, sourceId)).limit(1);
  if (!o) throw new Error('Order not found');

  const oitems = await tx.select().from(orderItem)
    .where(eq(orderItem.orderId, sourceId)).orderBy(orderItem.seq);
  const when = new Date();
  const number = await issueDocNumber(tx, u.tenantId, 'order', when);

  const [dup] = await tx.insert(salesOrder).values({
    tenantId: u.tenantId, number, docDate: when, customerId: o.customerId,
    poRef: o.poRef, orderCategory: o.orderCategory, materialOwnership: o.materialOwnership, status: 'open',
    totalValue: o.totalValue, columnDefs: o.columnDefs, createdBy: u.userId,
  }).returning({ id: salesOrder.id });

  await tx.insert(orderItem).values(oitems.map((it) => ({
    tenantId: u.tenantId, orderId: dup!.id, seq: it.seq, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
    groupLabel: it.groupLabel, attributes: it.attributes,
  })));

  return { id: dup!.id, number };
}
