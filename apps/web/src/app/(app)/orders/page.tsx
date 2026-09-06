import Link from 'next/link';
import { formatINR, ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, type OrderStatus, type OrderCategory } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listOrders } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { StatusPill } from '@/components/status-pill';
import { MobileList, DesktopTable, ListCard, EmptyState } from '@/components/list-cards';

export const metadata = { title: 'Orders' };

function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}
function categoryLabel(category: string): string {
  return ORDER_CATEGORY_LABELS[category as OrderCategory] ?? category;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string }>;
}) {
  const { q, status, page, sort } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize } = await listOrders({ q, status, page: Number(page), sort });
  const params = { q, status, sort };
  const canCreate = can(user, 'order.create');
  const filtered = Boolean(q || status);

  const newButton = canCreate && <Link href="/orders/new" className="btn-primary w-full sm:w-auto">+ New order</Link>;
  const empty = (colSpan?: number) => (
    <EmptyState
      colSpan={colSpan}
      message={filtered
        ? <>Nothing matches this filter. <Link href="/orders" className="text-steel hover:underline">Clear →</Link></>
        : <>No orders yet. Open an approved <Link href="/quotations?status=approved" className="text-steel hover:underline">quotation</Link> and tap <b>Make order</b>{canCreate ? ', or' : '.'}</>}
      action={!filtered && newButton}
    />
  );
  const billMade = <StatusPill status="billed" label="Bill made" />;

  return (
    <div className="max-w-6xl">
      <p className="text-xs text-muted">{NAV_GROUPS.sales}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <div className="flex flex-wrap items-center gap-2">{newButton}</div>
      </div>

      <FilterBar
        basePath="/orders"
        q={q}
        placeholder="Search number, customer or PO…"
        chipParam="status"
        chipValue={status}
        chips={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
      />

      <MobileList>
        {rows.map((r) => (
          <ListCard
            key={r.id}
            title={<span className="font-mono text-xs">{r.number}</span>}
            href={`/orders/${r.id}`}
            pill={<span className="inline-flex flex-wrap justify-end gap-1">
              <StatusPill status={r.status} label={statusLabel(r.status)} />
              {r.convertedInvoiceId && billMade}
            </span>}
            line2={r.customerName ?? '—'}
            line3={<>{formatDate(r.docDate)} · {categoryLabel(r.orderCategory)}{r.deliveryDate ? ` · Deliver by ${formatDate(r.deliveryDate)}` : ''}</>}
            amount={formatINR(r.totalValue)}
            actions={<Link href={`/orders/${r.id}`} className="btn-ghost text-sm">Open</Link>}
          />
        ))}
        {rows.length === 0 && empty()}
      </MobileList>

      <DesktopTable>
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/orders" params={params} col="number" label="Number" /></th>
              <th><SortLink basePath="/orders" params={params} col="date" label="Date" /></th>
              <th><SortLink basePath="/orders" params={params} col="customer" label="Customer" /></th>
              <th>Type of work</th>
              <th><SortLink basePath="/orders" params={params} col="delivery" label="Deliver by" /></th>
              <th className="text-right"><SortLink basePath="/orders" params={params} col="value" label="Value" align="right" /></th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs whitespace-nowrap">
                  <Link href={`/orders/${r.id}`} className="text-steel hover:underline">{r.number}</Link>
                </td>
                <td className="whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-muted text-xs">{categoryLabel(r.orderCategory)}</td>
                <td className="whitespace-nowrap text-muted">{r.deliveryDate ? formatDate(r.deliveryDate) : '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.totalValue)}</td>
                <td>
                  <span className="inline-flex flex-wrap gap-1">
                    <StatusPill status={r.status} label={statusLabel(r.status)} />
                    {r.convertedInvoiceId && billMade}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && empty(7)}
          </tbody>
        </table>
      </DesktopTable>
      <Pagination basePath="/orders" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
