'use client';
import { QUOTATION_SETTABLE_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { setQuotationStatusAction } from './actions';

export function QuotationStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <form action={setQuotationStatusAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field w-auto !py-1 !px-2 text-xs"
        aria-label="Quotation status"
      >
        {QUOTATION_SETTABLE_STATUSES.map((s) => (
          <option key={s} value={s}>{QUOTATION_STATUS_LABELS[s as QuotationStatus]}</option>
        ))}
      </select>
    </form>
  );
}
