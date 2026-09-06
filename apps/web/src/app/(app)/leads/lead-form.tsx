'use client';
import { useActionState, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { createLeadAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';
import { FieldError, FormErrorSummary, useFocusInvalid } from '../customers/customer-form';
// TODO(ux): lift FieldError / FormErrorSummary / useFocusInvalid into components/field-error.tsx once
// every form uses them; they live in customer-form.tsx for now to stay inside this agent's file list.

export const LEAD_SOURCES = ['IndiaMART', 'TradeIndia', 'WhatsApp', 'Phone call', 'Walk-in', 'Email', 'Referral', 'Website'] as const;
export const OTHER_SOURCE = 'Other';

export const DEFAULT_FOLLOWUP_DAYS = 2;
export const FOLLOWUP_CHIPS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
] as const;

/** `yyyy-mm-dd` in the browser's local time (what `<input type="date">` wants). */
export function localDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export const daysFromNow = (n: number) => localDateInput(new Date(Date.now() + n * 86_400_000));

export type LeadValues = {
  customerName: string; contact: string; phone: string; email: string; source: string;
  requirement: string; valueEstimate: string; nextFollowupAt: string; stage: string;
};

type FieldProps = { state: ActionState; fid: (name: string) => string };

function a11yFor(state: ActionState, fid: (n: string) => string, name: string) {
  return {
    id: fid(name),
    'aria-invalid': state.field === name || undefined,
    'aria-describedby': state.field === name ? `${fid(name)}-err` : undefined,
  };
}

/** Source as a pick-list; "Other…" reveals a text box. Unknown saved values land in "Other". */
export function SourceField({ initial = '', state, fid }: FieldProps & { initial?: string }) {
  const known = (LEAD_SOURCES as readonly string[]).includes(initial);
  const [source, setSource] = useState(initial ? (known ? initial : OTHER_SOURCE) : '');
  const [other, setOther] = useState(known ? '' : initial);
  return (
    <div>
      <label htmlFor={fid('source')} className="label">Source</label>
      <select name="source" value={source} onChange={(e) => setSource(e.target.value)} className="field" {...a11yFor(state, fid, 'source')}>
        <option value="">Where did it come from?</option>
        {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        <option value={OTHER_SOURCE}>Other…</option>
      </select>
      {source === OTHER_SOURCE && (
        <input
          name="sourceOther"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          className="field mt-2"
          placeholder="e.g. Exhibition, old customer"
          aria-label="Other source"
          maxLength={80}
        />
      )}
      <FieldError id={`${fid('source')}-err`} message={state.field === 'source' ? state.error : undefined} />
    </div>
  );
}

/**
 * Next follow-up date with one-tap chips. `defaultDays` pre-fills a date on
 * mount (client-side, so server and browser never disagree on "today").
 * `allowNone` adds a "No follow-up" chip that clears the enquiry's date
 * (sends `clearFollowup=1`).
 */
export function FollowupField({ initial, defaultDays, state, fid, allowNone = false, label = 'Next follow-up', compact = false }: FieldProps & {
  initial?: string; defaultDays?: number; allowNone?: boolean; label?: string; compact?: boolean;
}) {
  const [date, setDate] = useState(initial ?? '');
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (!initial && defaultDays !== undefined) setDate(daysFromNow(defaultDays));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = 'btn-ghost text-xs !py-1 !px-2.5 aria-pressed:bg-accent-soft aria-pressed:border-accent aria-pressed:text-ink';
  return (
    <div>
      <label htmlFor={fid('nextFollowupAt')} className="label">{label}</label>
      <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
        <input
          name="nextFollowupAt"
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setNone(false); }}
          className={`field ${compact ? 'w-auto' : ''}`}
          {...a11yFor(state, fid, 'nextFollowupAt')}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick pick a follow-up date">
          {allowNone && !date && <span className="text-xs text-muted self-center">Next follow-up?</span>}
          {FOLLOWUP_CHIPS.map((c) => {
            const v = daysFromNow(c.days);
            return (
              <button key={c.label} type="button" className={chip} aria-pressed={date === v} onClick={() => { setDate(v); setNone(false); }}>
                {c.label}
              </button>
            );
          })}
          {allowNone && (
            <button type="button" className={chip} aria-pressed={none} onClick={() => { setDate(''); setNone(true); }}>
              No follow-up
            </button>
          )}
        </div>
      </div>
      {allowNone && <input type="hidden" name="clearFollowup" value={none ? '1' : ''} />}
      <FieldError id={`${fid('nextFollowupAt')}-err`} message={state.field === 'nextFollowupAt' ? state.error : undefined} />
    </div>
  );
}

