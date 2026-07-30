'use server';
import { redirect } from 'next/navigation';
import { login, logout } from '@/lib/auth';

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password' };

  const res = await login(email, password);
  if (!res.ok) return { error: res.error };

  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect('/login');
}
