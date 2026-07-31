'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { quotationInput, QUOTATION_SETTABLE_STATUSES } from '@ms/core';
import { withTenant, quotation, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertQuotationTx, convertQuotationTx } from '@/lib/documents';

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
      const created = await insertQuotationTx(tx, u, d);
      newId = created.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create quotation' };
  }

  revalidatePath('/quotations');
  if (newId) redirect(`/quotations/${newId}`);
  return {};
}

export async function setQuotationStatusAction(formData: FormData): Promise<void> {
  const u = await requirePermission('quotation.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (id && (QUOTATION_SETTABLE_STATUSES as readonly string[]).includes(status)) {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ converted: quotation.convertedInvoiceId }).from(quotation).where(eq(quotation.id, id)).limit(1);
      if (!q || q.converted) return; // converted quotations are locked
      await tx.update(quotation).set({ status, updatedAt: new Date() }).where(eq(quotation.id, id));
    });
  }
  revalidatePath('/quotations');
  revalidatePath(`/quotations/${id}`);
}

export async function convertToInvoiceAction(formData: FormData): Promise<void> {
  const u = await requirePermission('invoice.create');
  const quotationId = String(formData.get('quotationId') ?? '');

  const { invoiceId } = await withTenant(u.tenantId, u.userId, (tx) =>
    convertQuotationTx(tx, u, quotationId),
  );

  revalidatePath('/quotations');
  revalidatePath('/invoices');
  redirect(`/invoices/${invoiceId}`);
}
