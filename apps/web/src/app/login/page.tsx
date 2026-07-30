'use client';
import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';
import { SubmitButton } from '@/components/submit-button';

export default function LoginPage() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <span className="text-accent text-2xl leading-none" aria-hidden>⚙</span>
          <span className="font-semibold text-lg tracking-tight">MS Enterprises ERP</span>
        </div>
        <form action={action} className="card p-6 flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required
              className="field" defaultValue="owner@msenterprises.test" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required
              className="field" defaultValue="password123" />
          </div>
          {state.error && <p className="text-sm text-crit">{state.error}</p>}
          <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
          <p className="text-xs text-faint text-center">
            Demo: owner@msenterprises.test · password123
          </p>
        </form>
      </div>
    </div>
  );
}
