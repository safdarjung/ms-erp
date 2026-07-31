'use client';
import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';
import { SubmitButton } from '@/components/submit-button';

const FEATURES = [
  ['Leads → Quotes → GST invoices', 'One spine, numbers always correct'],
  ['AI assistant', 'Ask your data in English or हिन्दी'],
  ['Smart quotation drafting', 'AI proposes items & rates — you approve'],
  ['Tenant-isolated by the database', 'Postgres row-level security'],
] as const;

export default function LoginPage() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});

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
    </div>
  );
}
