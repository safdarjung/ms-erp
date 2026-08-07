'use client';
import { INVOICE_SETTABLE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { setInvoiceStatusAction } from './actions';

export function InvoiceStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <InlineSelect
      value={status}
      ariaLabel="Invoice status"
      options={INVOICE_SETTABLE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s as InvoiceStatus] }))}
      onChange={(next) => setInvoiceStatusAction(id, next)}
    />
  );
}
