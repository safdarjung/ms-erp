'use client';
import { useActionState, useEffect, useRef, useTransition } from 'react';
import { updateCustomerAction, setCustomerStatusAction, setCustomerStatusFormAction, type ActionState } from './actions';
import { CustomerFields, FormErrorSummary, hasMoreDetails, type CustomerValues } from './customer-form';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';

/** Id of the edit `<details>` on the customer page; `?edit=1` opens it. */
export const EDIT_SECTION_ID = 'edit-customer';

/**
 * Hide (archive) asks first — it changes what everyone sees in lists. Unhide
 * is a one-tap undo of that, so it needs no dialog.
 */
export function CustomerStatusButton({ id, status, name }: { id: string; status: string; name?: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const who = name ?? 'this customer';

  if (status === 'archived') {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const res = await setCustomerStatusAction(id, 'active');
          toast(res.error
            ? { title: "Couldn't unhide", description: res.error, variant: 'error' }
            : { title: res.message ?? 'Back in lists', variant: 'success' });
        })}
        className="btn-ghost text-xs disabled:opacity-60"
      >
        {pending ? 'Working…' : 'Unhide'}
      </button>
    );
  }
  return (
    <ConfirmButton
      action={setCustomerStatusFormAction}
      fields={{ id, status: 'archived' }}
      className="btn-ghost text-xs"
      variant="primary"
      title={`Hide ${who} from lists?`}
      body="Hidden customers disappear from lists and pickers. Their bills stay untouched."
      confirmLabel="Yes, hide"
    >
      Hide (archive)
    </ConfirmButton>
  );
}

/** Header "Edit" button: opens the edit section further down and moves focus into it. */
export function EditCustomerButton() {
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      onClick={() => {
        const section = document.getElementById(EDIT_SECTION_ID) as HTMLDetailsElement | null;
        if (!section) return;
        section.open = true;
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus({ preventScroll: true });
      }}
    >
      Edit
    </button>
  );
}

/** Fires one success toast after a redirect (e.g. `?added=1`), then tidies the URL. */
export function CustomerFlash({ message, param }: { message: string; param: string }) {
  const toast = useToast();
  useEffect(() => {
    toast({ title: message, variant: 'success' });
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(param);
      window.history.replaceState(null, '', url.toString());
    } catch { /* URL tidy-up is cosmetic */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function CustomerEditForm({ customer }: {
  customer: CustomerValues & { id: string; regType?: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateCustomerAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: state.message ?? 'Customer saved', variant: 'success' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="id" value={customer.id} />
      <FormErrorSummary state={state} />
      <CustomerFields initial={customer} state={state} formRef={ref} moreOpenDefault={hasMoreDetails(customer)} />
      <div className="flex sm:justify-end">
        <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
