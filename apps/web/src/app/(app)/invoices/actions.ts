'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { invoiceInput, INVOICE_STATUSES, paymentInput } from '@ms/core';
import { withTenant, taxInvoice, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertInvoiceTx, updateInvoiceTx, recordPaymentTx, deletePaymentTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string };

export async function updateInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('invoice.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing invoice' };

  let items: unknown;
  try { items = JSON.parse(String(formData.get('items') ?? '[]')); } catch { return { error: 'Invalid line items' }; }
  let columnDefs: unknown = [];
  try { columnDefs = JSON.parse(String(formData.get('columnDefs') ?? '[]')); } catch { columnDefs = []; }

  const parsed = invoiceInput.safeParse({
    customerId: formData.get('customerId'),
    docDate: formData.get('docDate'),
    poRef: formData.get('poRef') || undefined,
    terms: formData.get('terms') || undefined,
    items,
    columnDefs,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      updateInvoiceTx(tx, u, id, { docDate: d.docDate, poRef: d.poRef, terms: d.terms, items: d.items, columnDefs: d.columnDefs }),
    );
  } catch (e) {
    return { error: toActionError(e) };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('invoice.create');

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'));
  } catch {
    return { error: 'Invalid line items' };
  }
  let columnDefs: unknown = [];
  try { columnDefs = JSON.parse(String(formData.get('columnDefs') ?? '[]')); } catch { columnDefs = []; }

  const parsed = invoiceInput.safeParse({
    customerId: formData.get('customerId'),
    docDate: formData.get('docDate'),
    poRef: formData.get('poRef') || undefined,
    terms: formData.get('terms') || undefined,
    items,
    columnDefs,
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

export async function recordPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('invoice.edit');
    const parsed = paymentInput.safeParse({
      invoiceId: formData.get('invoiceId'),
      amount: formData.get('amount'),
      paidOn: formData.get('paidOn'),
      method: formData.get('method') || undefined,
      reference: formData.get('reference') || undefined,
      notes: formData.get('notes') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    await withTenant(u.tenantId, u.userId, (tx) => recordPaymentTx(tx, u, parsed.data));
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Payment recorded' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function deletePaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('invoice.edit');
    const paymentId = String(formData.get('paymentId') ?? '');
    const invoiceId = String(formData.get('invoiceId') ?? '');
    if (!paymentId) return { error: 'Missing payment' };
    await withTenant(u.tenantId, u.userId, (tx) => deletePaymentTx(tx, u, paymentId));
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Payment removed' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function setInvoiceStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('invoice.edit');
    if (!id || !(INVOICE_STATUSES as readonly string[]).includes(status)) return { error: 'Invalid status' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(taxInvoice).set({ status, updatedAt: new Date() }).where(eq(taxInvoice.id, id)),
    );
    revalidatePath('/invoices');
    revalidatePath(`/invoices/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
