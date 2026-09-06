'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { quotationInput, firstZodMessage, QUOTATION_SETTABLE_STATUSES } from '@ms/core';
import { withTenant, quotation, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertQuotationTx, updateQuotationTx, convertQuotationTx, convertQuotationToOrderTx, duplicateQuotationTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string };

const BAD_ITEMS = 'The items could not be read — refresh the page and try again.';

function parseJson(raw: FormDataEntryValue | null, fallback: unknown): unknown {
  try { return JSON.parse(String(raw ?? '')); } catch { return fallback; }
}

function readForm(formData: FormData) {
  const items = parseJson(formData.get('items'), null);
  return {
    items,
    input: {
      customerId: formData.get('customerId'),
      docDate: formData.get('docDate'),
      validityDays: formData.get('validityDays'),
      terms: formData.get('terms') || undefined,
      notes: formData.get('notes') || undefined,
      items,
      columnDefs: parseJson(formData.get('columnDefs'), []),
    },
  };
}

export async function createQuotationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('quotation.create');
    const { items, input } = readForm(formData);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = quotationInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const created = await insertQuotationTx(tx, u, parsed.data);
      newId = created.id;
    });
    revalidatePath('/quotations');
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (newId) redirect(`/quotations/${newId}?created=1`);
  return {};
}

export async function updateQuotationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'This quotation could not be found — refresh the page and try again.' };
  try {
    const u = await requirePermission('quotation.edit');
    const { items, input } = readForm(formData);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = quotationInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };
    const d = parsed.data;

    await withTenant(u.tenantId, u.userId, (tx) =>
      updateQuotationTx(tx, u, id, {
        docDate: d.docDate, validityDays: d.validityDays, terms: d.terms, notes: d.notes,
        items: d.items, columnDefs: d.columnDefs,
      }),
    );
    revalidatePath('/quotations');
    revalidatePath(`/quotations/${id}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(`/quotations/${id}?saved=1`);
}

export async function setQuotationStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('quotation.edit');
    if (!id || !(QUOTATION_SETTABLE_STATUSES as readonly string[]).includes(status)) return { error: 'That status is not available — pick one from the list.' };
    let locked = false;
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ converted: quotation.convertedInvoiceId }).from(quotation).where(eq(quotation.id, id)).limit(1);
      if (!q || q.converted) { locked = true; return; } // converted quotations are locked
      await tx.update(quotation).set({ status, updatedAt: new Date() }).where(eq(quotation.id, id));
    });
    if (locked) return { error: "A bill has already been made from this quotation, so its status can't change now." };
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
    if (!quotationId) return { error: 'This quotation could not be found — refresh the page and try again.' };
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
  if (orderId) redirect(`/orders/${orderId}?created=made`);
  return { ok: true };
}

/** Copy a quotation into a fresh draft and open it for editing. useActionState-compatible so a failure toasts instead of crashing the page. */
export async function duplicateQuotationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('quotation.create');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'This quotation could not be found — refresh the page and try again.' };
    const res = await withTenant(u.tenantId, u.userId, (tx) => duplicateQuotationTx(tx, u, id));
    newId = res.id;
    revalidatePath('/quotations');
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (newId) redirect(`/quotations/${newId}/edit`);
  return { ok: true };
}

export async function convertToInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let invoiceId: string | undefined;
  try {
    const u = await requirePermission('invoice.create');
    const quotationId = String(formData.get('quotationId') ?? '');
    if (!quotationId) return { error: 'This quotation could not be found — refresh the page and try again.' };

    // Don't let a declined quote become a tax invoice by accident.
    const guard = await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ status: quotation.status }).from(quotation).where(eq(quotation.id, quotationId)).limit(1);
      return q?.status;
    });
    if (guard === 'rejected') return { error: 'This quotation was declined — change its status to Sent or Approved first.' };

    const res = await withTenant(u.tenantId, u.userId, (tx) => convertQuotationTx(tx, u, quotationId));
    invoiceId = res.invoiceId;
    revalidatePath('/quotations');
    revalidatePath('/invoices');
    revalidatePath(`/quotations/${quotationId}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (invoiceId) redirect(`/invoices/${invoiceId}?created=made`);
  return { ok: true };
}
