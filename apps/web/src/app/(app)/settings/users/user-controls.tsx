'use client';
import { useActionState, useEffect, useRef } from 'react';
import { ROLES } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import {
  createUserAction, resetPasswordAction, setUserRoleAction, setUserStatusAction, updateUserProfileAction, type ActionState,
} from './actions';

export function EditProfile({ id, name, email }: { id: string; name: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(updateUserProfileAction, {});
  return (
    <details className="reveal">
      <summary className="text-xs text-steel hover:underline cursor-pointer">Edit name / email</summary>
      <form action={action} className="flex flex-wrap items-center gap-2 mt-1.5">
        <input type="hidden" name="id" value={id} />
        <input name="name" defaultValue={name} required className="field !py-1 text-xs w-36" placeholder="Name" />
        <input name="email" type="email" defaultValue={email} required className="field !py-1 text-xs w-52" placeholder="name@company.com" />
        <SubmitButton className="btn-ghost !py-1 text-xs">Save</SubmitButton>
        {state.error && <span className="text-xs text-crit">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok">Saved ✓</span>}
      </form>
    </details>
  );
}

export function CreateUserForm() {
  const [state, action] = useActionState<ActionState, FormData>(createUserAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);

  return (
    <form ref={formRef} action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div><label className="label">Name *</label><input name="name" required className="field" placeholder="Full name" /></div>
      <div><label className="label">Email *</label><input name="email" type="email" required className="field" placeholder="name@company.com" /></div>
      <div><label className="label">Password *</label><input name="password" type="password" required minLength={8} className="field" placeholder="min 8 characters" /></div>
      <div>
        <label className="label">Role *</label>
        <select name="role" defaultValue="sales" className="field">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
        <SubmitButton className="btn-primary">Create user</SubmitButton>
        {state.error && <span className="text-sm text-crit">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok">User created.</span>}
      </div>
    </form>
  );
}

export function RoleSelect({ id, current, disabled }: { id: string; current: string; disabled: boolean }) {
  if (disabled) return <span className="pill bg-surface-2 text-muted capitalize">{current || '—'}</span>;
  return (
    <form action={setUserRoleAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field w-auto !py-1 !px-2 text-xs"
        aria-label="User role"
      >
        {!current && <option value="">—</option>}
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </form>
  );
}

export function StatusToggle({ id, status, disabled }: { id: string; status: string; disabled: boolean }) {
  const active = status === 'active';
  return (
    <div className="flex items-center gap-2">
      <span className={`pill ${active ? 'bg-[#e4f1ea] text-ok' : 'bg-[#f6e5e1] text-crit'}`}>{active ? 'Active' : 'Disabled'}</span>
      {!disabled && (
        <form action={setUserStatusAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={active ? 'disabled' : 'active'} />
          <button className="text-xs text-steel hover:underline">{active ? 'Disable' : 'Enable'}</button>
        </form>
      )}
    </div>
  );
}

export function ResetPassword({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(resetPasswordAction, {});
  return (
    <details className="reveal">
      <summary className="text-xs text-steel hover:underline cursor-pointer">Reset password</summary>
      <form action={action} className="flex items-center gap-2 mt-1.5">
        <input type="hidden" name="id" value={id} />
        <input name="password" type="password" required minLength={8} className="field !py-1 text-xs w-40" placeholder="New password" />
        <SubmitButton className="btn-ghost !py-1 text-xs">Set</SubmitButton>
        {state.error && <span className="text-xs text-crit">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok">Changed ✓</span>}
      </form>
    </details>
  );
}
