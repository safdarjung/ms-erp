'use client';
import { useActionState, useEffect, useRef } from 'react';
import { createLeadAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';

export function LeadForm() {
  const [state, action] = useActionState<ActionState, FormData>(createLeadAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); toast({ title: 'Lead added', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form ref={ref} action={action} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <div className="col-span-2 md:col-span-1">
        <label className="label">Customer / enquiry *</label>
        <input name="customerName" required className="field" placeholder="e.g. Verma Dies" />
      </div>
      <div>
        <label className="label">Contact person</label>
        <input name="contact" className="field" placeholder="Name of the person" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input name="phone" className="field" inputMode="tel" />
      </div>
      <div>
        <label className="label">Email</label>
        <input name="email" type="email" className="field" placeholder="name@company.com" />
      </div>
      <div>
        <label className="label">Source</label>
        <input name="source" className="field" placeholder="IndiaMART / WhatsApp / Referral" />
      </div>
      <div>
        <label className="label">Est. value (₹)</label>
        <input name="valueEstimate" type="number" min={0} className="field" placeholder="0" />
      </div>
      <div className="col-span-2">
        <label className="label">Requirement</label>
        <input name="requirement" className="field" placeholder="What do they need?" />
      </div>
      <div className="col-span-2 md:col-span-4 flex md:justify-end">
        <SubmitButton className="btn-primary w-full md:w-auto">Add lead</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
    </form>
  );
}
