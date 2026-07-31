'use client';
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@ms/core';
import { setInvoiceStatusAction } from './actions';

export function InvoiceStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <form action={setInvoiceStatusAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field w-auto !py-1 !px-2 text-xs"
        aria-label="Invoice status"
      >
        {INVOICE_STATUSES.map((s) => (
          <option key={s} value={s}>{INVOICE_STATUS_LABELS[s as InvoiceStatus]}</option>
        ))}
      </select>
    </form>
  );
}
