import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import {
  formatINR, formatINRShort, paymentStatus, stateLabel, PAYMENT_STATE_LABELS,
  QUOTATION_STATUS_LABELS, ORDER_STATUS_LABELS, type QuotationStatus, type OrderStatus,
} from '@ms/core';
import { getCustomer } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { ConfirmButton } from '@/components/confirm-button';
import {
  CustomerEditForm, CustomerStatusButton, EditCustomerButton, CustomerFlash, EDIT_SECTION_ID,
} from '../customer-edit-form';
import { deleteCustomerAction } from '../actions';

export const metadata = { title: 'Customer' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function CustomerDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; from?: string; added?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, { edit, from, added }] = await Promise.all([params, searchParams]);
  const data = await getCustomer(id);
  if (!data?.customer) notFound();
  const { customer: c, quotes, orders, invoices } = data;

  const inv = invoices.map((i) => {
    const ps = paymentStatus({ status: i.status, grandTotal: Number(i.grandTotal), received: Number(i.received), dueDate: i.dueDate });
    return { ...i, ...ps };
  });
  const liveBills = inv.filter((i) => i.status !== 'cancelled');
  const totalBilled = liveBills.reduce((s, i) => s + Number(i.grandTotal), 0);
  const outstanding = inv.reduce((s, i) => s + i.outstanding, 0);
  const overdue = inv.filter((i) => i.state === 'overdue').reduce((s, i) => s + i.outstanding, 0);

  const tiles = [
    { k: formatINRShort(totalBilled), v: `Total billed (${plural(liveBills.length, 'bill', 'bills')})` },
    { k: formatINRShort(outstanding), v: 'Still to receive (baaki)', tone: outstanding > 0.5 ? 'text-ink' : 'text-ok' },
    { k: formatINRShort(overdue), v: 'Overdue', tone: overdue > 0.5 ? 'text-crit' : 'text-muted' },
  ];

  const linkedParts = [
    inv.length > 0 && plural(inv.length, 'bill', 'bills'),
    orders.length > 0 && plural(orders.length, 'order', 'orders'),
    quotes.length > 0 && plural(quotes.length, 'quotation', 'quotations'),
  ].filter((p): p is string => Boolean(p));
  const canDeleteNow = linkedParts.length === 0;
  const linkedText = linkedParts.length > 1
    ? `${linkedParts.slice(0, -1).join(', ')} and ${linkedParts[linkedParts.length - 1]}`
    : linkedParts[0];

  const canEdit = can(user, 'customer.edit');

  return (
    <div className="max-w-5xl">
      {added === '1' && <CustomerFlash message="Customer added" param="added" />}
      <p className="text-xs text-muted mb-1">Enquiries &amp; customers</p>
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <StatusPill
            status={c.gstin ? 'registered' : 'unregistered'}
            label={c.gstin ? `GST ${c.gstin}` : 'No GST'}
            className={c.gstin ? 'font-mono' : ''}
          />
          {c.status === 'archived' && <StatusPill status="archived" label="Hidden from lists" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, 'quotation.create') && <Link href={`/quotations/new?customer=${c.id}`} className="btn-ghost text-xs">+ Quotation</Link>}
          {can(user, 'order.create') && <Link href={`/orders/new?customer=${c.id}`} className="btn-ghost text-xs">+ Order</Link>}
          {can(user, 'invoice.create') && <Link href={`/invoices/new?customer=${c.id}`} className="btn-primary text-xs">+ Bill</Link>}
          {canEdit && <EditCustomerButton />}
          {canEdit && <CustomerStatusButton id={c.id} status={c.status} name={c.name} />}
        </div>
      </div>

      {from === 'lead' && (
        <div className="card px-4 py-3 mb-5 flex items-center justify-between gap-3 flex-wrap border-accent/40 bg-accent-soft/40">
          <span className="text-sm text-ink">Customer added from enquiry ✓</span>
          {can(user, 'quotation.create') && (
            <Link href={`/quotations/new?customer=${c.id}`} className="btn-primary text-xs">Make a quotation →</Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line border border-line rounded-lg overflow-hidden mb-5">
        {tiles.map((t) => (
          <div key={t.v} className="bg-surface p-4">
            <div className={`font-mono text-xl font-semibold tabular-nums ${t.tone ?? ''}`}>{t.k}</div>
            <div className="text-xs text-muted mt-0.5">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="flex flex-col gap-5">
          <div className="card p-4 text-sm space-y-1.5">
            <div className="text-xs text-muted mb-1">Details</div>
            <Row label="Contact person" value={c.contactPerson || '—'} />
            <Row label="Phone" value={c.phone ? <a href={`tel:${c.phone}`} className="text-steel hover:underline">{c.phone}</a> : '—'} />
            <Row label="Email" value={c.email ? <a href={`mailto:${c.email}`} className="text-steel hover:underline break-all">{c.email}</a> : '—'} />
            <Row label="GSTIN" value={c.gstin ? <span className="font-mono text-xs">{c.gstin}</span> : 'No GST'} />
            <Row label="State (for GST)" value={stateLabel(c.stateCode) || '—'} />
            <Row label="Payment due in" value={c.creditTermsDays > 0 ? `${c.creditTermsDays} days` : 'On delivery'} />
            {c.address && <div className="pt-1"><div className="text-muted mb-0.5">Address</div><div className="text-ink">{c.address}</div></div>}
          </div>
        </div>

        <div className="md:col-span-2 flex flex-col gap-5">
          <LedgerTable title="Bills" href="/invoices" empty="No bills yet."
            rows={inv.map((i) => ({
              id: i.id, number: i.number, date: i.docDate,
              amount: formatINR(i.grandTotal),
              extra: i.status === 'cancelled' ? '' : i.outstanding > 0.5 ? `${formatINR(i.outstanding)} still due` : 'Paid',
              pill: <StatusPill status={i.state} label={PAYMENT_STATE_LABELS[i.state]} />,
            }))} />
          <LedgerTable title="Orders" href="/orders" empty="No orders yet."
            rows={orders.map((o) => ({
              id: o.id, number: o.number, date: o.docDate, amount: formatINR(o.totalValue),
              extra: o.convertedInvoiceId ? 'Bill made' : '',
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

      {canEdit && (
        <details id={EDIT_SECTION_ID} className="reveal card mt-5" open={edit === '1'}>
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-11">
            <span className="chev" aria-hidden>›</span> Edit customer
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4">
            <CustomerEditForm customer={{
              id: c.id, name: c.name, regType: c.regType, gstin: c.gstin ?? '', stateCode: c.stateCode ?? '',
              contactPerson: c.contactPerson ?? '', phone: c.phone ?? '', email: c.email ?? '',
              address: c.address ?? '', creditTermsDays: c.creditTermsDays,
            }} />
            {can(user, 'customer.delete') && (
              <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3 flex-wrap">
                {canDeleteNow ? (
                  <>
                    <span className="text-xs text-muted">No bills or quotations yet, so this customer can be deleted.</span>
                    <ConfirmButton
                      action={deleteCustomerAction}
                      fields={{ id: c.id, redirectTo: '/customers' }}
                      variant="danger"
                      title={`Delete ${c.name}?`}
                      body="This removes them for good. Their name, phone and address will be gone."
                      confirmLabel="Yes, delete"
                    >
                      Delete customer
                    </ConfirmButton>
                  </>
                ) : (
                  <span className="text-xs text-muted">
                    Can&apos;t delete — {c.name} has {linkedText}. Use Hide (archive) instead.
                  </span>
                )}
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
  return <div className="flex items-start justify-between gap-3"><span className="text-muted shrink-0">{label}</span><span className="text-ink text-right min-w-0 [overflow-wrap:anywhere]">{value}</span></div>;
}

function LedgerTable({ title, href, rows, empty }: {
  title: string; href: string; empty: string;
  rows: { id: string; number: string; date: Date; amount: string; extra: string; pill: ReactNode }[];
}) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-line font-medium text-sm">{title} <span className="text-muted font-normal">· {rows.length}</span></div>
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
                <td className="px-2 py-2 text-xs text-muted whitespace-nowrap">{r.extra}</td>
                <td className="px-4 py-2 text-right">{r.pill}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
