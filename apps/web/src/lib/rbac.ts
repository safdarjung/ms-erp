import 'server-only';
import { redirect } from 'next/navigation';
import type { Permission } from '@ms/core';
import { getCurrentUser, type CurrentUser } from './auth';

/** Require an authenticated user, else redirect to login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export function can(user: CurrentUser, permission: Permission): boolean {
  return user.permissions.has(permission);
}

/** Require a specific permission. Throws FORBIDDEN (caught by server actions). */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.permissions.has(permission)) throw new Error('FORBIDDEN: missing ' + permission);
  return user;
}
