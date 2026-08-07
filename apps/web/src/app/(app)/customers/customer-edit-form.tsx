'use client';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { updateCustomerAction, setCustomerStatusAction, type ActionState } from './actions';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';

export function CustomerStatusButton({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const archived = status === 'archived';
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await setCustomerStatusAction(id, archived ? 'active' : 'archived');
        toast(res.error ? { title: 'Failed', description: res.error, variant: 'error' } : { title: res.message ?? 'Updated', variant: 'success' });
      })}
      className="btn-ghost text-sm disabled:opacity-60"
    >
      {pending ? '…' : archived ? 'Restore' : 'Archive'}
    </button>
  );
}

export function CustomerEditForm({ customer }: {
  customer: {
    id: string; name: string; regType: string; gstin: string; stateCode: string;
    contactPerson: string; phone: string; email: string; address: string; creditTermsDays: number;
  };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateCustomerAction, {});
  const [gstin, setGstin] = useState(customer.gstin);
  const [stateCode, setStateCode] = useState(customer.stateCode);
  const [regType, setRegType] = useState(customer.regType || 'unregistered');
  const toast = useToast();
  useEffect(() => { if (state.ok) toast({ title: 'Customer updated', variant: 'success' }); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGstin = (v: string) => {
    const up = v.toUpperCase().trim();
    setGstin(up);
    if (/^\d{2}/.test(up)) setStateCode(up.slice(0, 2));
    setRegType(up ? 'registered' : 'unregistered');
  };

  return (
    <form action={action} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <input type="hidden" name="id" value={customer.id} />
      <div className="col-span-2 md:col-span-1"><label className="label">Name *</label><input name="name" required defaultValue={customer.name} className="field" /></div>
      <div>
        <label className="label">Registration</label>
        <select name="regType" value={regType} onChange={(e) => setRegType(e.target.value)} className="field">
          <option value="unregistered">Unregistered</option>
          <option value="registered">GST-registered</option>
        </select>
      </div>
      <div><label className="label">GSTIN</label><input name="gstin" value={gstin} onChange={(e) => onGstin(e.target.value)} className="field font-mono" maxLength={15} /></div>
      <div><label className="label">State code</label><input name="stateCode" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="field" maxLength={2} inputMode="numeric" /></div>
      <div><label className="label">Contact person</label><input name="contactPerson" defaultValue={customer.contactPerson} className="field" /></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={customer.phone} className="field" inputMode="tel" /></div>
      <div className="col-span-2"><label className="label">Email</label><input name="email" type="email" defaultValue={customer.email} className="field" /></div>
      <div className="col-span-2 md:col-span-3"><label className="label">Address</label><input name="address" defaultValue={customer.address} className="field" /></div>
      <div><label className="label">Credit days</label><input name="creditTermsDays" type="number" min={0} defaultValue={customer.creditTermsDays} className="field" /></div>
      {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
      <div className="col-span-2 md:col-span-4 flex md:justify-end"><SubmitButton className="btn-primary w-full md:w-auto">Save changes</SubmitButton></div>
    </form>
  );
}
