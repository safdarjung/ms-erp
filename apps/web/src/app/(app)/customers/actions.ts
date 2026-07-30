'use server';
import { revalidatePath } from 'next/cache';
import { customerInput } from '@ms/core';
import { withTenant, customer, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';

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
      creditTermsDays: d.creditTermsDays,
    }),
  );
  revalidatePath('/customers');
  return { ok: true };
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const u = await requirePermission('customer.delete');
  const id = String(formData.get('id') ?? '');
  if (id) await withTenant(u.tenantId, u.userId, (tx) => tx.delete(customer).where(eq(customer.id, id)));
  revalidatePath('/customers');
}
