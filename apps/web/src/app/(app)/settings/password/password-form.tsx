'use client';
import { useActionState, useEffect, useRef } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { changeOwnPasswordAction, type ActionState } from './actions';

export function PasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(changeOwnPasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <div>
        <label className="label">Current password</label>
        <input name="current" type="password" required className="field" autoComplete="current-password" />
      </div>
      <div>
        <label className="label">New password</label>
        <input name="password" type="password" required minLength={8} className="field" autoComplete="new-password" placeholder="min 8 characters" />
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input name="confirm" type="password" required minLength={8} className="field" autoComplete="new-password" />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Change password</SubmitButton>
        {state.error && <span className="text-sm text-crit">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok">Password changed ✓</span>}
      </div>
    </form>
  );
}
