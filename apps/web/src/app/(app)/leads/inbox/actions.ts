'use server';
import { revalidatePath } from 'next/cache';
import { leadInput } from '@ms/core';
import { withTenant, inboundMessage, and, eq, inArray } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { createLeadRecord } from '@/lib/documents';
import { toActionError, fieldError, UserError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string; field?: string; ok?: boolean; message?: string };

const MESSAGE_NOT_FOUND = "Couldn't find that message — it may have been removed. Refresh and try again.";
const NAME_REQUIRED = "Enter the company or person's name";
const OTHER_SOURCE = 'Other';

/**
 * Statuses a person may still turn into an enquiry by hand: the automatic
 * spam / duplicate / dismiss decisions are all recoverable.
 */
const CLAIMABLE_STATUSES = ['pending', 'spam', 'duplicate', 'ignored', 'dismissed', 'failed'];

// Same shape as leads/actions.ts parseLead — duplicated because 'use server'
// modules may only export async functions, so the helper can't be shared.
function resolveSource(formData: FormData): string {
  const source = String(formData.get('source') ?? '').trim();
  const other = String(formData.get('sourceOther') ?? '').trim();
  return source === OTHER_SOURCE ? other : source;
}

/**
 * Turn an inbound message into an enquiry. Uses a claimed status transition
 * (claimable → converted) so two people acting on the same row can't create two
 * enquiries; the shared `createLeadRecord` keeps this identical to the manual form.
 */
export async function createLeadFromInboundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission('lead_inbox.manage');
    const inboundId = String(formData.get('inboundId') ?? '');
    if (!inboundId) return { error: MESSAGE_NOT_FOUND };

    const raw: Record<string, unknown> = Object.fromEntries(formData);
    if (!String(raw.customerName ?? '').trim()) return { error: NAME_REQUIRED, field: 'customerName' };
    raw.source = resolveSource(formData);
    const parsed = leadInput.safeParse(raw);
    if (!parsed.success) return fieldError(parsed.error.issues[0]);
    const followup = String(formData.get('nextFollowupAt') ?? '').trim();
    if (followup && Number.isNaN(Date.parse(followup))) {
      return { error: 'Follow-up date: pick a date from the calendar.', field: 'nextFollowupAt' };
    }
    const d = { ...parsed.data, nextFollowupAt: followup || null };

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [claim] = await tx.update(inboundMessage)
        .set({ status: 'converted', updatedAt: new Date() })
        .where(and(eq(inboundMessage.id, inboundId), inArray(inboundMessage.status, CLAIMABLE_STATUSES)))
        .returning({ id: inboundMessage.id });
      if (!claim) throw new UserError('This message was already turned into an enquiry. Refresh to see it.');
      const created = await createLeadRecord(tx, u.tenantId, {
        ...d, ownerUserId: u.userId, inboundMessageId: inboundId,
      });
      await tx.update(inboundMessage).set({ leadId: created.id, updatedAt: new Date() })
        .where(eq(inboundMessage.id, inboundId));
    });

    revalidatePath('/leads/inbox');
    revalidatePath('/leads');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Enquiry created ✓' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/** Dismiss a message that's waiting for review, without creating an enquiry. */
export async function ignoreInboundAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead_inbox.manage');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: MESSAGE_NOT_FOUND };
    const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(inboundMessage).set({ status: 'ignored', updatedAt: new Date() })
        .where(and(eq(inboundMessage.id, id), eq(inboundMessage.status, 'pending')))
        .returning({ id: inboundMessage.id }),
    );
    if (!row) return { error: 'This message was already handled. Refresh to see its status.' };
    revalidatePath('/leads/inbox');
    return { ok: true, message: 'Message dismissed' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
