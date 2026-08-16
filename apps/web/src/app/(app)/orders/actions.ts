'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { orderInput, ORDER_SETTABLE_STATUSES } from '@ms/core';
import { withTenant, salesOrder, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertOrderTx, convertOrderToInvoiceTx, duplicateOrderTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string };

export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('order.create');

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'));
  } catch {
    return { error: 'Invalid line items' };
  }
  let columnDefs: unknown = [];
  try { columnDefs = JSON.parse(String(formData.get('columnDefs') ?? '[]')); } catch { columnDefs = []; }

  const parsed = orderInput.safeParse({
    customerId: formData.get('customerId'),
    docDate: formData.get('docDate'),
    poRef: formData.get('poRef') || undefined,
    orderCategory: formData.get('orderCategory') || undefined,
    materialOwnership: formData.get('materialOwnership') || undefined,
    deliveryDate: formData.get('deliveryDate') || undefined,
    quotationId: formData.get('quotationId') || undefined,
    items,
    columnDefs,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  let newId: string | undefined;
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const created = await insertOrderTx(tx, u, parsed.data);
      newId = created.id;
    });
  } catch (e) {
    return { error: toActionError(e) };
  }

  revalidatePath('/orders');
  if (newId) redirect(`/orders/${newId}`);
  return {};
}

export async function setOrderStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('order.edit');
    if (!id || !(ORDER_SETTABLE_STATUSES as readonly string[]).includes(status)) return { error: 'Invalid status' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(salesOrder).set({ status, updatedAt: new Date() }).where(eq(salesOrder.id, id)),
    );
    revalidatePath('/orders');
    revalidatePath(`/orders/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function duplicateOrderAction(formData: FormData): Promise<void> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('order.create');
    const id = String(formData.get('id') ?? '');
    if (!id) throw new Error('Missing order');
    const res = await withTenant(u.tenantId, u.userId, (tx) => duplicateOrderTx(tx, u, id));
    newId = res.id;
    revalidatePath('/orders');
  } catch (e) {
    throw new Error(toActionError(e));
  }
  if (newId) redirect(`/orders/${newId}`);
}

export async function convertOrderToInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let invoiceId: string | undefined;
  try {
    const u = await requirePermission('invoice.create');
    const orderId = String(formData.get('orderId') ?? '');
    if (!orderId) return { error: 'Missing order' };
    const res = await withTenant(u.tenantId, u.userId, (tx) => convertOrderToInvoiceTx(tx, u, orderId));
    invoiceId = res.invoiceId;
    revalidatePath('/orders');
    revalidatePath('/invoices');
    revalidatePath(`/orders/${orderId}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (invoiceId) redirect(`/invoices/${invoiceId}`);
  return { ok: true };
}
