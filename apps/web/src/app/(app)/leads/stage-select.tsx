'use client';
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { setLeadStageAction } from './actions';

export function StageSelect({ id, stage }: { id: string; stage: string }) {
  return (
    <form action={setLeadStageAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="stage"
        defaultValue={stage}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field w-auto !py-1 !px-2 text-xs"
        aria-label="Lead stage"
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
        ))}
      </select>
    </form>
  );
}
