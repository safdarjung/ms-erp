'use server';
import { requirePermission } from '@/lib/rbac';
import { getBriefing, type BriefingView } from '@/lib/briefing';

/** Today's AI briefing for the home screen (cached per day; `refresh` writes a new one). */
export async function briefingAction(opts: { refresh?: boolean } = {}): Promise<BriefingView> {
  try {
    const u = await requirePermission('dashboard.view');
    return await getBriefing(u, { refresh: !!opts.refresh });
  } catch {
    return { ok: false, error: 'Your session has ended — please log in again.' };
  }
}
