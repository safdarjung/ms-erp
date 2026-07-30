'use client';
import { useActionState, useEffect, useRef } from 'react';
import { createLeadAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';

export function LeadForm() {
  const [state, action] = useActionState<ActionState, FormData>(createLeadAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end mb-6">
      <div className="col-span-2 md:col-span-1">
        <label className="label">Customer / enquiry *</label>
        <input name="customerName" required className="field" placeholder="e.g. Verma Dies" />
      </div>
      <div>
        <label className="label">Source</label>
        <input name="source" className="field" placeholder="IndiaMART / WhatsApp / Referral" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input name="phone" className="field" />
      </div>
      <div>
        <label className="label">Est. value (₹)</label>
        <input name="valueEstimate" type="number" min={0} className="field" placeholder="0" />
      </div>
      <div className="col-span-2 md:col-span-3">
        <label className="label">Requirement</label>
        <input name="requirement" className="field" placeholder="What do they need?" />
      </div>
      <div className="flex items-end">
        <SubmitButton className="btn-primary w-full">Add lead</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
    </form>
  );
}
