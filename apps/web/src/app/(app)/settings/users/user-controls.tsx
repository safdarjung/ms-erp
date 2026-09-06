'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { ROLES, type RoleName } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import {
  createUserAction, resetPasswordAction, setUserRoleAction, setUserStatusAction, updateUserProfileAction, type ActionState,
} from './actions';

// Plain names and a one-line meaning for each role (mirrors ROLE_PERMISSIONS in @ms/core).
export const ROLE_LABELS: Record<RoleName, string> = {
  owner: 'Owner', sales: 'Sales', accounts: 'Accounts', viewer: 'Viewer',
  production: 'Production', store: 'Store', operator: 'Operator', hr: 'HR',
};
export const ROLE_HINTS: Record<RoleName, string> = {
  owner: 'everything',
  sales: 'enquiries, quotations, orders',
  accounts: 'bills & payments',
  viewer: "can look, can't change",
  production: 'sees customers & orders',
  store: 'sees customers & orders',
  operator: 'can sign in, sees nothing yet',
  hr: 'sees Home only',
};
const MAIN_ROLES: RoleName[] = ['owner', 'sales', 'accounts', 'viewer'];
const MORE_ROLES: RoleName[] = ROLES.filter((r) => !MAIN_ROLES.includes(r));
const MIN_PASSWORD = 8;

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as RoleName] ?? role;
}
export function roleHint(role: string): string {
  return ROLE_HINTS[role as RoleName] ?? '';
}

function RoleOptions() {
  return (
    <>
      {MAIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      <optgroup label="More roles">
        {MORE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </optgroup>
    </>
  );
}

export function EditProfile({ id, name, email }: { id: string; name: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(updateUserProfileAction, {});
  const nameId = useId();
  const emailId = useId();
  return (
    <details className="reveal">
      <summary className="text-xs text-steel hover:underline cursor-pointer min-h-[44px] sm:min-h-0 inline-flex items-center">Change name or email</summary>
      <form action={action} className="flex flex-wrap items-end gap-2 mt-1.5">
        <input type="hidden" name="id" value={id} />
        <div>
          <label className="label" htmlFor={nameId}>Name</label>
          <input id={nameId} name="name" defaultValue={name} required autoComplete="name" className="field !py-1 text-xs w-36" />
        </div>
        <div>
          <label className="label" htmlFor={emailId}>Email</label>
          <input id={emailId} name="email" type="email" defaultValue={email} required autoComplete="email" className="field !py-1 text-xs w-52" />
        </div>
        <SubmitButton className="btn-ghost !py-1 text-xs">Save</SubmitButton>
        {state.error && <span className="text-xs text-crit" role="alert">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok" role="status">Saved ✓</span>}
      </form>
    </details>
  );
}

export function CreateUserForm() {
  const [state, action] = useActionState<ActionState, FormData>(createUserAction, {});
  const [role, setRole] = useState<RoleName>('sales');
  const formRef = useRef<HTMLFormElement>(null);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const passwordHintId = useId();
  const roleId = useId();
  const roleHintId = useId();
  useEffect(() => { if (state.ok) { formRef.current?.reset(); setRole('sales'); } }, [state]);

  return (
    <form ref={formRef} action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div>
        <label className="label" htmlFor={nameId}>Name</label>
        <input id={nameId} name="name" required autoComplete="name" className="field" placeholder="Full name" />
      </div>
      <div>
        <label className="label" htmlFor={emailId}>Email (they sign in with this)</label>
        <input id={emailId} name="email" type="email" required autoComplete="off" inputMode="email" className="field" placeholder="name@company.com" />
      </div>
      <div>
        <label className="label" htmlFor={passwordId}>First password</label>
        <input id={passwordId} name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field" aria-describedby={passwordHintId} />
        <p id={passwordHintId} className="text-xs text-muted mt-1">At least {MIN_PASSWORD} characters. They can change it later.</p>
      </div>
      <div>
        <label className="label" htmlFor={roleId}>Role</label>
        <select id={roleId} name="role" value={role} onChange={(e) => setRole(e.target.value as RoleName)} className="field max-w-full" aria-describedby={roleHintId}>
          <RoleOptions />
        </select>
        <p id={roleHintId} className="text-xs text-muted mt-1">{ROLE_LABELS[role]} — {ROLE_HINTS[role]}</p>
      </div>
      <div className="sm:col-span-2 lg:col-span-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <SubmitButton className="btn-primary" pendingLabel="Adding…">Add staff member</SubmitButton>
        {state.error && <span className="text-sm text-crit" role="alert">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok" role="status">Added ✓ — they can sign in now.</span>}
      </div>
    </form>
  );
}

export function RoleSelect({ id, current, disabled }: { id: string; current: string; disabled: boolean }) {
  const [role, setRole] = useState(current);
  if (disabled) {
    return (
      <div>
        <span className="pill bg-surface-2 text-muted">{current ? roleLabel(current) : '—'}</span>
        {current && <p className="text-xs text-muted mt-1">{roleHint(current)}</p>}
      </div>
    );
  }
  return (
    <form action={setUserRoleAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        value={role}
        onChange={(e) => { setRole(e.target.value); e.currentTarget.form?.requestSubmit(); }}
        className="field w-auto !py-1 !px-2 text-xs"
        aria-label="Role"
      >
        {!role && <option value="">—</option>}
        <RoleOptions />
      </select>
    </form>
  );
}

export function StatusToggle({ id, status, disabled }: { id: string; status: string; disabled: boolean }) {
  const active = status === 'active';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`pill ${active ? 'bg-[#e4f1ea] text-ok' : 'bg-[#f6e5e1] text-crit'}`}>{active ? 'Active' : 'Blocked'}</span>
      {!disabled && (
        <form action={setUserStatusAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={active ? 'disabled' : 'active'} />
          <button className="btn-ghost !py-1 text-xs">{active ? 'Block sign-in' : 'Allow sign-in'}</button>
        </form>
      )}
    </div>
  );
}

export function ResetPassword({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(resetPasswordAction, {});
  const passwordId = useId();
  const hintId = useId();
  return (
    <details className="reveal">
      <summary className="text-xs text-steel hover:underline cursor-pointer min-h-[44px] sm:min-h-0 inline-flex items-center">Set a new password</summary>
      <form action={action} className="flex flex-wrap items-end gap-2 mt-1.5">
        <input type="hidden" name="id" value={id} />
        <div>
          <label className="label" htmlFor={passwordId}>New password</label>
          <input id={passwordId} name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field !py-1 text-xs w-40" aria-describedby={hintId} />
          <p id={hintId} className="text-xs text-muted mt-1">At least {MIN_PASSWORD} characters. Their other devices get signed out.</p>
        </div>
        <SubmitButton className="btn-ghost !py-1 text-xs">Save new password</SubmitButton>
        {state.error && <span className="text-xs text-crit" role="alert">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok" role="status">Password changed ✓</span>}
      </form>
    </details>
  );
}
