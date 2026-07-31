'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { createCustomerAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';

export function CustomerForm() {
  const [state, action] = useActionState<ActionState, FormData>(createCustomerAction, {});
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); setGstin(''); setStateCode(''); }
  }, [state]);

  // GSTIN starts with the 2-digit state code — derive it automatically.
  const onGstin = (v: string) => {
    const up = v.toUpperCase().trim();
    setGstin(up);
    if (/^\d{2}/.test(up)) setStateCode(up.slice(0, 2));
  };

  return (
    <form ref={ref} action={action} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <div className="col-span-2 md:col-span-1">
        <label className="label">Name *</label>
        <input name="name" required className="field" placeholder="Customer name" />
      </div>
      <div>
        <label className="label">GSTIN</label>
        <input name="gstin" value={gstin} onChange={(e) => onGstin(e.target.value)} className="field font-mono" placeholder="06ABCDE1234F1Z5" maxLength={15} />
      </div>
      <div>
        <label className="label">State code</label>
        <input name="stateCode" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="field" placeholder="06" maxLength={2} />
      </div>
      <div>
        <label className="label">Contact person</label>
        <input name="contactPerson" className="field" />
      </div>
      <div className="col-span-2">
        <label className="label">Address</label>
        <input name="address" className="field" placeholder="Billing address (shown on invoices)" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input name="phone" className="field" />
      </div>
      <div>
        <label className="label">Credit days</label>
        <input name="creditTermsDays" type="number" min={0} defaultValue={0} className="field" />
      </div>
      <div className="flex items-end">
        <SubmitButton className="btn-primary w-full">Add customer</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
    </form>
  );
}
