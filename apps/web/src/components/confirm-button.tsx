'use client';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionResult } from '@/lib/forms';
import { useToast } from './toast';

type ConfirmAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/**
 * Trigger button that opens a confirmation modal before submitting a server
 * action, then toasts the result. Use for destructive / irreversible operations
 * (delete, convert, cancel, disable) that previously fired on a single click.
 */
export function ConfirmButton({
  action,
  fields = {},
  children,
  className = 'btn-ghost text-xs !text-crit !border-crit/40 hover:!bg-[#f6e5e1]',
  title = 'Are you sure?',
  body,
  confirmLabel = 'Confirm',
  variant = 'danger',
  toastOk,
}: {
  action: ConfirmAction;
  fields?: Record<string, string | undefined>;
  children: ReactNode;
  className?: string;
  title?: string;
  body?: ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  toastOk?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const toast = useToast();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.error) toast({ title: 'Could not complete', description: state.error, variant: 'error' });
    else if (state.ok) {
      if (toastOk || state.message) toast({ title: toastOk ?? state.message!, variant: 'success' });
      setOpen(false);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !pending && setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label={title}
            className="relative card w-full max-w-sm p-5 shadow-2xl toast-in">
            <div className="font-semibold text-ink mb-1">{title}</div>
            {body && <div className="text-sm text-muted mb-4">{body}</div>}
            <form action={formAction} className="flex justify-end gap-2 mt-2">
              {Object.entries(fields).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
              <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={pending}
                className={`btn text-sm text-white disabled:opacity-60 ${variant === 'danger' ? 'bg-crit hover:opacity-90' : 'bg-accent hover:opacity-90'}`}
              >
                {pending ? 'Working…' : confirmLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
