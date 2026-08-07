'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { createCustomerAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';

export function CustomerForm() {
  const [state, action] = useActionState<ActionState, FormData>(createCustomerAction, {});
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [regType, setRegType] = useState<'registered' | 'unregistered'>('unregistered');
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); setGstin(''); setStateCode(''); setRegType('unregistered'); toast({ title: 'Customer added', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // GSTIN starts with the 2-digit state code — derive it automatically, and a
  // customer with a GSTIN is by definition GST-registered (drives CGST/SGST↔IGST).
  const onGstin = (v: string) => {
    const up = v.toUpperCase().trim();
    setGstin(up);
    if (/^\d{2}/.test(up)) setStateCode(up.slice(0, 2));
    setRegType(up ? 'registered' : 'unregistered');
  };

  return (
    <form ref={ref} action={action} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <div className="col-span-2 md:col-span-1">
        <label className="label">Name *</label>
        <input name="name" required className="field" placeholder="Customer name" />
      </div>
      <div>
        <label className="label">Registration</label>
        <select name="regType" value={regType} onChange={(e) => setRegType(e.target.value as 'registered' | 'unregistered')} className="field">
          <option value="unregistered">Unregistered</option>
          <option value="registered">GST-registered</option>
        </select>
      </div>
      <div>
        <label className="label">GSTIN</label>
        <input name="gstin" value={gstin} onChange={(e) => onGstin(e.target.value)} className="field font-mono" placeholder="06ABCDE1234F1Z5" maxLength={15} />
      </div>
      <div>
        <label className="label">State code</label>
        <input name="stateCode" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="field" placeholder="06" maxLength={2} inputMode="numeric" />
      </div>
      <div>
        <label className="label">Contact person</label>
        <input name="contactPerson" className="field" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input name="phone" className="field" inputMode="tel" />
      </div>
      <div className="col-span-2">
        <label className="label">Email</label>
        <input name="email" type="email" className="field" placeholder="accounts@company.com" />
      </div>
      <div className="col-span-2 md:col-span-3">
        <label className="label">Address</label>
        <input name="address" className="field" placeholder="Billing address (shown on invoices)" />
      </div>
      <div>
        <label className="label">Credit days</label>
        <input name="creditTermsDays" type="number" min={0} defaultValue={0} className="field" />
      </div>
      <div className="col-span-2 md:col-span-4 flex md:justify-end">
        <SubmitButton className="btn-primary w-full md:w-auto">Add customer</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
    </form>
  );
}
