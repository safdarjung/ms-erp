'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { invoiceInput, computeGst, isInterstate } from '@ms/core';
import { withTenant, taxInvoice, taxInvoiceItem, customer, tenant, issueDocNumber, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';

export type ActionState = { error?: string };

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('invoice.create');

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'));
  } catch {
    return { error: 'Invalid line items' };
  }

  const parsed = invoiceInput.safeParse({
    customerId: formData.get('customerId'),
    docDate: formData.get('docDate'),
    poRef: formData.get('poRef') || undefined,
    terms: formData.get('terms') || undefined,
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
      const number = await issueDocNumber(tx, u.tenantId, 'invoice', when);

      const [inv] = await tx.insert(taxInvoice).values({
        tenantId: u.tenantId, number, docDate: when, customerId: d.customerId, poRef: d.poRef,
        placeOfSupply: cust.stateCode, isInterstate: interstate,
        subtotal: String(totals.subtotal), cgst: String(totals.cgst), sgst: String(totals.sgst),
        igst: String(totals.igst), grandTotal: String(totals.grand),
        terms: d.terms, status: 'issued', createdBy: u.userId,
      }).returning({ id: taxInvoice.id });
      newId = inv!.id;

      await tx.insert(taxInvoiceItem).values(
        d.items.map((it, i) => ({
          tenantId: u.tenantId, invoiceId: inv!.id, seq: i + 1,
          description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom,
          rate: String(it.rate), gstRate: String(it.gstRate),
          taxableValue: String(Math.round(it.qty * it.rate * 100) / 100),
        })),
      );
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create invoice' };
  }

  revalidatePath('/invoices');
  if (newId) redirect(`/invoices/${newId}`);
  return {};
}
