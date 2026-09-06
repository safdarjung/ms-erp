'use client';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionResult } from '@/lib/forms';
import { useToast } from './toast';

type ConfirmAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trigger button that opens a confirmation dialog before submitting a server
 * action, then toasts the result. Use for destructive / irreversible operations
 * (delete, convert, cancel, disable) that previously fired on a single click.
 *
 * Accessibility: focus moves into the dialog (danger dialogs land on "Not now"
 * first), Tab is trapped inside, Escape closes, and focus returns to the trigger.
 */
export function ConfirmButton({
  action,
  fields = {},
  children,
  className = 'btn-ghost text-xs !text-crit !border-crit/40 hover:!bg-[#f6e5e1]',
  title = 'Are you sure?',
  body,
  confirmLabel = 'Yes, do it',
  cancelLabel = 'Not now',
  pendingLabel = 'Working…',
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
  cancelLabel?: string;
  pendingLabel?: string;
  variant?: 'danger' | 'primary';
  toastOk?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const toast = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Danger dialogs (or any "Yes, delete / Yes, cancel" confirm) start on the safe button.
  const dangerous = variant === 'danger' || /^yes, (delete|cancel|remove)/i.test(confirmLabel);

  useEffect(() => {
    if (state.error) toast({ title: 'Could not complete', description: state.error, variant: 'error' });
    else if (state.ok) {
      if (toastOk || state.message) toast({ title: toastOk ?? state.message!, variant: 'success' });
      setOpen(false);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    (dangerous ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) { setOpen(false); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, dangerous]);

  // Give focus back to whatever opened the dialog once it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button ref={triggerRef} type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !pending && setOpen(false)} aria-hidden />
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={body ? 'confirm-body' : undefined}
            className="relative card w-full max-w-sm p-5 shadow-2xl toast-in">
            <div id="confirm-title" className="font-semibold text-ink mb-1">{title}</div>
            {body && <div id="confirm-body" className="text-sm text-muted mb-4">{body}</div>}
            <form action={formAction} className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
              {Object.entries(fields).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
              <button ref={cancelRef} type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => setOpen(false)}>{cancelLabel}</button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className={`btn text-sm text-white disabled:opacity-60 ${variant === 'danger' ? 'bg-crit hover:opacity-90' : 'bg-accent hover:opacity-90'}`}
              >
                {pending ? pendingLabel : confirmLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
