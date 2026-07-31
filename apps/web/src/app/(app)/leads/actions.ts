'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { leadInput, LEAD_STAGES } from '@ms/core';
import { withTenant, lead, customer, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';

export type ActionState = { error?: string; ok?: boolean };

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead.create');
  const parsed = leadInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const d = parsed.data;
  await withTenant(u.tenantId, u.userId, (tx) =>
    tx.insert(lead).values({
      tenantId: u.tenantId,
      customerName: d.customerName,
      contact: d.contact,
      phone: d.phone,
      email: d.email,
      source: d.source,
      requirement: d.requirement,
      stage: d.stage,
      ownerUserId: u.userId,
      valueEstimate: d.valueEstimate != null ? String(d.valueEstimate) : undefined,
    }),
  );
  revalidatePath('/leads');
  return { ok: true };
}

export async function setLeadStageAction(formData: FormData): Promise<void> {
  const u = await requirePermission('lead.edit');
  const id = String(formData.get('id') ?? '');
  const stage = String(formData.get('stage') ?? '');
  if (id && (LEAD_STAGES as readonly string[]).includes(stage)) {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({ stage, updatedAt: new Date() }).where(eq(lead.id, id)),
    );
  }
  revalidatePath('/leads');
}

/** One-click won-lead → customer. Idempotent: re-running lands on the existing customer. */
export async function convertLeadToCustomerAction(formData: FormData): Promise<void> {
  const u = await requirePermission('customer.create');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withTenant(u.tenantId, u.userId, async (tx) => {
    const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
    if (!l || l.convertedCustomerId) return;
    const [c] = await tx.insert(customer).values({
      tenantId: u.tenantId,
      name: l.customerName,
      contactPerson: l.contact,
      phone: l.phone,
      email: l.email,
    }).returning({ id: customer.id });
    await tx.update(lead)
      .set({ stage: 'won', convertedCustomerId: c!.id, updatedAt: new Date() })
      .where(eq(lead.id, id));
  });

  revalidatePath('/leads');
  revalidatePath('/customers');
  redirect('/customers');
}
