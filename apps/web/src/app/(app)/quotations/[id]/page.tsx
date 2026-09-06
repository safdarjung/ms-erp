import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR, stateLabel, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { getQuotation } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { normalizeWaNumber } from '@/lib/outreach';
import { StatusPill } from '@/components/status-pill';
import { DocumentItemsTable } from '@/components/document-items-table';
import { ConfirmButton } from '@/components/confirm-button';
import { DocumentSavedStrip } from '@/components/document-saved-strip';
import { convertToInvoiceAction, convertToOrderAction, duplicateQuotationAction } from '../actions';
import { QuotationStatusSelect } from '../status-select';

export const metadata = { title: 'Quotation' };

const stateName = (code: string | null | undefined) => stateLabel(code).replace(/^\d{2} — /, '') || 'Haryana';
const waLink = (phone: string | null | undefined, text: string) => {
  const to = normalizeWaNumber(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null;
};
const NO_PHONE = "Add the customer's phone to share";

export default async function QuotationDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; locked?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await getQuotation(id);
  if (!data?.quotation) notFound();
  const { quotation: q, items, customer: cust, letterhead } = data;
  const converted = !!q.convertedInvoiceId;
  const ordered = !!q.convertedOrderId;
  const locked = converted || ordered;
  const canEdit = can(user, 'quotation.edit');

  const justSaved = !!sp.created || !!sp.saved;
  const clearKeys = sp.created === '1' ? ['quotation:new'] : sp.saved ? [`quotation:${q.id}`] : [];
  const sup = stateName(letterhead?.stateCode ?? '06');
  const pdfHref = `/print/quotation/${q.id}?print=1`;
  const waHref = waLink(cust?.phone, `Quotation ${q.number} for ${formatINR(q.grandTotal)} — PDF attached.`);
  const gstRates = new Set(items.map((it) => Number(it.gstRate)));
  const oneRate = gstRates.size === 1 ? [...gstRates][0] : null;
  const mono = 'tabular-nums font-mono';

  return (
    <div className="max-w-4xl">
      {sp.locked && (
        <div role="status" className="mb-4 rounded-lg border border-warn/40 bg-[#f6efdd]/60 px-4 py-3 text-sm text-ink">
          {sp.locked === 'bill' ? <>This quotation can’t be changed because a bill was already made from it. Change that bill instead, or use <b>Copy as new quotation</b>.</> : sp.locked === 'order' ? <>This quotation can’t be changed because the work was already ordered. Change that order instead, or use <b>Copy as new quotation</b>.</> : null}
        </div>
      )}
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{q.number}</h1>
          {locked || !canEdit
            ? <StatusPill status={q.status} label={QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status} className="mt-1.5" />
            : <QuotationStatusSelect id={q.id} status={q.status} />}
          {ordered && !converted && (
            <Link href={`/orders/${q.convertedOrderId}`} className="text-sm text-ok hover:underline mt-1.5">Order made →</Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !locked && <Link href={`/quotations/${q.id}/edit`} className="btn-ghost">Edit</Link>}
          <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-ghost">Download PDF</a>
          {waHref
            ? <a href={waHref} target="_blank" rel="noreferrer" className="btn-ghost">Share on WhatsApp</a>
            : <button type="button" disabled className="btn-ghost opacity-50 cursor-not-allowed" title={NO_PHONE}>Share on WhatsApp</button>}
          {can(user, 'quotation.create') && (
            <ConfirmButton
              action={duplicateQuotationAction}
              fields={{ id: q.id }}
              className="btn-ghost"
              variant="primary"
              title="Copy this quotation?"
              body="A new quotation with the same items will be made — you can change it before sending."
              confirmLabel="Yes, copy it"
              pendingLabel="Copying…"
            >
              Copy as new quotation
            </ConfirmButton>
          )}
          {converted ? (
            <Link href={`/invoices/${q.convertedInvoiceId}`} className="btn-primary">View bill →</Link>
          ) : ordered ? (
            <Link href={`/orders/${q.convertedOrderId}`} className="btn-primary">View order →</Link>
          ) : (
            <>
              {can(user, 'invoice.create') && (
                <ConfirmButton
                  action={convertToInvoiceAction}
                  fields={{ quotationId: q.id }}
                  className="btn-ghost"
                  variant="primary"
                  title="Make a bill from this quotation?"
                  body="A GST bill with these same items will be created. After that the quotation can't be changed. This can't be undone."
                  confirmLabel="Yes, make the bill"
                  pendingLabel="Making bill…"
                >
                  Make bill
                </ConfirmButton>
              )}
              {can(user, 'order.create') && (
                <ConfirmButton
                  action={convertToOrderAction}
                  fields={{ quotationId: q.id }}
                  className="btn-primary"
                  variant="primary"
                  title="Make an order from this quotation?"
                  body="An order with these same items will be created and linked to this quotation. GST is worked out when you make the bill."
                  confirmLabel="Yes, make the order"
                  pendingLabel="Making order…"
                >
                  Make order
                </ConfirmButton>
              )}
            </>
          )}
        </div>
      </div>

      <DocumentSavedStrip
        docLabel="Quotation" number={q.number} justSaved={justSaved} clearKeys={clearKeys}
        next={justSaved || q.status === 'draft' ? 'Next: send it to the customer →' : undefined}
        pdfHref={pdfHref} waHref={waHref} waDisabledReason={NO_PHONE}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4 text-sm">
          <div className="text-xs text-muted mb-1">Customer</div>
          <div className="font-medium text-ink">{cust?.name ?? '—'}</div>
          {cust?.address && <div className="text-muted">{cust.address}</div>}
          {cust?.gstin && <div className="font-mono text-xs mt-1">GSTIN {cust.gstin}</div>}
          {cust?.phone && <div className="text-xs text-muted mt-1">{cust.phone}</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="flex justify-between py-0.5"><span className="text-muted">Date</span><span>{formatDate(q.docDate)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Valid for</span><span>{q.validityDays} days</span></div>
          <div className="flex justify-between py-0.5 gap-3"><span className="text-muted">GST type</span><span className="text-right">{q.isInterstate ? `IGST (customer outside ${sup})` : `CGST + SGST (customer in ${sup})`}</span></div>
        </div>
      </div>

      <DocumentItemsTable items={items} columns={q.columnDefs} />

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {q.terms || q.notes ? (
          <div className="card p-4 text-sm flex-1">
            {q.terms && (
              <>
                <div className="text-xs text-muted mb-1.5">Terms &amp; conditions</div>
                <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{q.terms}</div>
              </>
            )}
            {q.notes && (
              <>
                <div className={`text-xs text-muted mb-1.5 ${q.terms ? 'mt-3' : ''}`}>Notes</div>
                <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{q.notes}</div>
              </>
            )}
          </div>
        ) : <div className="flex-1" />}
        <div className="card p-4 w-full md:w-80 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Subtotal (before GST)</span><span className={mono}>{formatINR(q.subtotal)}</span></div>
          <div className="flex justify-between pt-1"><span className="text-muted">GST{oneRate !== null ? ` ${oneRate}%` : ''}</span><span className={mono}>{formatINR(Number(q.cgst) + Number(q.sgst) + Number(q.igst))}</span></div>
          <div className="text-xs text-muted text-right pb-1">
            {q.isInterstate ? `IGST ${formatINR(q.igst)}` : `CGST ${formatINR(q.cgst)} + SGST ${formatINR(q.sgst)}`}
          </div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total</span><span className={mono}>{formatINR(q.grandTotal)}</span></div>
          <div className="text-xs text-muted mt-1">{q.isInterstate ? `Customer outside ${sup} → IGST` : `Customer in ${sup} → CGST + SGST`}</div>
        </div>
      </div>

      <div className="mt-4"><Link href="/quotations" className="text-steel text-sm hover:underline">← Quotations</Link></div>
    </div>
  );
}
