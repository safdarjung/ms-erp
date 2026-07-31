'use server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTenant, users, session, and, ne, eq } from '@ms/db';
import { requireUser } from '@/lib/rbac';
import { getSessionToken, hashToken } from '@/lib/session';

export type ActionState = { error?: string; ok?: boolean };

const input = z.object({
  current: z.string().min(1, 'Enter your current password'),
  password: z.string().min(8, 'New password must be at least 8 characters').max(200),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export async function changeOwnPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requireUser();
  const parsed = input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const token = await getSessionToken();
  const currentHash = token ? hashToken(token) : '';

  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [row] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, u.userId)).limit(1);
      if (!row || !(await bcrypt.compare(parsed.data.current, row.hash))) {
        throw new Error('Current password is incorrect');
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, u.userId));
      // Log out every other device; keep this session alive.
      await tx.delete(session).where(and(eq(session.userId, u.userId), ne(session.tokenHash, currentHash)));
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not change the password' };
  }
  return { ok: true };
}
