import Link from 'next/link';
import { formatINR, ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, type OrderStatus, type OrderCategory } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listOrders } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { StatusPill } from '@/components/status-pill';

export const metadata = { title: 'Orders' };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string }>;
}) {
  const { q, status, page, sort } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize } = await listOrders({ q, status, page: Number(page), sort });
  const params = { q, status, sort };

  return (
    <div className="max-w-6xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Order book</h1>
        {can(user, 'order.create') && <Link href="/orders/new" className="btn-primary">+ New order</Link>}
      </div>

      <FilterBar
        basePath="/orders"
        q={q}
        placeholder="Search number, customer or PO…"
        chipParam="status"
        chipValue={status}
        chips={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s as OrderStatus] }))}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/orders" params={params} col="number" label="Number" /></th>
              <th><SortLink basePath="/orders" params={params} col="date" label="Date" /></th>
              <th><SortLink basePath="/orders" params={params} col="customer" label="Customer" /></th>
              <th>Category</th>
              <th><SortLink basePath="/orders" params={params} col="delivery" label="Delivery" /></th>
              <th className="text-right"><SortLink basePath="/orders" params={params} col="value" label="Value" align="right" /></th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs whitespace-nowrap">
                  <Link href={`/orders/${r.id}`} className="text-steel hover:underline">{r.number}</Link>
                  {r.convertedInvoiceId && <span className="ml-2 text-[0.62rem] text-ok">✓ invoiced</span>}
                </td>
                <td className="whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-muted text-xs">{ORDER_CATEGORY_LABELS[r.orderCategory as OrderCategory] ?? r.orderCategory}</td>
                <td className="whitespace-nowrap text-muted">{r.deliveryDate ? formatDate(r.deliveryDate) : '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.totalValue)}</td>
                <td><StatusPill status={r.status} label={ORDER_STATUS_LABELS[r.status as OrderStatus] ?? r.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {q || status ? <>Nothing matches this filter. <Link href="/orders" className="text-steel hover:underline">Clear →</Link></>
                    : <>No orders yet. Convert an approved quotation, or <Link href="/orders/new" className="text-steel hover:underline">create one →</Link></>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination basePath="/orders" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