/**
 * The enquiry inputs shared by the new-enquiry form, the edit form and the
 * email-inbox review form. Renders grid cells only — the parent owns the
 * `<form>` and the grid.
 */
export function LeadFields({ initial = {}, state, showStage = false, defaultFollowupDays = DEFAULT_FOLLOWUP_DAYS }: {
  initial?: Partial<LeadValues>;
  state: ActionState;
  showStage?: boolean;
  defaultFollowupDays?: number;
}) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const err = (name: string) => (state.field === name ? state.error : undefined);
  const a11y = (name: string) => a11yFor(state, fid, name);

  return (
    <>
      <div className="sm:col-span-2">
        <label htmlFor={fid('customerName')} className="label">Company or person *</label>
        <input name="customerName" required defaultValue={initial.customerName} className="field" placeholder="e.g. Verma Dies" autoComplete="organization" {...a11y('customerName')} />
        <FieldError id={`${fid('customerName')}-err`} message={err('customerName')} />
      </div>
      <div>
        <label htmlFor={fid('contact')} className="label">Contact person</label>
        <input name="contact" defaultValue={initial.contact} className="field" placeholder="Who to call" autoComplete="name" {...a11y('contact')} />
        <FieldError id={`${fid('contact')}-err`} message={err('contact')} />
      </div>
      <div>
        <label htmlFor={fid('phone')} className="label">Phone</label>
        <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" defaultValue={initial.phone} className="field" placeholder="98xxxxxxxx" maxLength={20} {...a11y('phone')} />
        <FieldError id={`${fid('phone')}-err`} message={err('phone')} />
      </div>
      <div>
        <label htmlFor={fid('email')} className="label">Email</label>
        <input name="email" type="email" inputMode="email" autoComplete="email" defaultValue={initial.email} className="field" placeholder="name@company.com" {...a11y('email')} />
        <FieldError id={`${fid('email')}-err`} message={err('email')} />
      </div>
      <SourceField initial={initial.source} state={state} fid={fid} />
      <div>
        <label htmlFor={fid('valueEstimate')} className="label">Approx. value (₹)</label>
        <input name="valueEstimate" type="number" inputMode="decimal" min={0} step="any" defaultValue={initial.valueEstimate} className="field" placeholder="0" {...a11y('valueEstimate')} />
        <FieldError id={`${fid('valueEstimate')}-err`} message={err('valueEstimate')} />
      </div>
      {showStage && (
        <div>
          <label htmlFor={fid('stage')} className="label">Stage</label>
          <select name="stage" defaultValue={initial.stage ?? 'new'} className="field" {...a11y('stage')}>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
          </select>
          <FieldError id={`${fid('stage')}-err`} message={err('stage')} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={fid('requirement')} className="label">Requirement</label>
        <input name="requirement" defaultValue={initial.requirement} className="field" placeholder="What do they need? (e.g. 2 progressive dies, EN31)" {...a11y('requirement')} />
        <FieldError id={`${fid('requirement')}-err`} message={err('requirement')} />
      </div>
      <div className="sm:col-span-2">
        <FollowupField initial={initial.nextFollowupAt} defaultDays={initial.nextFollowupAt ? undefined : defaultFollowupDays} state={state} fid={fid} compact />
      </div>
    </>
  );
}

/** "+ New enquiry" form. Resets (and re-defaults the follow-up) after a save. */
export function LeadForm({ defaultSource }: { defaultSource?: string } = {}) {
  const [state, action] = useActionState<ActionState, FormData>(createLeadAction, {});
  const [resetKey, setResetKey] = useState(0);
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setResetKey((k) => k + 1);
      toast({ title: state.message ?? 'Enquiry saved', variant: 'success' });
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusInvalid(ref as RefObject<HTMLFormElement | null>, state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <FormErrorSummary state={state} />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <LeadFields key={resetKey} state={state} initial={{ source: defaultSource }} />
        <div className="sm:col-span-2 md:col-span-4 flex sm:justify-end">
          <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save enquiry</SubmitButton>
        </div>
      </div>
    </form>
  );
}
