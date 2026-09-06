import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Permission } from '@ms/core';
import { getCurrentUser, type CurrentUser } from './auth';

/** Only same-origin app paths may be used as a post-login destination. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  if (next.startsWith('/login') || next.startsWith('/api/')) return null;
  return next;
}

/**
 * Best-effort current path so a signed-out person comes back to the same page.
 * Next.js does not expose the pathname to server components; middleware can set
 * an `x-pathname` header to enable this. Returns null when unavailable.
 */
async function currentPath(): Promise<string | null> {
  try {
    const h = await headers();
    return safeNextPath(h.get('x-pathname') ?? h.get('next-url'));
  } catch {
    return null;
  }
}

/** Require an authenticated user, else redirect to login (returning here afterwards). */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = await currentPath();
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }
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
