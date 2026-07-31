'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { invoiceInput, INVOICE_STATUSES } from '@ms/core';
import { withTenant, taxInvoice, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertInvoiceTx } from '@/lib/documents';

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

  let newId: string | undefined;
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const created = await insertInvoiceTx(tx, u, parsed.data);
      newId = created.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create invoice' };
  }

  revalidatePath('/invoices');
  if (newId) redirect(`/invoices/${newId}`);
  return {};
}

export async function setInvoiceStatusAction(formData: FormData): Promise<void> {
  const u = await requirePermission('invoice.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (id && (INVOICE_STATUSES as readonly string[]).includes(status)) {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(taxInvoice).set({ status, updatedAt: new Date() }).where(eq(taxInvoice.id, id)),
    );
  }
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
}
