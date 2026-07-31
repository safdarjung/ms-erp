import 'server-only';
import {
  computeGst, isInterstate, parseLetterhead,
  type InvoiceInput, type QuotationInput,
} from '@ms/core';
import {
  customer, quotation, quotationItem, taxInvoice, taxInvoiceItem, tenant, issueDocNumber, eq, type Tx,
} from '@ms/db';

// Document creation cores, shared by the form server actions and the AI agent
// executors so numbering, GST math and locking never drift between the two.

type U = { tenantId: string; userId: string };

export async function getSupplierStateCode(tx: Tx): Promise<string> {
  const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
  return parseLetterhead(t?.settings)?.stateCode ?? '06';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

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
    igst: String(totals.igst), grandTotal: String(totals.grand), terms: d.terms, notes: d.notes, createdBy: u.userId,
  }).returning({ id: quotation.id });

  await tx.insert(quotationItem).values(d.items.map((it, i) => ({
    tenantId: u.tenantId, quotationId: q!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
    taxableValue: String(r2(it.qty * it.rate)), isToolingCharge: it.isToolingCharge ?? false,
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
    tenantId: u.tenantId, number, docDate: when, customerId: d.customerId, poRef: d.poRef,
    placeOfSupply: cust.stateCode, isInterstate: interstate,
    subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
    igst: String(totals.igst), grandTotal: String(totals.grand),
    terms: d.terms, status: 'issued', createdBy: u.userId,
  }).returning({ id: taxInvoice.id });

  await tx.insert(taxInvoiceItem).values(d.items.map((it, i) => ({
    tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1,
    description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom,
    rate: String(it.rate), gstRate: String(it.gstRate),
    taxableValue: String(r2(it.qty * it.rate)),
  })));

  return { id: inv!.id, number, grand: totals.grand };
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
  const number = await issueDocNumber(tx, u.tenantId, 'invoice', new Date());

  const [inv] = await tx.insert(taxInvoice).values({
    tenantId: u.tenantId, number, docDate: new Date(), customerId: q.customerId, quotationId: q.id,
    placeOfSupply: q.placeOfSupply, isInterstate: q.isInterstate,
    subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst, grandTotal: q.grandTotal,
    terms: q.terms, status: 'issued', createdBy: u.userId,
  }).returning({ id: taxInvoice.id });

  await tx.insert(taxInvoiceItem).values(qitems.map((it, i) => ({
    tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1, description: it.description, hsn: it.hsn,
    qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
  })));

  await tx.update(quotation).set({ status: 'converted', convertedInvoiceId: inv!.id }).where(eq(quotation.id, q.id));
  return { invoiceId: inv!.id, number, existing: false };
}
