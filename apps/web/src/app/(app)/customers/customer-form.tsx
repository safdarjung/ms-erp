'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GST_STATE_NAMES } from '@ms/core';
import { createCustomerAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';

export const DEFAULT_STATE_CODE = '06';

/** Fields tucked under "More details" — opening it when one of them errors. */
const MORE_FIELDS = ['gstin', 'stateCode', 'email', 'address', 'creditTermsDays'];
/** Fields that render a `<p id="…-help">` helper line (for aria-describedby). */
const HELPED_FIELDS = new Set(['phone', 'gstin', 'stateCode', 'creditTermsDays']);

export type CustomerValues = {
  name: string; gstin: string; stateCode: string; contactPerson: string;
  phone: string; email: string; address: string; creditTermsDays: number;
};

/** Does any "More details" field hold a value? (Edit form opens the section then.) */
export function hasMoreDetails(v: Partial<CustomerValues>): boolean {
  return Boolean(v.gstin || v.email || v.address || (v.creditTermsDays ?? 0) > 0);
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="text-xs text-crit mt-1">{message}</p>;
}

/** After a failed save, move focus to the input the error belongs to. */
export function useFocusInvalid(
  formRef: RefObject<HTMLFormElement | null>, state: { field?: string }, beforeFocus?: (field: string) => void,
) {
  useEffect(() => {
    const field = state.field;
    if (!field) return;
    beforeFocus?.(field);
    const t = setTimeout(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The customer inputs shared by the create and edit forms. Name, phone and
 * contact person are always visible; GST, address and payment terms sit under
 * "More details". Registration and state follow the GSTIN automatically.
 */
export function CustomerFields({ initial = {}, state, formRef, moreOpenDefault = false, extras = {} }: {
  initial?: Partial<CustomerValues>;
  state: ActionState;
  formRef: RefObject<HTMLFormElement | null>;
  moreOpenDefault?: boolean;
  /** Extra content rendered under a field's error (keyed by input name). */
  extras?: Partial<Record<string, ReactNode>>;
}) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [gstin, setGstin] = useState(initial.gstin ?? '');
  const [stateCode, setStateCode] = useState(initial.stateCode || DEFAULT_STATE_CODE);
  const [moreOpen, setMoreOpen] = useState(moreOpenDefault);
  const regType = gstin ? 'registered' : 'unregistered';

  useFocusInvalid(formRef, state, (field) => { if (MORE_FIELDS.includes(field)) setMoreOpen(true); });

  // GSTIN starts with the 2-digit state code — pick the state automatically.
  const onGstin = (v: string) => {
    const up = v.toUpperCase().trim();
    setGstin(up);
    if (/^\d{2}/.test(up) && GST_STATE_NAMES[up.slice(0, 2)]) setStateCode(up.slice(0, 2));
  };

  const err = (name: string) => (state.field === name ? state.error : undefined);
  const a11y = (name: string) => ({
    id: fid(name),
    'aria-invalid': state.field === name || undefined,
    'aria-describedby': [
      state.field === name ? `${fid(name)}-err` : null,
      HELPED_FIELDS.has(name) ? `${fid(name)}-help` : null,
    ].filter(Boolean).join(' ') || undefined,
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={fid('name')} className="label">Name *</label>
          <input name="name" required defaultValue={initial.name} className="field" placeholder="Company or person" autoComplete="organization" {...a11y('name')} />
          <FieldError id={`${fid('name')}-err`} message={err('name')} />
          {extras.name}
        </div>
        <div>
          <label htmlFor={fid('phone')} className="label">Phone</label>
          <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" defaultValue={initial.phone} className="field" placeholder="98xxxxxxxx" maxLength={20} {...a11y('phone')} />
          <FieldError id={`${fid('phone')}-err`} message={err('phone')} />
          {extras.phone}
          <p id={`${fid('phone')}-help`} className="text-xs text-muted mt-1">10-digit mobile turns on the WhatsApp button.</p>
        </div>
        <div>
          <label htmlFor={fid('contactPerson')} className="label">Contact person</label>
          <input name="contactPerson" autoComplete="name" defaultValue={initial.contactPerson} className="field" placeholder="Who to call" {...a11y('contactPerson')} />
          <FieldError id={`${fid('contactPerson')}-err`} message={err('contactPerson')} />
          {extras.contactPerson}
        </div>
      </div>

      <details className="reveal mt-3" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary className="text-sm font-medium text-ink flex items-center gap-2 py-2 min-h-11 sm:min-h-0">
          <span className="chev" aria-hidden>›</span> More details (GST, address, payment terms)
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div>
            <label htmlFor={fid('gstin')} className="label">GSTIN</label>
            <div className="flex items-center gap-2">
              <input name="gstin" value={gstin} onChange={(e) => onGstin(e.target.value)} className="field font-mono uppercase" placeholder="06ABCDE1234F1Z5 (optional)" maxLength={15} autoComplete="off" {...a11y('gstin')} />
            </div>
            <input type="hidden" name="regType" value={regType} />
            <FieldError id={`${fid('gstin')}-err`} message={err('gstin')} />
            {extras.gstin}
            <p id={`${fid('gstin')}-help`} className="mt-1">
              <span className={`pill ${gstin ? 'bg-[#e4f1ea] text-ok' : 'bg-surface-2 text-muted'}`}>
                {gstin ? 'GST-registered ✓' : 'No GST (unregistered)'}
              </span>
            </p>
          </div>
          <div>
            <label htmlFor={fid('stateCode')} className="label">State (for GST)</label>
            <select name="stateCode" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="field" {...a11y('stateCode')}>
              {Object.entries(GST_STATE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
            <FieldError id={`${fid('stateCode')}-err`} message={err('stateCode')} />
            <p id={`${fid('stateCode')}-help`} className="text-xs text-muted mt-1">Decides CGST+SGST vs IGST on this customer&apos;s bills.</p>
          </div>
          <div>
            <label htmlFor={fid('email')} className="label">Email</label>
            <input name="email" type="email" autoComplete="email" inputMode="email" defaultValue={initial.email} className="field" placeholder="accounts@company.com" {...a11y('email')} />
            <FieldError id={`${fid('email')}-err`} message={err('email')} />
            {extras.email}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={fid('address')} className="label">Address</label>
            <input name="address" autoComplete="street-address" defaultValue={initial.address} className="field" placeholder="Billing address (printed on bills)" {...a11y('address')} />
            <FieldError id={`${fid('address')}-err`} message={err('address')} />
          </div>
          <div>
            <label htmlFor={fid('creditTermsDays')} className="label">Payment due in (days)</label>
            <input name="creditTermsDays" type="number" inputMode="numeric" min={0} max={365} defaultValue={initial.creditTermsDays ?? 0} className="field" {...a11y('creditTermsDays')} />
            <FieldError id={`${fid('creditTermsDays')}-err`} message={err('creditTermsDays')} />
            <p id={`${fid('creditTermsDays')}-help`} className="text-xs text-muted mt-1">0 = pay on delivery. Sets the due date on every bill.</p>
          </div>
        </div>
      </details>
    </>
  );
}

export function FormErrorSummary({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-crit">
      {state.field ? 'Please fix the highlighted field.' : state.error}
    </p>
  );
}

/**
 * "+ New customer" form. When opened from a document form
 * (`/customers?new=1&return=/quotations/new`), saving goes straight back there
 * with the new customer selected.
 */
export function CustomerForm({ returnTo }: { returnTo?: string } = {}) {
  const [state, action] = useActionState<ActionState, FormData>(createCustomerAction, {});
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const params = useSearchParams();
  const back = returnTo ?? params.get('return') ?? '';

  useEffect(() => {
    if (state.ok) { ref.current?.reset(); setAllowDuplicate(false); toast({ title: state.message ?? 'Customer added', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicateHint = state.duplicateId ? (
    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
      <Link href={`/customers/${state.duplicateId}`} className="text-steel font-medium hover:underline">
        Open {state.duplicateName ?? 'them'} →
      </Link>
      <label className="inline-flex items-center gap-1.5 text-muted cursor-pointer min-h-11 sm:min-h-0">
        <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="h-4 w-4" />
        Add anyway
      </label>
    </div>
  ) : null;

  return (
    <form ref={ref} action={action} className="space-y-3">
      {back && <input type="hidden" name="return" value={back} />}
      <input type="hidden" name="allowDuplicate" value={allowDuplicate ? '1' : ''} />
      <FormErrorSummary state={state} />
      <CustomerFields
        state={state}
        formRef={ref}
        extras={{ [state.field ?? 'phone']: duplicateHint }}
      />
      <div className="flex sm:justify-end">
        <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save customer</SubmitButton>
      </div>
    </form>
  );
}
