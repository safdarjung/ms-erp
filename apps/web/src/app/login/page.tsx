'use client';
import { useActionState, useState } from 'react';
import { loginAction, type LoginState } from './actions';
import { SubmitButton } from '@/components/submit-button';

const FEATURES = [
  ['Leads → Quotes → Orders → GST invoices', 'One spine, numbers always correct'],
  ['Payments & receivables', 'Track outstanding, overdue and aging'],
  ['AI assistant', 'Ask your data in English or हिन्दी'],
  ['Tenant-isolated by the database', 'Postgres row-level security'],
] as const;

// Prefill demo creds only in local development — never ship a real login on the page.
const isDev = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-ink text-white">
        <div className="flex items-center gap-2.5">
          <span className="text-accent text-2xl leading-none" aria-hidden>⚙</span>
          <span className="font-semibold text-lg tracking-tight">MS Enterprises</span>
        </div>
        <div>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-accent mb-3">Die & machining job-shop ERP</p>
          <h1 className="text-3xl font-semibold tracking-tight leading-snug mb-8 max-w-md">
            The shop floor, the front office, and your GST paperwork — in one place.
          </h1>
          <dl className="space-y-4 max-w-sm">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="border-l-2 border-accent/60 pl-4">
                <dt className="text-sm font-medium">{t}</dt>
                <dd className="text-xs text-white/60">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="font-mono text-[0.65rem] text-white/40">Faridabad · Haryana · Phase 1</p>
      </div>

      <div className="grid place-items-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-6 justify-center lg:hidden">
            <span className="text-accent text-2xl leading-none" aria-hidden>⚙</span>
            <span className="font-semibold text-lg tracking-tight">MS Enterprises ERP</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight mb-4 hidden lg:block">Sign in</h2>
          <form action={action} className="card p-6 flex flex-col gap-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" required
                className="field" defaultValue={isDev ? 'owner@msenterprises.test' : ''} placeholder="you@company.com" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required
                  className="field pr-16" defaultValue={isDev ? 'password123' : ''} />
                <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink px-1"
                  aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {state.error && <p className="text-sm text-crit">{state.error}</p>}
            <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
            {isDev && (
              <p className="text-xs text-faint text-center">
                Demo: owner@msenterprises.test · password123
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
