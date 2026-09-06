'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { orderInput, firstZodMessage, ORDER_SETTABLE_STATUSES } from '@ms/core';
import { withTenant, salesOrder, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertOrderTx, updateOrderTx, convertOrderToInvoiceTx, duplicateOrderTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string };

const BAD_ITEMS = 'The items could not be read — refresh the page and try again.';
const NOT_FOUND = 'This order could not be found — refresh the page and try again.';

function parseJson(raw: FormDataEntryValue | null, fallback: unknown): unknown {
  try { return JSON.parse(String(raw ?? '')); } catch { return fallback; }
}

function readForm(formData: FormData, withQuotation: boolean) {
  const items = parseJson(formData.get('items'), null);
  return {
    items,
    input: {
      customerId: formData.get('customerId'),
      docDate: formData.get('docDate'),
      poRef: formData.get('poRef') || undefined,
      orderCategory: formData.get('orderCategory') || undefined,
      materialOwnership: formData.get('materialOwnership') || undefined,
      deliveryDate: formData.get('deliveryDate') || undefined,
      ...(withQuotation ? { quotationId: formData.get('quotationId') || undefined } : {}),
      items,
      columnDefs: parseJson(formData.get('columnDefs'), []),
    },
  };
}

export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('order.create');
    const { items, input } = readForm(formData, true);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = orderInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const created = await insertOrderTx(tx, u, parsed.data);
      newId = created.id;
    });
    revalidatePath('/orders');
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (newId) redirect(`/orders/${newId}?created=1`);
  return {};
}

export async function updateOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: NOT_FOUND };
  try {
    const u = await requirePermission('order.edit');
    const { items, input } = readForm(formData, false);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = orderInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };
    const d = parsed.data;

    await withTenant(u.tenantId, u.userId, (tx) =>
      updateOrderTx(tx, u, id, {
        docDate: d.docDate, poRef: d.poRef, orderCategory: d.orderCategory,
        materialOwnership: d.materialOwnership, deliveryDate: d.deliveryDate,
        items: d.items, columnDefs: d.columnDefs,
      }),
    );
    revalidatePath('/orders');
    revalidatePath(`/orders/${id}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(`/orders/${id}?saved=1`);
}

export async function setOrderStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('order.edit');
    if (!id || !(ORDER_SETTABLE_STATUSES as readonly string[]).includes(status)) return { error: 'That status is not available — pick one from the list.' };
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

/** Mark an order cancelled. Separate confirmed action — never in a dropdown. */
export async function cancelOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('order.edit');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(salesOrder).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(salesOrder.id, id)),
    );
    revalidatePath('/orders');
    revalidatePath(`/orders/${id}`);
    return { ok: true, message: 'Order cancelled' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/** Copy an order into a fresh one and open it. useActionState-compatible so a failure toasts instead of crashing the page. */
export async function duplicateOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('order.create');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };
    const res = await withTenant(u.tenantId, u.userId, (tx) => duplicateOrderTx(tx, u, id));
    newId = res.id;
    revalidatePath('/orders');
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (newId) redirect(`/orders/${newId}?created=made`);
  return { ok: true };
}

export async function convertOrderToInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let invoiceId: string | undefined;
  try {
    const u = await requirePermission('invoice.create');
    const orderId = String(formData.get('orderId') ?? '');
    if (!orderId) return { error: NOT_FOUND };
    const res = await withTenant(u.tenantId, u.userId, (tx) => convertOrderToInvoiceTx(tx, u, orderId));
    invoiceId = res.invoiceId;
    revalidatePath('/orders');
    revalidatePath('/invoices');
    revalidatePath(`/orders/${orderId}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (invoiceId) redirect(`/invoices/${invoiceId}?created=made`);
  return { ok: true };
}
