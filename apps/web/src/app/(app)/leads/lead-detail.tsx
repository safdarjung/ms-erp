'use client';
import { useActionState, useEffect, useId, useRef, type RefObject } from 'react';
import { LEAD_ACTIVITY_TYPES } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { InlineSelect } from '@/components/inline-select';
import { useToast } from '@/components/toast';
import { updateLeadAction, addLeadActivityAction, assignLeadAction, type ActionState } from './actions';
import { LeadFields, FollowupField, type LeadValues } from './lead-form';
import { FieldError, FormErrorSummary, useFocusInvalid } from '../customers/customer-form';

export const ACTIVITY_LABELS: Record<string, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note' };

export function OwnerSelect({ id, ownerUserId, users }: { id: string; ownerUserId: string | null; users: { id: string; name: string }[] }) {
  return (
    <InlineSelect
      value={ownerUserId ?? ''}
      ariaLabel="Handled by"
      className="field !py-1 !pl-2 !pr-7 text-xs w-full"
      options={[{ value: '', label: 'Nobody yet' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
      onChange={(next) => assignLeadAction(id, next)}
    />
  );
}

/** Note + optional next follow-up. Chips let the user set the date in one tap. */
export function ActivityForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(addLeadActivityAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); toast({ title: state.message ?? 'Note saved', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusInvalid(ref as RefObject<HTMLFormElement | null>, state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormErrorSummary state={state} />
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-36 shrink-0">
          <label htmlFor={fid('type')} className="label">What was it?</label>
          <select id={fid('type')} name="type" defaultValue="call" className="field">
            {LEAD_ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor={fid('notes')} className="label">What happened?</label>
          <input
            id={fid('notes')}
            name="notes"
            className="field"
            placeholder="e.g. Called, sending revised rate"
            aria-invalid={state.field === 'notes' || undefined}
            aria-describedby={state.field === 'notes' ? `${fid('notes')}-err` : undefined}
          />
          <FieldError id={`${fid('notes')}-err`} message={state.field === 'notes' ? state.error : undefined} />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <FollowupField key={state.ok ? 'saved' : 'editing'} state={state} fid={fid} allowNone compact />
        </div>
        <SubmitButton className="btn-primary text-sm sm:ml-auto w-full sm:w-auto" pendingLabel="Saving…">Save note</SubmitButton>
      </div>
    </form>
  );
}

export function LeadEditForm({ lead }: { lead: LeadValues & { id: string } }) {
  const [state, action] = useActionState<ActionState, FormData>(updateLeadAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: state.message ?? 'Enquiry saved', variant: 'success' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusInvalid(ref as RefObject<HTMLFormElement | null>, state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="id" value={lead.id} />
      <FormErrorSummary state={state} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LeadFields initial={lead} state={state} showStage defaultFollowupDays={undefined} />
        <div className="sm:col-span-2">
          <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save changes</SubmitButton>
        </div>
      </div>
    </form>
  );
}
