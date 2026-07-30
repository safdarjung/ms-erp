import 'server-only';
import bcrypt from 'bcryptjs';
import { cache } from 'react';
import {
  adminDb, withTenant, users, session, userRole, rolePermission, eq,
} from '@ms/db';
import {
  hashToken, newToken, setSessionCookie, clearSessionCookie, getSessionToken, SESSION_TTL_DAYS,
} from './session';

export type CurrentUser = {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  permissions: Set<string>;
};

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = email.toLowerCase().trim();
  const [u] = await adminDb.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!u || u.status !== 'active') return { ok: false, error: 'Invalid email or password' };

  const valid = await bcrypt.compare(password, u.passwordHash);
  if (!valid) return { ok: false, error: 'Invalid email or password' };

  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await adminDb.insert(session).values({
    tenantId: u.tenantId, userId: u.id, tokenHash: hashToken(token), expiresAt,
  });
  await adminDb.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await setSessionCookie(token);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const token = await getSessionToken();
  if (token) await adminDb.delete(session).where(eq(session.tokenHash, hashToken(token)));
  await clearSessionCookie();
}

// Resolve the current user for this request. Auth resolution uses the privileged
// connection (a small, deliberate surface); all business data goes via withTenant.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const rows = await adminDb
    .select({
      userId: users.id, tenantId: users.tenantId, name: users.name,
      email: users.email, expiresAt: session.expiresAt,
    })
    .from(session)
    .innerJoin(users, eq(session.userId, users.id))
    .where(eq(session.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) return null;

  const permissions = await getPermissions(row.tenantId, row.userId);
  return { userId: row.userId, tenantId: row.tenantId, name: row.name, email: row.email, permissions };
});

async function getPermissions(tenantId: string, userId: string): Promise<Set<string>> {
  return withTenant(tenantId, userId, async (tx) => {
    const rows = await tx
      .select({ key: rolePermission.permissionKey })
      .from(userRole)
      .innerJoin(rolePermission, eq(userRole.roleId, rolePermission.roleId))
      .where(eq(userRole.userId, userId));
    return new Set(rows.map((r) => r.key));
  });
}
