import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatINR, computeGst, isInterstate,
  ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, MATERIAL_OWNERSHIP_LABELS,
  type OrderStatus, type OrderCategory, type MaterialOwnership,
} from '@ms/core';
import { getOrder, getLetterhead } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { ConfirmButton } from '@/components/confirm-button';
import { OrderStatusSelect } from '../status-select';
import { convertOrderToInvoiceAction } from '../actions';

export const metadata = { title: 'Order' };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [data, lh] = await Promise.all([getOrder(id), getLetterhead()]);
  if (!data?.order) notFound();
  const { order: o, items, customer: cust } = data;
  const invoiced = !!o.convertedInvoiceId;

  const interstate = isInterstate(lh?.stateCode ?? '06', cust?.stateCode);
  const totals = computeGst(items.map((it) => ({ qty: it.qty, rate: it.rate, gstRate: it.gstRate })), interstate);

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{o.number}</h1>
          {invoiced || o.status === 'cancelled' || !can(user, 'order.edit')
            ? <StatusPill status={o.status} label={ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status} />
            : <OrderStatusSelect id={o.id} status={o.status} />}
        </div>
        <div className="flex gap-2">
          {invoiced ? (
            <Link href={`/invoices/${o.convertedInvoiceId}`} className="btn-primary">View invoice →</Link>
          ) : (
            can(user, 'invoice.create') && o.status !== 'cancelled' && (
              <ConfirmButton
                action={convertOrderToInvoiceAction}
                fields={{ orderId: o.id }}
                className="btn-primary"
                variant="primary"
                title="Raise tax invoice for this order?"
                body={<>This creates a GST tax invoice from order <b>{o.number}</b>. GST is computed from the customer’s state.</>}
                confirmLabel="Raise invoice"
              >
                Convert to invoice
              </ConfirmButton>
            )
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
          <div className="flex justify-between py-0.5"><span className="text-muted">Order date</span><span>{formatDate(o.docDate)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Delivery date</span><span>{o.deliveryDate ? formatDate(o.deliveryDate) : '—'}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Category</span><span>{ORDER_CATEGORY_LABELS[o.orderCategory as OrderCategory] ?? o.orderCategory}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Material</span><span>{MATERIAL_OWNERSHIP_LABELS[o.materialOwnership as MaterialOwnership] ?? o.materialOwnership}</span></div>
          {o.poRef && <div className="flex justify-between py-0.5"><span className="text-muted">PO ref</span><span>{o.poRef}</span></div>}
          {o.quotationId && <div className="flex justify-between py-0.5"><span className="text-muted">Source quote</span><Link href={`/quotations/${o.quotationId}`} className="text-steel hover:underline">View →</Link></div>}
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

      <div className="flex justify-end">
        <div className="card p-4 w-full md:w-80 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(totals.subtotal)}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted">GST {invoiced ? '' : '(est.)'}</span><span className="tabular-nums font-mono">{formatINR(totals.taxTotal)}</span></div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total {invoiced ? '' : '(est.)'}</span><span className="tabular-nums font-mono">{formatINR(totals.grand)}</span></div>
          {!invoiced && <div className="text-xs text-faint mt-1">GST is finalised when you raise the invoice.</div>}
        </div>
      </div>

      <div className="mt-4"><Link href="/orders" className="text-steel text-sm hover:underline">← Order book</Link></div>
    </div>
  );
}
