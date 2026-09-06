'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { invoiceInput, paymentInput, firstZodMessage, formatINR } from '@ms/core';
import { withTenant, taxInvoice, payment, eq, sum } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { insertInvoiceTx, updateInvoiceTx, recordPaymentTx, deletePaymentTx } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string };

const BAD_ITEMS = 'The items could not be read — refresh the page and try again.';
const NOT_FOUND = 'This bill could not be found — refresh the page and try again.';

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
      poRef: formData.get('poRef') || undefined,
      terms: formData.get('terms') || undefined,
      notes: formData.get('notes') || undefined,
      items,
      columnDefs: parseJson(formData.get('columnDefs'), []),
    },
  };
}

export async function updateInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: NOT_FOUND };
  try {
    const u = await requirePermission('invoice.edit');
    const { items, input } = readForm(formData);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = invoiceInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };
    const d = parsed.data;

    await withTenant(u.tenantId, u.userId, (tx) =>
      updateInvoiceTx(tx, u, id, {
        docDate: d.docDate, poRef: d.poRef ?? '', terms: d.terms ?? '', notes: d.notes ?? '',
        items: d.items, columnDefs: d.columnDefs,
      }),
    );
    revalidatePath('/invoices');
    revalidatePath(`/invoices/${id}`);
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(`/invoices/${id}?saved=1`);
}

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string | undefined;
  try {
    const u = await requirePermission('invoice.create');
    const { items, input } = readForm(formData);
    if (items === null) return { error: BAD_ITEMS };
    const parsed = invoiceInput.safeParse(input);
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const created = await insertInvoiceTx(tx, u, parsed.data);
      newId = created.id;
    });
    revalidatePath('/invoices');
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (newId) redirect(`/invoices/${newId}?created=1`);
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
    if (!parsed.success) return { error: firstZodMessage(parsed.error) };
    const invoiceId = parsed.data.invoiceId;

    const res = await withTenant(u.tenantId, u.userId, async (tx) => {
      const r = await recordPaymentTx(tx, u, parsed.data);
      // What's still due after this receipt, for the toast.
      const [inv] = await tx.select({ grandTotal: taxInvoice.grandTotal }).from(taxInvoice).where(eq(taxInvoice.id, invoiceId)).limit(1);
      const [agg] = await tx.select({ received: sum(payment.amount) }).from(payment).where(eq(payment.invoiceId, invoiceId));
      const due = Math.max(0, Math.round((Number(inv?.grandTotal ?? 0) - Number(agg?.received ?? 0)) * 100) / 100);
      return { ...r, due };
    });
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    const message = res.fullyPaid
      ? `${formatINR(res.amount)} received · Bill fully paid ✓`
      : `${formatINR(res.amount)} received · ${formatINR(res.due)} still due`;
    return { ok: true, message };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function deletePaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('invoice.edit');
    const paymentId = String(formData.get('paymentId') ?? '');
    const invoiceId = String(formData.get('invoiceId') ?? '');
    if (!paymentId) return { error: 'This payment could not be found — refresh the page and try again.' };
    await withTenant(u.tenantId, u.userId, (tx) => deletePaymentTx(tx, u, paymentId));
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Payment removed' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/** Mark a bill cancelled. Separate confirmed action — never in a dropdown. */
export async function cancelInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('invoice.edit');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(taxInvoice).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(taxInvoice.id, id)),
    );
    revalidatePath('/invoices');
    revalidatePath(`/invoices/${id}`);
    revalidatePath('/dashboard');
    return { ok: true, message: 'Bill cancelled' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
