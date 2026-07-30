'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { quotationInput, computeGst, isInterstate } from '@ms/core';
import {
  withTenant, quotation, quotationItem, taxInvoice, taxInvoiceItem, customer, tenant, issueDocNumber, eq,
} from '@ms/db';
import { requirePermission } from '@/lib/rbac';

export type ActionState = { error?: string };

export async function createQuotationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('quotation.create');

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'));
  } catch {
    return { error: 'Invalid line items' };
  }

  const parsed = quotationInput.safeParse({
    customerId: formData.get('customerId'),
    docDate: formData.get('docDate'),
    validityDays: formData.get('validityDays'),
    terms: formData.get('terms') || undefined,
    notes: formData.get('notes') || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  let newId: string | undefined;
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [cust] = await tx.select().from(customer).where(eq(customer.id, d.customerId)).limit(1);
      if (!cust) throw new Error('Customer not found');
      const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supplierState = (t?.settings as any)?.letterhead?.stateCode ?? '06';
      const interstate = isInterstate(supplierState, cust.stateCode);
      const totals = computeGst(d.items, interstate);
      const when = new Date(d.docDate);
      const number = await issueDocNumber(tx, u.tenantId, 'quotation', when);

      const [q] = await tx.insert(quotation).values({
        tenantId: u.tenantId, number, docDate: when, customerId: d.customerId,
        placeOfSupply: cust.stateCode, isInterstate: interstate, status: 'draft', validityDays: d.validityDays,
        subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
        igst: String(totals.igst), grandTotal: String(totals.grand), terms: d.terms, notes: d.notes, createdBy: u.userId,
      }).returning({ id: quotation.id });
      newId = q!.id;

      await tx.insert(quotationItem).values(d.items.map((it, i) => ({
        tenantId: u.tenantId, quotationId: q!.id, seq: i + 1, description: it.description, hsn: it.hsn,
        qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate),
        taxableValue: String(Math.round(it.qty * it.rate * 100) / 100), isToolingCharge: it.isToolingCharge ?? false,
      })));
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create quotation' };
  }

  revalidatePath('/quotations');
  if (newId) redirect(`/quotations/${newId}`);
  return {};
}

export async function convertToInvoiceAction(formData: FormData): Promise<void> {
  const u = await requirePermission('invoice.create');
  const quotationId = String(formData.get('quotationId') ?? '');

  let invId: string | undefined;
  await withTenant(u.tenantId, u.userId, async (tx) => {
    const [q] = await tx.select().from(quotation).where(eq(quotation.id, quotationId)).limit(1);
    if (!q) throw new Error('Quotation not found');
    if (q.convertedInvoiceId) { invId = q.convertedInvoiceId; return; }

    const qitems = await tx.select().from(quotationItem).where(eq(quotationItem.quotationId, quotationId)).orderBy(quotationItem.seq);
    const number = await issueDocNumber(tx, u.tenantId, 'invoice', new Date());

    const [inv] = await tx.insert(taxInvoice).values({
      tenantId: u.tenantId, number, docDate: new Date(), customerId: q.customerId, quotationId: q.id,
      placeOfSupply: q.placeOfSupply, isInterstate: q.isInterstate,
      subtotal: q.subtotal, cgst: q.cgst, sgst: q.sgst, igst: q.igst, grandTotal: q.grandTotal,
      terms: q.terms, status: 'issued', createdBy: u.userId,
    }).returning({ id: taxInvoice.id });
    invId = inv!.id;

    await tx.insert(taxInvoiceItem).values(qitems.map((it, i) => ({
      tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1, description: it.description, hsn: it.hsn,
      qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate, taxableValue: it.taxableValue,
    })));

    await tx.update(quotation).set({ status: 'converted', convertedInvoiceId: inv!.id }).where(eq(quotation.id, q.id));
  });

  revalidatePath('/quotations');
  revalidatePath('/invoices');
  if (invId) redirect(`/invoices/${invId}`);
}
