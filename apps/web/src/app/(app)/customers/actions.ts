'use server';
import { revalidatePath } from 'next/cache';
import { customerInput } from '@ms/core';
import { withTenant, customer, quotation, taxInvoice, salesOrder, eq, count } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string; ok?: boolean };

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('customer.create');
  const parsed = customerInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const d = parsed.data;
  await withTenant(u.tenantId, u.userId, (tx) =>
    tx.insert(customer).values({
      tenantId: u.tenantId,
      name: d.name,
      regType: d.regType,
      gstin: d.gstin,
      stateCode: d.stateCode,
      contactPerson: d.contactPerson,
      phone: d.phone,
      email: d.email,
      address: d.address,
      creditTermsDays: d.creditTermsDays,
    }),
  );
  revalidatePath('/customers');
  return { ok: true };
}

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('customer.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing customer' };
  const parsed = customerInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(customer).set({
        name: d.name, regType: d.regType, gstin: d.gstin, stateCode: d.stateCode,
        contactPerson: d.contactPerson, phone: d.phone, email: d.email, address: d.address,
        creditTermsDays: d.creditTermsDays, updatedAt: new Date(),
      }).where(eq(customer.id, id)),
    );
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  return { ok: true };
}

export async function deleteCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('customer.delete');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'Missing customer' };

    const links = await withTenant(u.tenantId, u.userId, async (tx) => {
      const [q] = await tx.select({ n: count() }).from(quotation).where(eq(quotation.customerId, id));
      const [i] = await tx.select({ n: count() }).from(taxInvoice).where(eq(taxInvoice.customerId, id));
      const [o] = await tx.select({ n: count() }).from(salesOrder).where(eq(salesOrder.customerId, id));
      return { quotes: Number(q?.n ?? 0), invoices: Number(i?.n ?? 0), orders: Number(o?.n ?? 0) };
    });
    const total = links.quotes + links.invoices + links.orders;
    if (total > 0) {
      const parts = [
        links.invoices && `${links.invoices} invoice(s)`,
        links.quotes && `${links.quotes} quotation(s)`,
        links.orders && `${links.orders} order(s)`,
      ].filter(Boolean).join(', ');
      return { error: `This customer has ${parts} and can't be deleted (it would orphan those records). Archive it instead.` };
    }

    await withTenant(u.tenantId, u.userId, (tx) => tx.delete(customer).where(eq(customer.id, id)));
    revalidatePath('/customers');
    return { ok: true, message: 'Customer deleted' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/** Reversible archive/restore — the safe alternative to deleting a customer with history. */
export async function setCustomerStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('customer.edit');
    if (!id || !['active', 'archived'].includes(status)) return { error: 'Invalid status' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(customer).set({ status, updatedAt: new Date() }).where(eq(customer.id, id)),
    );
    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: status === 'archived' ? 'Customer archived' : 'Customer restored' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
