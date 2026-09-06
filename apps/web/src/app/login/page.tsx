'use client';
import { Suspense, useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction, type LoginState } from './actions';
import { SubmitButton } from '@/components/submit-button';

const FEATURES = [
  ['Enquiries → Quotations → Orders → Bills', 'Every number and GST figure worked out for you'],
  ['Payments & money to collect', 'See who owes what, and what is overdue'],
  ['Ask AI', 'Ask about your business in English or हिन्दी — and let it do the work'],
  ['Works on your phone', 'Install it like an app and use it on the shop floor'],
] as const;

// Prefill demo creds only in local development — never ship a real login on the page.
const isDev = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginScreen next="" />}>
      <LoginWithNext />
    </Suspense>
  );
}

function LoginWithNext() {
  const params = useSearchParams();
  const raw = params.get('next') ?? '';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';
  return <LoginScreen next={next} />;
}

function LoginScreen({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);
  const errorId = 'login-error';

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-ink text-white">
        <div className="flex items-center gap-2.5">
          <span className="text-accent text-2xl leading-none" aria-hidden>⚙</span>
          <span className="font-semibold text-lg tracking-tight">MS Enterprises</span>
        </div>
        <div>
          <p className="text-xs text-accent font-medium mb-3">Dies, tooling & machining — Faridabad</p>
          <p className="text-3xl font-semibold tracking-tight leading-snug mb-8 max-w-md">
            Enquiries, quotations, orders, bills and payments — in one place, on your phone.
          </p>
          <dl className="space-y-4 max-w-sm">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="border-l-2 border-accent/60 pl-4">
                <dt className="text-sm font-medium">{t}</dt>
                <dd className="text-xs text-white/70">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-white/60">Works on your phone — install it like an app.</p>
      </div>

      <div className="grid place-items-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-6 justify-center lg:hidden">
            <span className="text-accent text-2xl leading-none" aria-hidden>⚙</span>
            <span className="font-semibold text-lg tracking-tight">MS Enterprises</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight mb-1">Sign in</h1>
          {next ? (
            <p className="text-sm text-muted mb-4">Please sign in again to continue.</p>
          ) : (
            <p className="text-sm text-muted mb-4">Use the email and password the owner gave you.</p>
          )}
          <form action={action} className="card p-6 flex flex-col gap-4" aria-describedby={state.error ? errorId : undefined}>
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" inputMode="email" required
                className="field" defaultValue={isDev ? 'owner@msenterprises.test' : ''} placeholder="you@company.com"
                aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required
                  className="field pr-20" defaultValue={isDev ? 'password123' : ''}
                  aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} />
                <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink min-h-[44px] px-3"
                  aria-pressed={show}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {state.error && <p id={errorId} role="alert" className="text-sm text-crit">{state.error}</p>}
            <SubmitButton className="btn-primary w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
            <p className="text-xs text-muted text-center">
              Forgot your password? Ask the owner — they can set a new one under Settings → Staff.
            </p>
            {isDev && (
              <p className="text-xs text-muted text-center">
                Demo: owner@msenterprises.test · password123
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
