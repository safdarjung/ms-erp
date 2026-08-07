import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import {
  formatINR, formatINRShort, paymentStatus, PAYMENT_STATE_LABELS,
  QUOTATION_STATUS_LABELS, ORDER_STATUS_LABELS, type QuotationStatus, type OrderStatus,
} from '@ms/core';
import { getCustomer } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { ConfirmButton } from '@/components/confirm-button';
import { CustomerEditForm, CustomerStatusButton } from '../customer-edit-form';
import { deleteCustomerAction } from '../actions';

export const metadata = { title: 'Customer' };

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getCustomer(id);
  if (!data?.customer) notFound();
  const { customer: c, quotes, orders, invoices } = data;

  const inv = invoices.map((i) => {
    const ps = paymentStatus({ status: i.status, grandTotal: Number(i.grandTotal), received: Number(i.received), dueDate: i.dueDate });
    return { ...i, ...ps };
  });
  const totalInvoiced = inv.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + Number(i.grandTotal), 0);
  const outstanding = inv.reduce((s, i) => s + i.outstanding, 0);
  const overdue = inv.filter((i) => i.state === 'overdue').reduce((s, i) => s + i.outstanding, 0);

  const tiles = [
    { k: formatINRShort(totalInvoiced), v: `Invoiced · ${inv.length}` },
    { k: formatINRShort(outstanding), v: 'Outstanding', tone: outstanding > 0.5 ? 'text-ink' : 'text-ok' },
    { k: formatINRShort(overdue), v: 'Overdue', tone: overdue > 0.5 ? 'text-crit' : 'text-muted' },
  ];

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM · Customer</p>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <StatusPill status={c.regType} label={c.regType === 'registered' ? 'GST-registered' : 'Unregistered'} />
          {c.status === 'archived' && <StatusPill status="archived" label="Archived" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, 'quotation.create') && <Link href={`/quotations/new?customer=${c.id}`} className="btn-ghost text-xs">+ Quote</Link>}
          {can(user, 'order.create') && <Link href={`/orders/new?customer=${c.id}`} className="btn-ghost text-xs">+ Order</Link>}
          {can(user, 'invoice.create') && <Link href={`/invoices/new?customer=${c.id}`} className="btn-primary text-xs">+ Invoice</Link>}
          {can(user, 'customer.edit') && <CustomerStatusButton id={c.id} status={c.status} />}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-line border border-line rounded-lg overflow-hidden mb-5">
        {tiles.map((t) => (
          <div key={t.v} className="bg-surface p-4">
            <div className={`font-mono text-xl font-semibold tabular-nums ${t.tone ?? ''}`}>{t.k}</div>
            <div className="text-xs text-muted mt-0.5">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="flex flex-col gap-5">
          <div className="card p-4 text-sm space-y-1.5">
            <div className="text-faint text-xs uppercase mb-1">Details</div>
            <Row label="Contact" value={c.contactPerson || '—'} />
            <Row label="Phone" value={c.phone ? <a href={`tel:${c.phone}`} className="text-steel hover:underline">{c.phone}</a> : '—'} />
            <Row label="Email" value={c.email ? <a href={`mailto:${c.email}`} className="text-steel hover:underline break-all">{c.email}</a> : '—'} />
            <Row label="GSTIN" value={c.gstin ? <span className="font-mono text-xs">{c.gstin}</span> : '—'} />
            <Row label="State" value={c.stateCode || '—'} />
            <Row label="Credit terms" value={`${c.creditTermsDays} days`} />
            {c.address && <div className="pt-1"><div className="text-muted mb-0.5">Address</div><div className="text-ink">{c.address}</div></div>}
          </div>
        </div>

        <div className="md:col-span-2 flex flex-col gap-5">
          <LedgerTable title="Invoices" href="/invoices" empty="No invoices yet."
            rows={inv.map((i) => ({
              id: i.id, number: i.number, date: i.docDate,
              amount: formatINR(i.grandTotal),
              extra: i.outstanding > 0.5 ? `${formatINR(i.outstanding)} due` : 'settled',
              pill: <StatusPill status={i.state} label={PAYMENT_STATE_LABELS[i.state]} />,
            }))} />
          <LedgerTable title="Orders" href="/orders" empty="No orders yet."
            rows={orders.map((o) => ({
              id: o.id, number: o.number, date: o.docDate, amount: formatINR(o.totalValue),
              extra: o.convertedInvoiceId ? 'invoiced' : '',
              pill: <StatusPill status={o.status} label={ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status} />,
            }))} />
          <LedgerTable title="Quotations" href="/quotations" empty="No quotations yet."
            rows={quotes.map((qt) => ({
              id: qt.id, number: qt.number, date: qt.docDate, amount: formatINR(qt.grandTotal),
              extra: '',
              pill: <StatusPill status={qt.status} label={QUOTATION_STATUS_LABELS[qt.status as QuotationStatus] ?? qt.status} />,
            }))} />
        </div>
      </div>

      {can(user, 'customer.edit') && (
        <details className="reveal card mt-5">
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
            <span className="chev" aria-hidden>›</span> Edit customer
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4">
            <CustomerEditForm customer={{
              id: c.id, name: c.name, regType: c.regType, gstin: c.gstin ?? '', stateCode: c.stateCode ?? '',
              contactPerson: c.contactPerson ?? '', phone: c.phone ?? '', email: c.email ?? '',
              address: c.address ?? '', creditTermsDays: c.creditTermsDays,
            }} />
            {can(user, 'customer.delete') && (
              <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3">
                <span className="text-xs text-muted">Deleting is blocked if this customer has any documents. Archive instead to hide them.</span>
                <ConfirmButton
                  action={deleteCustomerAction}
                  fields={{ id: c.id }}
                  title="Delete this customer?"
                  body={<>This permanently removes <b>{c.name}</b>. Blocked if they have quotations, orders or invoices.</>}
                  confirmLabel="Delete customer"
                  toastOk="Customer deleted"
                >
                  Delete
                </ConfirmButton>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="mt-5"><Link href="/customers" className="text-steel text-sm hover:underline">← All customers</Link></div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-muted">{label}</span><span className="text-ink text-right">{value}</span></div>;
}

function LedgerTable({ title, href, rows, empty }: {
  title: string; href: string; empty: string;
  rows: { id: string; number: string; date: Date; amount: string; extra: string; pill: ReactNode }[];
}) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-line font-medium text-sm">{title} <span className="text-faint font-normal">· {rows.length}</span></div>
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted">{empty}</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                <td className="px-4 py-2 font-mono text-xs"><Link href={`${href}/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td className="px-2 py-2 text-muted text-xs whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-mono whitespace-nowrap">{r.amount}</td>
                <td className="px-2 py-2 text-xs text-faint whitespace-nowrap">{r.extra}</td>
                <td className="px-4 py-2 text-right">{r.pill}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
