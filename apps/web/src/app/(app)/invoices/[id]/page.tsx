import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR, amountInWords, paymentStatus, stateLabel, PAYMENT_STATE_LABELS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@ms/core';
import { getInvoice } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { normalizeWaNumber } from '@/lib/outreach';
import { StatusPill } from '@/components/status-pill';
import { DocumentItemsTable } from '@/components/document-items-table';
import { ConfirmButton } from '@/components/confirm-button';
import { DocumentSavedStrip } from '@/components/document-saved-strip';
import { cancelInvoiceAction } from '../actions';
import { PaymentsPanel } from '../payments-panel';

export const metadata = { title: 'Bill' };

const stateName = (code: string | null | undefined) => stateLabel(code).replace(/^\d{2} — /, '') || 'Haryana';
const waLink = (phone: string | null | undefined, text: string) => {
  const to = normalizeWaNumber(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null;
};
const NO_PHONE = "Add the customer's phone to share";

export default async function InvoiceDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; locked?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await getInvoice(id);
  if (!data?.invoice) notFound();
  const { invoice: inv, items, customer: cust, payments, received, letterhead } = data;
  const grand = Number(inv.grandTotal);
  const ps = paymentStatus({ status: inv.status, grandTotal: grand, received, dueDate: inv.dueDate });
  const canEdit = can(user, 'invoice.edit');
  const cancelled = inv.status === 'cancelled';

  const justSaved = !!sp.created || !!sp.saved;
  const clearKeys = sp.created === '1' ? ['invoice:new'] : sp.saved ? [`invoice:${inv.id}`] : [];
  const sup = stateName(letterhead?.stateCode ?? '06');
  const pdfHref = `/print/invoice/${inv.id}?print=1`;
  const waHref = waLink(cust?.phone, `Bill ${inv.number} for ${formatINR(grand)} — PDF attached.`);
  const gstRates = new Set(items.map((it) => Number(it.gstRate)));
  const oneRate = gstRates.size === 1 ? [...gstRates][0] : null;
  const mono = 'tabular-nums font-mono';

  return (
    <div className="max-w-4xl">
      {sp.locked && (
        <div role="status" className="mb-4 rounded-lg border border-warn/40 bg-[#f6efdd]/60 px-4 py-3 text-sm text-ink">
          {sp.locked === 'cancelled' ? <>This bill is cancelled, so it can’t be changed. Make a new bill if you need to charge again.</> : null}
        </div>
      )}
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{inv.number}</h1>
          {cancelled
            ? <StatusPill status="cancelled" label={INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status} />
            : <StatusPill status={ps.state} label={PAYMENT_STATE_LABELS[ps.state]} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !cancelled && <Link href={`/invoices/${inv.id}/edit`} className="btn-ghost">Edit</Link>}
          <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-primary">Download PDF</a>
          {waHref
            ? <a href={waHref} target="_blank" rel="noreferrer" className="btn-ghost">Share on WhatsApp</a>
            : <button type="button" disabled className="btn-ghost opacity-50 cursor-not-allowed" title={NO_PHONE}>Share on WhatsApp</button>}
        </div>
      </div>

      <DocumentSavedStrip
        docLabel="Bill" number={inv.number} justSaved={justSaved} clearKeys={clearKeys}
        next={justSaved && !cancelled ? 'Next: send it to the customer →' : undefined}
        pdfHref={pdfHref} waHref={waHref} waDisabledReason={NO_PHONE}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4 text-sm">
          <div className="text-xs text-muted mb-1">Bill to</div>
          <div className="font-medium text-ink">{cust?.name ?? '—'}</div>
          {cust?.address && <div className="text-muted">{cust.address}</div>}
          {cust?.gstin && <div className="font-mono text-xs mt-1">GSTIN {cust.gstin}</div>}
          {cust?.phone && <div className="text-xs text-muted mt-1">{cust.phone}</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="flex justify-between py-0.5"><span className="text-muted">Date</span><span>{formatDate(inv.docDate)}</span></div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted">Due date</span>
            <span className={ps.state === 'overdue' ? 'text-crit font-medium' : ''}>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</span>
          </div>
          <div className="flex justify-between py-0.5 gap-3"><span className="text-muted">Place of supply</span><span className="text-right">{inv.placeOfSupply ? stateLabel(inv.placeOfSupply) : '—'}</span></div>
          <div className="flex justify-between py-0.5 gap-3"><span className="text-muted">GST type</span><span className="text-right">{inv.isInterstate ? `IGST (customer outside ${sup})` : `CGST + SGST (customer in ${sup})`}</span></div>
          {inv.poRef && <div className="flex justify-between py-0.5"><span className="text-muted">Customer PO no.</span><span>{inv.poRef}</span></div>}
        </div>
      </div>

      <DocumentItemsTable items={items} columns={inv.columnDefs} />

      {(inv.terms || inv.notes) && (
        <div className="card p-4 text-sm mb-4">
          {inv.terms && (
            <>
              <div className="text-xs text-muted mb-1.5">Terms &amp; conditions</div>
              <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{inv.terms}</div>
            </>
          )}
          {inv.notes && (
            <>
              <div className={`text-xs text-muted mb-1.5 ${inv.terms ? 'mt-3' : ''}`}>Notes</div>
              <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{inv.notes}</div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <PaymentsPanel invoiceId={inv.id} outstanding={ps.outstanding} payments={payments} canEdit={canEdit && !cancelled} />

        <div className="card p-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Subtotal (before GST)</span><span className={mono}>{formatINR(inv.subtotal)}</span></div>
          <div className="flex justify-between pt-1"><span className="text-muted">GST{oneRate !== null ? ` ${oneRate}%` : ''}</span><span className={mono}>{formatINR(Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst))}</span></div>
          <div className="text-xs text-muted text-right pb-1">
            {inv.isInterstate ? `IGST ${formatINR(inv.igst)}` : `CGST ${formatINR(inv.cgst)} + SGST ${formatINR(inv.sgst)}`}
          </div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total</span><span className={mono}>{formatINR(inv.grandTotal)}</span></div>
          <div className="flex justify-between py-1 text-ok"><span>Received</span><span className={mono}>{formatINR(received)}</span></div>
          <div className={`flex justify-between py-2 border-t border-line font-semibold ${ps.outstanding > 0.5 ? (ps.state === 'overdue' ? 'text-crit' : 'text-ink') : 'text-ok'}`}>
            <span>Balance due (baaki)</span><span className={mono}>{formatINR(ps.outstanding)}</span>
          </div>
          <div className="text-xs text-muted mt-2 italic">{amountInWords(grand)}</div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <Link href="/invoices" className="text-steel text-sm hover:underline">← Bills</Link>
        {canEdit && inv.status === 'issued' && (
          <ConfirmButton
            action={cancelInvoiceAction}
            fields={{ id: inv.id }}
            title="Cancel this bill?"
            body="The bill will be marked cancelled. Payments already recorded stay on record. This can't be undone."
            confirmLabel="Yes, cancel bill"
            pendingLabel="Cancelling…"
            toastOk={`Bill ${inv.number} cancelled`}
          >
            Cancel this bill
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
