'use server';
import { redirect } from 'next/navigation';
import { login, logout } from '@/lib/auth';

export type LoginState = { error?: string };

const WRONG_CREDENTIALS = 'Email or password is wrong — try again. (Email ya password galat hai.)';

/** Only same-origin app paths may be used as a post-login destination. */
function safeNext(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/dashboard';
  if (raw.startsWith('/login') || raw.startsWith('/api/')) return '/dashboard';
  return raw;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password to sign in.' };

  const res = await login(email, password);
  if (!res.ok) {
    // The auth layer's "invalid" message is deliberately vague; give people the
    // plain-words version and keep the throttle message as is.
    return { error: /invalid/i.test(res.error) ? WRONG_CREDENTIALS : res.error };
  }

  redirect(safeNext(String(formData.get('next') ?? '')));
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect('/login');
}
