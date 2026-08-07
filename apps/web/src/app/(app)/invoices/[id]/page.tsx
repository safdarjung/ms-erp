import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR, amountInWords, paymentStatus, PAYMENT_STATE_LABELS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@ms/core';
import { getInvoice } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { InvoiceStatusSelect } from '../status-select';
import { PaymentsPanel } from '../payments-panel';

export const metadata = { title: 'Invoice' };

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getInvoice(id);
  if (!data?.invoice) notFound();
  const { invoice: inv, items, customer: cust, payments, received } = data;
  const grand = Number(inv.grandTotal);
  const ps = paymentStatus({ status: inv.status, grandTotal: grand, received, dueDate: inv.dueDate });
  const canEdit = can(user, 'invoice.edit');

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Finance</p>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{inv.number}</h1>
          {canEdit && inv.status !== 'paid'
            ? <InvoiceStatusSelect id={inv.id} status={inv.status} />
            : <StatusPill status={inv.status} label={INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status} />}
          {inv.status !== 'cancelled' && <StatusPill status={ps.state} label={PAYMENT_STATE_LABELS[ps.state]} />}
        </div>
        <div className="flex gap-2">
          <a href={`/print/invoice/${inv.id}`} target="_blank" rel="noreferrer" className="btn-ghost">Preview</a>
          <a href={`/print/invoice/${inv.id}?print=1`} target="_blank" rel="noreferrer" className="btn-primary">Print / Save PDF</a>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4 text-sm">
          <div className="text-faint text-xs uppercase mb-1">Bill to</div>
          <div className="font-medium text-ink">{cust?.name ?? '—'}</div>
          {cust?.address && <div className="text-muted">{cust.address}</div>}
          {cust?.gstin && <div className="font-mono text-xs mt-1">GST: {cust.gstin}</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="flex justify-between py-0.5"><span className="text-muted">Date</span><span>{formatDate(inv.docDate)}</span></div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted">Due date</span>
            <span className={ps.state === 'overdue' ? 'text-crit font-medium' : ''}>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</span>
          </div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Place of supply</span><span>{inv.placeOfSupply ?? '—'}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Tax</span><span>{inv.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}</span></div>
          {inv.poRef && <div className="flex justify-between py-0.5"><span className="text-muted">PO ref</span><span>{inv.poRef}</span></div>}
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
                <td className="text-ink">{it.description}</td>
                <td className="font-mono text-xs">{it.hsn ?? '—'}</td>
                <td className="text-right tabular-nums">{Number(it.qty)}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(it.rate)}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(it.taxableValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <PaymentsPanel invoiceId={inv.id} outstanding={ps.outstanding} payments={payments} canEdit={canEdit && inv.status !== 'cancelled'} />

        <div className="card p-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(inv.subtotal)}</span></div>
          {inv.isInterstate ? (
            <div className="flex justify-between py-1"><span className="text-muted">IGST</span><span className="tabular-nums font-mono">{formatINR(inv.igst)}</span></div>
          ) : (
            <>
              <div className="flex justify-between py-1"><span className="text-muted">CGST</span><span className="tabular-nums font-mono">{formatINR(inv.cgst)}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted">SGST</span><span className="tabular-nums font-mono">{formatINR(inv.sgst)}</span></div>
            </>
          )}
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Grand total</span><span className="tabular-nums font-mono">{formatINR(inv.grandTotal)}</span></div>
          <div className="flex justify-between py-1 text-ok"><span>Received</span><span className="tabular-nums font-mono">{formatINR(received)}</span></div>
          <div className={`flex justify-between py-2 border-t border-line font-semibold ${ps.outstanding > 0.5 ? (ps.state === 'overdue' ? 'text-crit' : 'text-ink') : 'text-ok'}`}>
            <span>Outstanding</span><span className="tabular-nums font-mono">{formatINR(ps.outstanding)}</span>
          </div>
          <div className="text-xs text-faint mt-2 italic">{amountInWords(grand)}</div>
        </div>
      </div>

      <div className="mt-4"><Link href="/invoices" className="text-steel text-sm hover:underline">← All invoices</Link></div>
    </div>
  );
}
