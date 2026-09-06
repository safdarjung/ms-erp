'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { formatINR, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@ms/core';
import type { ActionResult } from '@/lib/forms';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/format';
import { recordPaymentAction, deletePaymentAction } from './actions';

type Payment = { id: string; amount: string; paidOn: Date; method: string; reference: string | null; notes: string | null };

/**
 * "Payments received" card on a bill: one big "Payment received (₹balance)"
 * button opens a short form (amount + today prefilled), the list below shows
 * every receipt, each removable with a confirm.
 */
export function PaymentsPanel({
  invoiceId, outstanding, payments, canEdit,
}: {
  invoiceId: string;
  outstanding: number;
  payments: Payment[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ActionResult, FormData>(recordPaymentAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const hasBalance = outstanding > 0.5;

  useEffect(() => {
    if (state.ok) { ref.current?.reset(); setOpen(false); toast({ title: state.message ?? 'Payment received', variant: 'success' }); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) amountRef.current?.focus(); }, [open]);

  return (
    <div id="payment" className="card p-4 scroll-mt-20">
      <div className="font-medium text-sm mb-3">Payments received</div>

      {canEdit && hasBalance && !open && (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary w-full mb-3">
          Payment received ({formatINR(outstanding)})
        </button>
      )}

      {open && canEdit && (
        <form ref={ref} action={action} className="mb-3 pb-3 border-b border-line grid grid-cols-2 gap-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <div>
            <label htmlFor="pay-amount" className="label">Amount (₹) *</label>
            <input ref={amountRef} id="pay-amount" name="amount" type="number" step="0.01" min="0.01" max={hasBalance ? outstanding.toFixed(2) : undefined}
              defaultValue={hasBalance ? outstanding.toFixed(2) : ''} required className="field" inputMode="decimal" />
          </div>
          <div>
            <label htmlFor="pay-date" className="label">Date *</label>
            <input id="pay-date" name="paidOn" type="date" defaultValue={today} required className="field" />
          </div>
          <div>
            <label htmlFor="pay-method" className="label">How was it paid?</label>
            <select id="pay-method" name="method" defaultValue="bank" className="field">
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pay-ref" className="label">Reference no. (optional)</label>
            <input id="pay-ref" name="reference" className="field" placeholder="UTR / cheque / UPI ref" maxLength={60} />
          </div>
          <div className="col-span-2">
            <label htmlFor="pay-note" className="label">Note (optional)</label>
            <input id="pay-note" name="notes" className="field" placeholder="e.g. Part payment against first die" maxLength={300} />
          </div>
          {state.error && <p role="alert" className="text-sm text-crit col-span-2">{state.error}</p>}
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving…">Save payment</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost w-full sm:w-auto">Not now</button>
          </div>
        </form>
      )}

      {payments.length === 0 ? (
        <p className="text-sm text-muted">
          No payment received yet.{canEdit && hasBalance ? ' Tap Payment received when money comes in.' : ''}
        </p>
      ) : (
        <ul className="divide-y divide-line -mx-1">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-mono tabular-nums text-ink">{formatINR(p.amount)}</span>
                <span className="text-muted"> · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</span>
                {p.reference && <span className="text-muted"> · {p.reference}</span>}
                <div className="text-xs text-muted">{formatDate(p.paidOn)}{p.notes ? ` — ${p.notes}` : ''}</div>
              </div>
              {canEdit && (
                <ConfirmButton
                  action={deletePaymentAction}
                  fields={{ paymentId: p.id, invoiceId }}
                  className="btn-ghost text-xs !text-crit !border-crit/40 hover:!bg-[#f6e5e1] shrink-0"
                  title={`Remove this ${formatINR(p.amount)} payment?`}
                  body={`${formatINR(p.amount)} will be added back to the balance due. You can add it again later.`}
                  confirmLabel="Yes, remove"
                  pendingLabel="Removing…"
                  toastOk={`${formatINR(p.amount)} removed · added back to balance due`}
                >
                  Remove
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
