'use server';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { withTenant, leadChannel, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { toActionError, type ActionResult } from '@/lib/forms';
import type { ChannelConfig } from '@/lib/ingest/types';

export type ActionState = { error?: string; ok?: boolean };

const newToken = () => randomBytes(16).toString('hex'); // 32 hex chars, unguessable

export async function createChannelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead_channel.manage');
  const name = String(formData.get('name') ?? '').trim() || 'Email capture';
  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.insert(leadChannel).values({
        tenantId: u.tenantId,
        kind: 'email_webhook',
        name,
        config: { inboundToken: newToken(), autoCreate: true, senderAllowlist: [] } as ChannelConfig,
      }),
    );
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function updateChannelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('lead_channel.manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing channel' };
  const defaultOwnerUserId = String(formData.get('defaultOwnerUserId') ?? '').trim() || null;
  const autoCreate = formData.get('autoCreate') != null;
  const enabled = formData.get('enabled') != null;
  const senderAllowlist = String(formData.get('senderAllowlist') ?? '')
    .split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 50);
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [c] = await tx.select().from(leadChannel).where(eq(leadChannel.id, id)).limit(1);
      if (!c) throw new Error('Channel not found');
      const cfg: ChannelConfig = { ...(c.config as ChannelConfig), defaultOwnerUserId, autoCreate, senderAllowlist };
      await tx.update(leadChannel).set({ config: cfg, enabled, updatedAt: new Date() }).where(eq(leadChannel.id, id));
    });
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function regenerateTokenAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead_channel.manage');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'Missing channel' };
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [c] = await tx.select().from(leadChannel).where(eq(leadChannel.id, id)).limit(1);
      if (!c) throw new Error('Channel not found');
      const cfg: ChannelConfig = { ...(c.config as ChannelConfig), inboundToken: newToken() };
      await tx.update(leadChannel).set({ config: cfg, updatedAt: new Date() }).where(eq(leadChannel.id, id));
    });
    revalidatePath('/settings/channels');
    return { ok: true, message: 'New capture address generated — update your forwarding rule.' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}
