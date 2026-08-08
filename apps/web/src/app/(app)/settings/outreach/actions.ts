'use server';
import { revalidatePath } from 'next/cache';
import { withTenant, tenant, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { toActionError } from '@/lib/forms';
import { DEFAULT_WHATSAPP_NUMBER, DEFAULT_INTRO } from '@/lib/outreach';

export type ActionState = { error?: string; ok?: boolean };

export async function updateOutreachAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('settings.manage');
  const whatsappNumber = String(formData.get('whatsappNumber') ?? '').trim();
  const template = String(formData.get('template') ?? '').trim();
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
      const s = (t?.settings ?? {}) as Record<string, unknown>;
      const next = {
        ...s,
        outreach: {
          whatsappNumber: whatsappNumber || DEFAULT_WHATSAPP_NUMBER,
          template: template || DEFAULT_INTRO,
        },
      };
      await tx.update(tenant).set({ settings: next }).where(eq(tenant.id, u.tenantId));
    });
  } catch (e) {
    return { error: toActionError(e) };
  }
  revalidatePath('/settings/outreach');
  revalidatePath('/leads');
  return { ok: true };
}
