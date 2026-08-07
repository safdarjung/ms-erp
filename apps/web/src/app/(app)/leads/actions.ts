'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { leadInput, LEAD_STAGES, LEAD_ACTIVITY_TYPES } from '@ms/core';
import { withTenant, lead, leadActivity, customer, eq, ilike } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { toActionError, type ActionResult } from '@/lib/forms';

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

export async function updateLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing lead' };
  const parsed = leadInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const followupRaw = String(formData.get('nextFollowupAt') ?? '').trim();
  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({
        customerName: d.customerName, contact: d.contact, phone: d.phone, email: d.email,
        source: d.source, requirement: d.requirement, stage: d.stage,
        valueEstimate: d.valueEstimate != null ? String(d.valueEstimate) : null,
        nextFollowupAt: followupRaw ? new Date(followupRaw) : null,
        updatedAt: new Date(),
      }).where(eq(lead.id, id)),
    );
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath('/leads');
  revalidatePath(`/leads/${id}`);
  return { ok: true };
}

export async function addLeadActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead.edit');
  const id = String(formData.get('leadId') ?? '');
  const type = String(formData.get('type') ?? 'note');
  const notes = String(formData.get('notes') ?? '').trim();
  const followupRaw = String(formData.get('nextFollowupAt') ?? '').trim();
  if (!id) return { error: 'Missing lead' };
  if (!notes && !(LEAD_ACTIVITY_TYPES as readonly string[]).includes(type)) return { error: 'Add a note' };
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      await tx.insert(leadActivity).values({
        tenantId: u.tenantId, leadId: id,
        type: (LEAD_ACTIVITY_TYPES as readonly string[]).includes(type) ? type : 'note',
        notes: notes || null, byUserId: u.userId,
      });
      if (followupRaw) await tx.update(lead).set({ nextFollowupAt: new Date(followupRaw), updatedAt: new Date() }).where(eq(lead.id, id));
    });
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath(`/leads/${id}`);
  revalidatePath('/leads');
  return { ok: true };
}

export async function assignLeadAction(id: string, userId: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead.edit');
    if (!id) return { error: 'Missing lead' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({ ownerUserId: userId || null, updatedAt: new Date() }).where(eq(lead.id, id)),
    );
    revalidatePath(`/leads/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function setLeadStageAction(id: string, stage: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead.edit');
    if (!id || !(LEAD_STAGES as readonly string[]).includes(stage)) return { error: 'Invalid stage' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({ stage, updatedAt: new Date() }).where(eq(lead.id, id)),
    );
    revalidatePath('/leads');
    revalidatePath(`/leads/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/**
 * Won-lead → customer. Dedupes against an existing customer of the same name
 * (case-insensitive) so converting twice doesn't create a duplicate; carries
 * across contact person, phone and email.
 */
export async function convertLeadToCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('customer.create');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'Missing lead' };

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
      if (!l || l.convertedCustomerId) return;
      const [dupe] = await tx.select({ id: customer.id }).from(customer)
        .where(ilike(customer.name, l.customerName)).limit(1);
      let customerId = dupe?.id;
      if (!customerId) {
        const [c] = await tx.insert(customer).values({
          tenantId: u.tenantId,
          name: l.customerName,
          contactPerson: l.contact,
          phone: l.phone,
          email: l.email,
        }).returning({ id: customer.id });
        customerId = c!.id;
      }
      await tx.update(lead)
        .set({ stage: 'won', convertedCustomerId: customerId, updatedAt: new Date() })
        .where(eq(lead.id, id));
    });

    revalidatePath('/leads');
    revalidatePath('/customers');
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect('/customers');
}
