'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { useToast } from '@/components/toast';
import { DEFAULT_INTRO, type OutreachSettings } from '@/lib/outreach';
import { updateOutreachAction, type ActionState } from './actions';

// A made-up enquiry so the preview reads like a real message.
const SAMPLE = { name: 'Rajesh ji', product: '200mm press tool die' };

/** Same substitution the WhatsApp button uses (see lib/outreach.ts). */
function fillPreview(template: string, number: string): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, SAMPLE.name)
    .replace(/\{\{\s*product\s*\}\}/gi, SAMPLE.product)
    .replace(/\{\{\s*number\s*\}\}/gi, number.trim() || 'your number');
}

export function OutreachForm({ settings }: { settings: OutreachSettings }) {
  const [state, action] = useActionState<ActionState, FormData>(updateOutreachAction, {});
  const [template, setTemplate] = useState(settings.template);
  const [number, setNumber] = useState(settings.whatsappNumber);
  const toast = useToast();
  const numberId = useId();
  const templateId = useId();
  const helpId = useId();
  useEffect(() => {
    if (state.ok) toast({ title: 'WhatsApp message saved', variant: 'success' });
    else if (state.error) toast({ title: 'Could not save', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const isStandard = template.trim() === DEFAULT_INTRO;

  return (
    <form action={action} className="grid gap-4">
      <div>
        <label className="label" htmlFor={numberId}>Your WhatsApp number</label>
        <input
          id={numberId}
          name="whatsappNumber"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="field sm:max-w-xs"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98xxxxxxxx"
        />
        <p className="text-xs text-muted mt-1">Customers see this number in the message.</p>
      </div>
      <div>
        <label className="label" htmlFor={templateId}>Message sent when you tap WhatsApp on an enquiry</label>
        <textarea
          id={templateId}
          name="template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={7}
          className="field"
          aria-describedby={helpId}
        />
        <p id={helpId} className="text-xs text-muted mt-1">
          Words in {'{{ }}'} fill in by themselves: <code>{'{{name}}'}</code> = their name, <code>{'{{product}}'}</code> = what they asked for, <code>{'{{number}}'}</code> = your number.
        </p>
        {!isStandard && (
          <button type="button" onClick={() => setTemplate(DEFAULT_INTRO)} className="btn-ghost !py-1 text-xs mt-2">
            Reset to standard message
          </button>
        )}
      </div>
      <div>
        <p className="label">Preview — how {SAMPLE.name} would see it</p>
        <div className="rounded-lg bg-[#e7f6e5] border border-[#cfe9cb] px-3 py-2 text-sm text-ink whitespace-pre-wrap max-w-md" aria-live="polite">
          {fillPreview(template, number)}
        </div>
      </div>
      <div className="flex sm:justify-end">
        <SubmitButton className="btn-primary w-full sm:w-auto">Save changes</SubmitButton>
      </div>
      {state.error && <p className="text-sm text-crit" role="alert">{state.error}</p>}
    </form>
  );
}
