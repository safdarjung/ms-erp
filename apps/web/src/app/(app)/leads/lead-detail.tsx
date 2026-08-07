'use client';
import { useActionState, useEffect, useRef } from 'react';
import { LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_ACTIVITY_TYPES } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { InlineSelect } from '@/components/inline-select';
import { useToast } from '@/components/toast';
import { updateLeadAction, addLeadActivityAction, assignLeadAction, type ActionState } from './actions';

const ACTIVITY_LABELS: Record<string, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note' };

export function OwnerSelect({ id, ownerUserId, users }: { id: string; ownerUserId: string | null; users: { id: string; name: string }[] }) {
  return (
    <InlineSelect
      value={ownerUserId ?? ''}
      ariaLabel="Lead owner"
      className="field !py-1 !px-2 text-xs w-full"
      options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
      onChange={(next) => assignLeadAction(id, next)}
    />
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(addLeadActivityAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); toast({ title: 'Activity logged', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex gap-2">
        <select name="type" defaultValue="call" className="field w-32 shrink-0">
          {LEAD_ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
        </select>
        <input name="notes" className="field flex-1" placeholder="What happened? (e.g. called, sent revised rate)" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="label !mb-0 text-xs text-muted">Set next follow-up
          <input name="nextFollowupAt" type="date" className="field !py-1 ml-2 w-40 inline-block" />
        </label>
        <SubmitButton className="btn-primary text-xs ml-auto">Log activity</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit">{state.error}</p>}
    </form>
  );
}

export function LeadEditForm({ lead }: {
  lead: {
    id: string; customerName: string; contact: string; phone: string; email: string;
    source: string; requirement: string; stage: string; valueEstimate: string; nextFollowupDate: string;
  };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateLeadAction, {});
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: 'Lead updated', variant: 'success' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="id" value={lead.id} />
      <div className="col-span-2"><label className="label">Customer / enquiry *</label><input name="customerName" required defaultValue={lead.customerName} className="field" /></div>
      <div><label className="label">Contact person</label><input name="contact" defaultValue={lead.contact} className="field" /></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={lead.phone} className="field" /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={lead.email} className="field" /></div>
      <div><label className="label">Source</label><input name="source" defaultValue={lead.source} className="field" /></div>
      <div><label className="label">Est. value (₹)</label><input name="valueEstimate" type="number" min={0} defaultValue={lead.valueEstimate} className="field" /></div>
      <div>
        <label className="label">Stage</label>
        <select name="stage" defaultValue={lead.stage} className="field">
          {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className="label">Requirement</label><input name="requirement" defaultValue={lead.requirement} className="field" /></div>
      <div className="col-span-2"><label className="label">Next follow-up</label><input name="nextFollowupAt" type="date" defaultValue={lead.nextFollowupDate} className="field" /></div>
      {state.error && <p className="text-sm text-crit col-span-2">{state.error}</p>}
      <div className="col-span-2"><SubmitButton className="btn-primary">Save changes</SubmitButton></div>
    </form>
  );
}
