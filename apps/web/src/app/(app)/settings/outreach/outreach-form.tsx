'use client';
import { useActionState, useEffect } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';
import { updateOutreachAction, type ActionState } from './actions';
import type { OutreachSettings } from '@/lib/outreach';

export function OutreachForm({ settings }: { settings: OutreachSettings }) {
  const [state, action] = useActionState<ActionState, FormData>(updateOutreachAction, {});
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: 'Saved', variant: 'success' });
    else if (state.error) toast({ title: 'Could not save', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="grid gap-3">
      <div>
        <label className="label">Your WhatsApp / contact number</label>
        <input name="whatsappNumber" defaultValue={settings.whatsappNumber} className="field" inputMode="tel" placeholder="9811678546" />
      </div>
      <div>
        <label className="label">Intro message</label>
        <textarea name="template" defaultValue={settings.template} rows={7} className="field" />
        <p className="text-[0.7rem] text-faint mt-1">
          Placeholders auto-fill per lead: <code>{'{{name}}'}</code> · <code>{'{{product}}'}</code> · <code>{'{{number}}'}</code>
        </p>
      </div>
      <div className="flex md:justify-end">
        <SubmitButton className="btn-primary">Save</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit">{state.error}</p>}
    </form>
  );
}
