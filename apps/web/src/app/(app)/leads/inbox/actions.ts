'use server';
import { revalidatePath } from 'next/cache';
import { leadInput } from '@ms/core';
import { withTenant, inboundMessage, and, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { createLeadRecord } from '@/lib/documents';
import { toActionError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string; ok?: boolean };

/**
 * Turn a pending inbound message into a lead. Uses a claimed transition
 * (status pending → converted) so two people acting on the same row can't create
 * two leads; the shared `createLeadRecord` keeps this identical to the manual form.
 */
export async function createLeadFromInboundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead_inbox.manage');
  const inboundId = String(formData.get('inboundId') ?? '');
  if (!inboundId) return { error: 'Missing message' };

  const parsed = leadInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [claim] = await tx.update(inboundMessage)
        .set({ status: 'converted', updatedAt: new Date() })
        .where(and(eq(inboundMessage.id, inboundId), eq(inboundMessage.status, 'pending')))
        .returning({ id: inboundMessage.id });
      if (!claim) throw new Error('This message was already handled.');
      const created = await createLeadRecord(tx, u.tenantId, {
        ...d, ownerUserId: u.userId, inboundMessageId: inboundId,
      });
      await tx.update(inboundMessage).set({ leadId: created.id, updatedAt: new Date() })
        .where(eq(inboundMessage.id, inboundId));
    });
  } catch (e) {
    return { error: toActionError(e) };
  }

  revalidatePath('/leads/inbox');
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Dismiss a pending inbound message (spam/irrelevant) without creating a lead. */
export async function ignoreInboundAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead_inbox.manage');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'Missing message' };
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(inboundMessage).set({ status: 'ignored', updatedAt: new Date() })
        .where(and(eq(inboundMessage.id, id), eq(inboundMessage.status, 'pending'))),
    );
    revalidatePath('/leads/inbox');
    return { ok: true, message: 'Message dismissed.' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
