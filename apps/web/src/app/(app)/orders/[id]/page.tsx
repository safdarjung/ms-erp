import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatINR, computeGst, isInterstate, stateLabel,
  ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, MATERIAL_OWNERSHIP_LABELS,
  type OrderStatus, type OrderCategory, type MaterialOwnership,
} from '@ms/core';
import { getOrder, getLetterhead } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { DocumentItemsTable } from '@/components/document-items-table';
import { ConfirmButton } from '@/components/confirm-button';
import { DocumentSavedStrip } from '@/components/document-saved-strip';
import { OrderStatusSelect } from '../status-select';
import { cancelOrderAction, convertOrderToInvoiceAction, duplicateOrderAction } from '../actions';

export const metadata = { title: 'Order' };

const stateName = (code: string | null | undefined) => stateLabel(code).replace(/^\d{2} — /, '') || 'Haryana';

export default async function OrderDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; locked?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [data, lh] = await Promise.all([getOrder(id), getLetterhead()]);
  if (!data?.order) notFound();
  const { order: o, items, customer: cust } = data;
  const invoiced = !!o.convertedInvoiceId;
  const cancelled = o.status === 'cancelled';
  const canEdit = can(user, 'order.edit');

  const supplierState = lh?.stateCode ?? '06';
  const sup = stateName(supplierState);
  const interstate = isInterstate(supplierState, cust?.stateCode);
  const totals = computeGst(items.map((it) => ({ qty: it.qty, rate: it.rate, gstRate: it.gstRate })), interstate);
  const gstRates = new Set(items.map((it) => Number(it.gstRate)));
  const oneRate = gstRates.size === 1 ? [...gstRates][0] : null;
  const justSaved = !!sp.created || !!sp.saved;
  const clearKeys = sp.created === '1' ? ['order:new'] : sp.saved ? [`order:${o.id}`] : [];
  const mono = 'tabular-nums font-mono';

  return (
    <div className="max-w-4xl">
      {sp.locked && (
        <div role="status" className="mb-4 rounded-lg border border-warn/40 bg-[#f6efdd]/60 px-4 py-3 text-sm text-ink">
          {sp.locked === 'bill' ? <>This order can’t be changed because a bill was already made from it. Change that bill instead.</> : sp.locked === 'cancelled' ? <>This order is cancelled, so it can’t be changed.</> : null}
        </div>
      )}
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{o.number}</h1>
          {invoiced || cancelled || !canEdit
            ? <StatusPill status={o.status} label={ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status} />
            : <OrderStatusSelect id={o.id} status={o.status} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {!invoiced && !cancelled && canEdit && <Link href={`/orders/${o.id}/edit`} className="btn-ghost">Edit</Link>}
          {can(user, 'order.create') && (
            <ConfirmButton
              action={duplicateOrderAction}
              fields={{ id: o.id }}
              className="btn-ghost"
              variant="primary"
              title="Copy this order?"
              body="A new order with the same items will be made — you can change it afterwards."
              confirmLabel="Yes, copy it"
              pendingLabel="Copying…"
            >
              Copy as new order
            </ConfirmButton>
          )}
          {invoiced ? (
            <Link href={`/invoices/${o.convertedInvoiceId}`} className="btn-primary">View bill →</Link>
          ) : (
            can(user, 'invoice.create') && !cancelled && (
              <ConfirmButton
                action={convertOrderToInvoiceAction}
                fields={{ orderId: o.id }}
                className="btn-primary"
                variant="primary"
                title="Make a bill from this order?"
                body={`A GST bill with these items will be made from order ${o.number}. After this the order can't be changed.`}
                confirmLabel="Yes, make the bill"
                pendingLabel="Making bill…"
              >
                Make bill
              </ConfirmButton>
            )
          )}
        </div>
      </div>

      <DocumentSavedStrip
        docLabel="Order" number={o.number} justSaved={justSaved} clearKeys={clearKeys}
        next={justSaved && !invoiced && !cancelled ? 'Next: mark it In production, and make the bill when the job is delivered.' : undefined}
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
          <div className="flex justify-between py-0.5"><span className="text-muted">Order date</span><span>{formatDate(o.docDate)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Delivery date</span><span>{o.deliveryDate ? formatDate(o.deliveryDate) : '—'}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Order type</span><span>{ORDER_CATEGORY_LABELS[o.orderCategory as OrderCategory] ?? o.orderCategory}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted">Material</span><span>{MATERIAL_OWNERSHIP_LABELS[o.materialOwnership as MaterialOwnership] ?? o.materialOwnership}</span></div>
          {o.poRef && <div className="flex justify-between py-0.5"><span className="text-muted">Customer PO no.</span><span>{o.poRef}</span></div>}
          {o.quotationId && <div className="flex justify-between py-0.5"><span className="text-muted">From quotation</span><Link href={`/quotations/${o.quotationId}`} className="text-steel hover:underline">View →</Link></div>}
        </div>
      </div>

      <DocumentItemsTable items={items} columns={o.columnDefs} />

      <div className="flex justify-end">
        <div className="card p-4 w-full md:w-80 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted">Subtotal (before GST)</span><span className={mono}>{formatINR(totals.subtotal)}</span></div>
          <div className="flex justify-between pt-1"><span className="text-muted">GST{oneRate !== null ? ` ${oneRate}%` : ''}</span><span className={mono}>{formatINR(totals.taxTotal)}</span></div>
          <div className="text-xs text-muted text-right pb-1">
            {interstate ? `IGST ${formatINR(totals.igst)}` : `CGST ${formatINR(totals.cgst)} + SGST ${formatINR(totals.sgst)}`}
          </div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total</span><span className={mono}>{formatINR(totals.grand)}</span></div>
          <div className="text-xs text-muted mt-1">
            {cust ? (interstate ? `Customer outside ${sup} → IGST` : `Customer in ${sup} → CGST + SGST`) : 'Choose a customer to see GST'}
            {!invoiced && ' · final GST is on the bill'}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <Link href="/orders" className="text-steel text-sm hover:underline">← Orders</Link>
        {canEdit && !invoiced && !cancelled && (
          <ConfirmButton
            action={cancelOrderAction}
            fields={{ id: o.id }}
            title="Cancel this order?"
            body="The order will be marked cancelled and can't be edited afterwards. This can't be undone."
            confirmLabel="Yes, cancel order"
            pendingLabel="Cancelling…"
            toastOk={`Order ${o.number} cancelled`}
          >
            Cancel this order
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
