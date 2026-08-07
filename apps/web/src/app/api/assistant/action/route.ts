import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { cancelAction, executeAction } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  actionId: z.string().uuid(),
  decision: z.enum(['confirm', 'cancel']),
  /** Present when the user edited the proposal on the card before confirming. */
  edited: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Decide a pending AI-proposed action. Confirm executes it server-side with
 * the same validation/RBAC/RLS as the manual forms; cancel just closes it.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (body.decision === 'cancel') {
    await cancelAction(user, body.actionId);
    return Response.json({ ok: true, cancelled: true });
  }

  const result = await executeAction(user, body.actionId, body.edited);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
