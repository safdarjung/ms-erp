'use client';
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { setLeadStageAction } from './actions';

export function StageSelect({ id, stage }: { id: string; stage: string }) {
  return (
    <InlineSelect
      value={stage}
      ariaLabel="Lead stage"
      options={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
      onChange={(next) => setLeadStageAction(id, next)}
    />
  );
}
