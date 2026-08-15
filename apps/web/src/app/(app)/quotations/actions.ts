'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { quotationInput, QUOTATION_SETTABLE_STATUSES } from '@ms/core';
import { withTenant, quotation, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertQuotationTx, updateQuotationTx, convertQuotationTx, convertQuotationToOrderTx, duplicateQuotationTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

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

export async function updateQuotationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('quotation.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing quotation' };

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

  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      updateQuotationTx(tx, u, id, {
        docDate: d.docDate, validityDays: d.validityDays, terms: d.terms, notes: d.notes, items: d.items,
      }),
    );
  } catch (e) {
    return { error: toActionError(e) };
  }

  revalidatePath('/quotations');
  revalidatePath(`/quotations/${id}`);
  redirect(`/quotations/${id}`);
}

export async function setQuotationStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('quotation.edit');
    if (!id || !(QUOTATION_SETTABLE_STATUSES as readonly string[]).includes(status)) return { error: 'Invalid status' };
    let locked = false;
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ converted: quotation.convertedInvoiceId }).from(quotation).where(eq(quotation.id, id)).limit(1);
      if (!q || q.converted) { locked = true; return; } // converted quotations are locked
      await tx.update(quotation).set({ status, updatedAt: new Date() }).where(eq(quotation.id, id));
    });
    if (locked) return { error: 'This quotation is converted to an invoice and can no longer change status.' };
    revalidatePath('/quotations');
    revalidatePath(`/quotations/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function convertToOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let orderId: string | undefined;
  try {
    const u = await requirePermission('order.create');
    const quotationId = String(formData.get('quotationId') ?? '');
    if (!quotationId) return { error: 'Missing quotation' };
    const res = await withTenant(u.tenantId, u.userId, (tx) =>
      convertQuotationToOrderTx(tx, u, quotationId, {
        orderCategory: (formData.get('orderCategory') as never) || undefined,
        materialOwnership: (formData.get('materialOwnership') as never) || undefined,
      }),
    );
    orderId = res.orderId;
    revalidatePath('/quotations');
    revalidatePath('/orders');
    revalidatePath(`/quotations/${quotationId}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (orderId) redirect(`/orders/${orderId}`);
  return { ok: true };
}

export async function duplicateQuotationAction(formData: FormData): Promise<void> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('quotation.create');
    const id = String(formData.get('id') ?? '');
    if (!id) throw new Error('Missing quotation');
    const res = await withTenant(u.tenantId, u.userId, (tx) => duplicateQuotationTx(tx, u, id));
    newId = res.id;
    revalidatePath('/quotations');
  } catch (e) {
    throw new Error(toActionError(e));
  }
  if (newId) redirect(`/quotations/${newId}/edit`);
}

export async function convertToInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let invoiceId: string | undefined;
  try {
    const u = await requirePermission('invoice.create');
    const quotationId = String(formData.get('quotationId') ?? '');
    if (!quotationId) return { error: 'Missing quotation' };

    // Don't let a rejected quote become a tax invoice by accident.
    const guard = await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ status: quotation.status }).from(quotation).where(eq(quotation.id, quotationId)).limit(1);
      return q?.status;
    });
    if (guard === 'rejected') return { error: 'This quotation is rejected. Set it back to Draft or Sent before converting.' };

    const res = await withTenant(u.tenantId, u.userId, (tx) => convertQuotationTx(tx, u, quotationId));
    invoiceId = res.invoiceId;
    revalidatePath('/quotations');
    revalidatePath('/invoices');
    revalidatePath(`/quotations/${quotationId}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (invoiceId) redirect(`/invoices/${invoiceId}`);
  return { ok: true };
}
