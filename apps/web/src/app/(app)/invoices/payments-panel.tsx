'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { formatINR, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/format';
import { recordPaymentAction, deletePaymentAction, type ActionState } from './actions';

type Payment = { id: string; amount: string; paidOn: Date; method: string; reference: string | null; notes: string | null };

export function PaymentsPanel({
  invoiceId, outstanding, payments, canEdit,
}: {
  invoiceId: string;
  outstanding: number;
  payments: Payment[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(recordPaymentAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if ((state as { ok?: boolean }).ok) { ref.current?.reset(); setOpen(false); toast({ title: 'Payment recorded', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium text-sm">Payments received</div>
        {canEdit && outstanding > 0.5 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">
            {open ? 'Close' : '+ Record payment'}
          </button>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line -mx-1">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-mono tabular-nums text-ink">{formatINR(p.amount)}</span>
                <span className="text-muted"> · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</span>
                {p.reference && <span className="text-faint"> · {p.reference}</span>}
                <div className="text-xs text-faint">{formatDate(p.paidOn)}{p.notes ? ` — ${p.notes}` : ''}</div>
              </div>
              {canEdit && (
                <ConfirmButton
                  action={deletePaymentAction}
                  fields={{ paymentId: p.id, invoiceId }}
                  className="text-crit hover:underline text-xs shrink-0"
                  title="Remove this payment?"
                  body={<>This deletes the {formatINR(p.amount)} receipt and re-opens that amount as outstanding.</>}
                  confirmLabel="Remove payment"
                  toastOk="Payment removed"
                >
                  Remove
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && canEdit && (
        <form ref={ref} action={action} className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <div>
            <label className="label">Amount (₹) *</label>
            <input name="amount" type="number" step="0.01" min="0.01" defaultValue={outstanding > 0 ? outstanding.toFixed(2) : ''} required className="field" inputMode="decimal" />
          </div>
          <div>
            <label className="label">Date *</label>
            <input name="paidOn" type="date" defaultValue={today} required className="field" />
          </div>
          <div>
            <label className="label">Method</label>
            <select name="method" defaultValue="bank" className="field">
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reference</label>
            <input name="reference" className="field" placeholder="UTR / cheque no." />
          </div>
          <div className="col-span-2">
            <label className="label">Note</label>
            <input name="notes" className="field" placeholder="Optional" />
          </div>
          {(state as { error?: string }).error && <p className="text-sm text-crit col-span-2">{(state as { error?: string }).error}</p>}
          <div className="col-span-2"><SubmitButton className="btn-primary w-full sm:w-auto">Record payment</SubmitButton></div>
        </form>
      )}
    </div>
  );
}
