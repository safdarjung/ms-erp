'use client';
import { QUOTATION_SETTABLE_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { setQuotationStatusAction } from './actions';

export function QuotationStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <span className="inline-flex flex-col gap-1">
      <InlineSelect
        value={status}
        ariaLabel="Quotation status"
        options={QUOTATION_SETTABLE_STATUSES.map((s) => ({ value: s, label: QUOTATION_STATUS_LABELS[s as QuotationStatus] }))}
        onChange={(next) => setQuotationStatusAction(id, next)}
      />
      <span className="text-xs text-muted">Mark it here after you&apos;ve sent it on WhatsApp or email.</span>
    </span>
  );
}
