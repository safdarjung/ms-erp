import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { getQuotation } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { ConfirmButton } from '@/components/confirm-button';
import { convertToInvoiceAction, convertToOrderAction, duplicateQuotationAction } from '../actions';
import { QuotationStatusSelect } from '../status-select';

export const metadata = { title: 'Quotation' };

export default async function QuotationDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getQuotation(id);
  if (!data?.quotation) notFound();
  const { quotation: q, items, customer: cust } = data;
  const converted = !!q.convertedInvoiceId;
  const ordered = !!q.convertedOrderId;
  const locked = converted || ordered;

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{q.number}</h1>
          {locked || !can(user, 'quotation.edit')
            ? <StatusPill status={q.status} label={QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status} />
            : <QuotationStatusSelect id={q.id} status={q.status} />}
          {ordered && !converted && <span className="text-xs text-ok">✓ ordered</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, 'quotation.edit') && !locked && (
            <Link href={`/quotations/${q.id}/edit`} className="btn-ghost">Edit</Link>
          )}
          <a href={`/print/quotation/${q.id}`} target="_blank" rel="noreferrer" className="btn-ghost">Preview</a>
          <a href={`/print/quotation/${q.id}?print=1`} target="_blank" rel="noreferrer" className="btn-ghost">Print / PDF</a>
          {can(user, 'quotation.create') && (
            <form action={duplicateQuotationAction}>
              <input type="hidden" name="id" value={q.id} />
              <button type="submit" className="btn-ghost">Duplicate</button>
            </form>
          )}
          {converted ? (
            <Link href={`/invoices/${q.convertedInvoiceId}`} className="btn-primary">View invoice →</Link>
          ) : ordered ? (
            <Link href={`/orders/${q.convertedOrderId}`} className="btn-primary">View order →</Link>
          ) : (
            <>
              {can(user, 'order.create') && (
                <ConfirmButton
                  action={convertToOrderAction}
                  fields={{ quotationId: q.id }}
                  className="btn-ghost"
                  variant="primary"
                  title="Convert to sales order?"
                  body={<>This opens a sales order from <b>{q.number}</b> in the order book. GST is finalised later when you invoice.</>}
                  confirmLabel="Create order"
                >
                  Convert to order
                </ConfirmButton>
              )}
              {can(user, 'invoice.create') && (
                <ConfirmButton
                  action={convertToInvoiceAction}
                  fields={{ quotationId: q.id }}
                  className="btn-primary"
                  variant="primary"
                  title="Convert to tax invoice?"
                  body={<>This raises a GST tax invoice from <b>{q.number}</b> and locks the quotation from further edits. This can’t be undone.</>}
                  confirmLabel="Convert to invoice"
                >
                  Convert to invoice
                </ConfirmButton>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4 text-sm">
          <div className="text-faint text-xs uppercase mb-1">Customer</div>
          <div className="font-medium text-ink">{cust?.name ?? '—'}</div>
          {cust?.address && <div className="text-muted">{cust.address}</div>}
          {cust?.gstin && <div className="font-mono text-xs mt-1">GST: {cust.gstin}</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="flex justify-between py-0.5"><span className="text-muted">Date</span><span>{formatDate(q.docDate)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Validity</span><span>{q.validityDays} days</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Tax</span><span>{q.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}</span></div>
        </div>
      </div>

      <div className="card overflow-x-auto mb-4">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase [&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
              <th>#</th><th>Description</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2">
                <td>{i + 1}</td>
                <td className="text-ink">
                  {it.description}
                  {it.isToolingCharge && <span className="pill bg-accent-soft text-accent ml-2 text-[0.65rem]">tooling / NRE</span>}
                </td>
                <td className="font-mono text-xs">{it.hsn ?? '—'}</td>
                <td className="text-right tabular-nums">{Number(it.qty)}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(it.rate)}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(it.taxableValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {q.terms ? (
          <div className="card p-4 text-sm flex-1">
            <div className="text-faint text-xs uppercase mb-1.5">Terms</div>
            <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{q.terms}</div>
            {q.notes && (
              <>
                <div className="text-faint text-xs uppercase mt-3 mb-1.5">Notes</div>
                <div className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{q.notes}</div>
              </>
            )}
          </div>
        ) : <div className="flex-1" />}
        <div className="card p-4 w-full md:w-80 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(q.subtotal)}</span></div>
          {q.isInterstate ? (
            <div className="flex justify-between py-1"><span className="text-muted">IGST</span><span className="tabular-nums font-mono">{formatINR(q.igst)}</span></div>
          ) : (
            <>
              <div className="flex justify-between py-1"><span className="text-muted">CGST</span><span className="tabular-nums font-mono">{formatINR(q.cgst)}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted">SGST</span><span className="tabular-nums font-mono">{formatINR(q.sgst)}</span></div>
            </>
          )}
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>G. Total</span><span className="tabular-nums font-mono">{formatINR(q.grandTotal)}</span></div>
        </div>
      </div>

      <div className="mt-4"><Link href="/quotations" className="text-steel text-sm hover:underline">← All quotations</Link></div>
    </div>
  );
}
