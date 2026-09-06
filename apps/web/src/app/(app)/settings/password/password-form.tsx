'use client';
import { useActionState, useEffect, useId, useRef } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { changeOwnPasswordAction, type ActionState } from './actions';

const MIN_LENGTH = 8;

export function PasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(changeOwnPasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const hintId = useId();
  const errorId = useId();
  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3" aria-describedby={state.error ? errorId : undefined}>
      <div>
        <label className="label" htmlFor={currentId}>Current password</label>
        <input id={currentId} name="current" type="password" required className="field" autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor={newId}>New password</label>
        <input id={newId} name="password" type="password" required minLength={MIN_LENGTH} className="field" autoComplete="new-password" aria-describedby={hintId} />
        <p id={hintId} className="text-xs text-muted mt-1">At least {MIN_LENGTH} characters.</p>
      </div>
      <div>
        <label className="label" htmlFor={confirmId}>Type the new password again</label>
        <input id={confirmId} name="confirm" type="password" required minLength={MIN_LENGTH} className="field" autoComplete="new-password" />
      </div>
      {state.error && <p id={errorId} role="alert" className="text-sm text-crit">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">Password changed ✓</p>}
      <div>
        <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save new password</SubmitButton>
      </div>
    </form>
  );
}
