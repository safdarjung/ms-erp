'use client';
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { useToast } from '@/components/toast';
import { setLeadStageAction } from './actions';

/**
 * Stage picker. Marking an enquiry Won nudges the user to add the customer
 * (the toast can't hold a button, so the enquiry page also shows a banner).
 */
export function StageSelect({ id, stage, name }: { id: string; stage: string; name?: string }) {
  const toast = useToast();
  return (
    <InlineSelect
      value={stage}
      ariaLabel="Stage"
      options={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
      onChange={async (next) => {
        const res = await setLeadStageAction(id, next);
        if (res.ok && next === 'won' && !res.convertedCustomerId) {
          const who = name ?? res.customerName ?? 'them';
          toast({
            title: `Marked won 🎉 — add ${who} as a customer?`,
            description: 'Open the enquiry and tap "Add as customer" to make quotations and bills for them.',
            variant: 'success',
          });
        }
        return res;
      }}
    />
  );
}
