'use server';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ROLES } from '@ms/core';
import { withTenant, users, role, userRole, session, and, eq } from '@ms/db';
import { requirePermission } from '@/lib/rbac';

export type ActionState = { error?: string; ok?: boolean };

const createUserInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  role: z.enum(ROLES),
});

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('user.manage');
  const parsed = createUserInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const passwordHash = await bcrypt.hash(d.password, 10);
  try {
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [r] = await tx.select({ id: role.id }).from(role).where(eq(role.name, d.role)).limit(1);
      if (!r) throw new Error(`Role "${d.role}" is not set up`);
      const [nu] = await tx.insert(users).values({
        tenantId: u.tenantId, name: d.name, email: d.email, passwordHash,
      }).returning({ id: users.id });
      await tx.insert(userRole).values({ tenantId: u.tenantId, userId: nu!.id, roleId: r.id });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/users_email_uq|duplicate key/i.test(msg)) return { error: 'A user with this email already exists.' };
    return { error: msg || 'Could not create the user' };
  }
  revalidatePath('/settings/users');
  return { ok: true };
}

const profileInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
});

/** Edit a user's real name & email (e.g. to set the owner's real login on handover). */
export async function updateUserProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('user.manage');
  const parsed = profileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  try {
    await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(users).set({ name: d.name, email: d.email, updatedAt: new Date() }).where(eq(users.id, d.id)),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/users_email_uq|duplicate key/i.test(msg)) return { error: 'That email is already used by another user.' };
    return { error: msg || 'Could not update the user' };
  }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setUserStatusAction(formData: FormData): Promise<void> {
  const u = await requirePermission('user.manage');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['active', 'disabled'].includes(status)) return;
  if (id === u.userId) return; // never lock yourself out

  await withTenant(u.tenantId, u.userId, async (tx) => {
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, id));
    if (status === 'disabled') await tx.delete(session).where(eq(session.userId, id));
  });
  revalidatePath('/settings/users');
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const u = await requirePermission('user.manage');
  const id = String(formData.get('id') ?? '');
  const roleName = String(formData.get('role') ?? '');
  if (!id || !(ROLES as readonly string[]).includes(roleName)) return;
  if (id === u.userId) return; // don't demote yourself by accident

  await withTenant(u.tenantId, u.userId, async (tx) => {
    const [r] = await tx.select({ id: role.id }).from(role).where(eq(role.name, roleName)).limit(1);
    if (!r) return;
    await tx.delete(userRole).where(eq(userRole.userId, id));
    await tx.insert(userRole).values({ tenantId: u.tenantId, userId: id, roleId: r.id });
  });
  revalidatePath('/settings/users');
}

const resetInput = z.object({
  id: z.string().uuid(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const u = await requirePermission('user.manage');
  const parsed = resetInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await withTenant(u.tenantId, u.userId, async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, parsed.data.id));
    // Force fresh logins everywhere except the admin doing the reset.
    if (parsed.data.id !== u.userId) {
      await tx.delete(session).where(and(eq(session.userId, parsed.data.id)));
    }
  });
  revalidatePath('/settings/users');
  return { ok: true };
}
