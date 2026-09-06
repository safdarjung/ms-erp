'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { customerInput, type CustomerInput } from '@ms/core';
import { withTenant, customer, quotation, taxInvoice, salesOrder, eq, count, sql, type Tx } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { toActionError, fieldError, type ActionResult } from '@/lib/forms';

export type ActionState = {
  error?: string;
  field?: string;
  ok?: boolean;
  message?: string;
  /** Set when a create was blocked because a matching customer already exists. */
  duplicateId?: string;
  duplicateName?: string;
};

const DEFAULT_STATE_CODE = '06';

const last10Digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D+/g, '').slice(-10);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Values the DB should hold — registration and state always follow the GSTIN. */
function normalise(d: CustomerInput) {
  const gstin = d.gstin?.toUpperCase();
  const stateFromGstin = gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : undefined;
  return {
    ...d,
    gstin,
    regType: gstin ? 'registered' : 'unregistered',
    stateCode: stateFromGstin ?? d.stateCode ?? DEFAULT_STATE_CODE,
  };
}
type CustomerFields = ReturnType<typeof normalise>;

function parseCustomer(formData: FormData): { data: CustomerFields } | { error: ActionState } {
  const parsed = customerInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: fieldError(parsed.error.issues[0]) };
  return { data: normalise(parsed.data) };
}

type Duplicate = { id: string; name: string; phone: string | null; by: 'gstin' | 'phone' };

/** An existing customer with the same GSTIN, or the same 10-digit phone. */
async function findDuplicate(tx: Tx, d: { gstin?: string; phone?: string }): Promise<Duplicate | null> {
  const cols = { id: customer.id, name: customer.name, phone: customer.phone };
  if (d.gstin) {
    const [row] = await tx.select(cols).from(customer).where(eq(customer.gstin, d.gstin)).limit(1);
    if (row) return { ...row, by: 'gstin' };
  }
  const p10 = last10Digits(d.phone);
  if (p10.length === 10) {
    const [row] = await tx.select(cols).from(customer)
      .where(sql`right(regexp_replace(coalesce(${customer.phone}, ''), '\\D', '', 'g'), 10) = ${p10}`)
      .limit(1);
    if (row) return { ...row, by: 'phone' };
  }
  return null;
}

function duplicateResult(dupe: Duplicate, d: CustomerFields): ActionState {
  const same = dupe.by === 'gstin' ? `same GSTIN ${d.gstin}` : `same phone ${last10Digits(dupe.phone) || d.phone}`;
  return {
    error: `Looks like ${dupe.name} already exists (${same}). Open them instead, or tick 'Add anyway'.`,
    field: dupe.by,
    duplicateId: dupe.id,
    duplicateName: dupe.name,
  };
}

/** Only same-origin relative paths may be used as a post-save destination. */
function safeReturnPath(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('://') || /[\s\\]/.test(s)) return null;
  return s;
}
const withParam = (path: string, key: string, value: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

/**
 * Create a customer. Blocks likely duplicates (same GSTIN / phone) unless the
 * form sent `allowDuplicate=1`. On success, goes back to `return` (a document
 * form) with `?customer=<id>`, or to the new customer's page.
 */
export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string | null = null;
  try {
    const u = await requirePermission('customer.create');
    const parsed = parseCustomer(formData);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;
    const allowDuplicate = String(formData.get('allowDuplicate') ?? '') === '1';

    const result = await withTenant(u.tenantId, u.userId, async (tx): Promise<{ dupe: Duplicate } | { id: string }> => {
      const dupe = allowDuplicate ? null : await findDuplicate(tx, d);
      if (dupe) return { dupe };
      const [c] = await tx.insert(customer).values({
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
      }).returning({ id: customer.id });
      return { id: c!.id };
    });
    if ('dupe' in result) return duplicateResult(result.dupe, d);

    revalidatePath('/customers');
    const back = safeReturnPath(formData.get('return'));
    destination = back ? withParam(back, 'customer', result.id) : `/customers/${result.id}?added=1`;
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(destination);
}

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission('customer.edit');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: "Couldn't find that customer — it may have been deleted. Refresh and try again." };
    const parsed = parseCustomer(formData);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;

    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(customer).set({
        name: d.name, regType: d.regType, gstin: d.gstin, stateCode: d.stateCode,
        contactPerson: d.contactPerson, phone: d.phone, email: d.email, address: d.address,
        creditTermsDays: d.creditTermsDays, updatedAt: new Date(),
      }).where(eq(customer.id, id)),
    );
    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: 'Customer saved' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/**
 * Delete a customer that has no documents. Pass `redirectTo` (e.g. from the
 * detail page) to navigate away afterwards; otherwise the result is returned.
 */
export async function deleteCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let destination: string | null = null;
  let name = 'Customer';
  try {
    const u = await requirePermission('customer.delete');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: "Couldn't find that customer — it may have been deleted. Refresh and try again." };

    const info = await withTenant(u.tenantId, u.userId, async (tx) => {
      const [c] = await tx.select({ name: customer.name }).from(customer).where(eq(customer.id, id)).limit(1);
      const [q] = await tx.select({ n: count() }).from(quotation).where(eq(quotation.customerId, id));
      const [i] = await tx.select({ n: count() }).from(taxInvoice).where(eq(taxInvoice.customerId, id));
      const [o] = await tx.select({ n: count() }).from(salesOrder).where(eq(salesOrder.customerId, id));
      return { name: c?.name, quotes: Number(q?.n ?? 0), bills: Number(i?.n ?? 0), orders: Number(o?.n ?? 0) };
    });
    if (!info.name) return { error: "Couldn't find that customer — it may have been deleted. Refresh and try again." };
    name = info.name;

    if (info.quotes + info.bills + info.orders > 0) {
      const parts = [
        info.bills > 0 && plural(info.bills, 'bill', 'bills'),
        info.orders > 0 && plural(info.orders, 'order', 'orders'),
        info.quotes > 0 && plural(info.quotes, 'quotation', 'quotations'),
      ].filter((p): p is string => Boolean(p));
      const has = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
      return { error: `Can't delete — ${name} has ${has}. Use Hide (archive) instead.` };
    }

    await withTenant(u.tenantId, u.userId, (tx) => tx.delete(customer).where(eq(customer.id, id)));
    revalidatePath('/customers');
    destination = safeReturnPath(formData.get('redirectTo'));
  } catch (e) {
    return { error: toActionError(e) };
  }
  if (destination) redirect(destination);
  return { ok: true, message: `${name} deleted` };
}

async function setStatus(id: string, status: string): Promise<ActionResult> {
  const u = await requirePermission('customer.edit');
  if (!id || !['active', 'archived'].includes(status)) {
    return { error: "Couldn't find that customer — it may have been deleted. Refresh and try again." };
  }
  const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.update(customer).set({ status, updatedAt: new Date() }).where(eq(customer.id, id))
      .returning({ name: customer.name }),
  );
  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  const name = row?.name ?? 'Customer';
  return {
    ok: true,
    message: status === 'archived' ? `${name} hidden from lists — their bills are untouched.` : `${name} is back in lists.`,
  };
}

/** Reversible hide/unhide — the safe alternative to deleting a customer with history. */
export async function setCustomerStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    return await setStatus(id, status);
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/** Same as `setCustomerStatusAction`, in the form-action shape `ConfirmButton` needs. */
export async function setCustomerStatusFormAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    return await setStatus(String(formData.get('id') ?? ''), String(formData.get('status') ?? ''));
  } catch (e) {
    return { error: toActionError(e) };
  }
}
