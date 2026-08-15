import Link from 'next/link';
import { formatINR, QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listQuotations } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ExportLink } from '@/components/export-link';
import { StatusPill } from '@/components/status-pill';

export const metadata = { title: 'Quotations' };

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string }>;
}) {
  const { q, status, page, sort } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize } = await listQuotations({ q, status, page: Number(page), sort });
  const params = { q, status, sort };
  const exportQs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString();
  const exportHref = `/export/quotations${exportQs ? `?${exportQs}` : ''}`;

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
        <div className="flex items-center gap-2">
          <ExportLink href={exportHref} />
          {can(user, 'quotation.create') && <Link href="/quotations/new" className="btn-primary">+ New quotation</Link>}
        </div>
      </div>

      <FilterBar
        basePath="/quotations"
        q={q}
        placeholder="Search number or customer…"
        chipParam="status"
        chipValue={status}
        chips={QUOTATION_STATUSES.map((s) => ({ value: s, label: QUOTATION_STATUS_LABELS[s as QuotationStatus] }))}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/quotations" params={params} col="number" label="Number" /></th>
              <th><SortLink basePath="/quotations" params={params} col="date" label="Date" /></th>
              <th><SortLink basePath="/quotations" params={params} col="customer" label="Customer" /></th>
              <th className="text-right"><SortLink basePath="/quotations" params={params} col="total" label="Total" align="right" /></th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs whitespace-nowrap"><Link href={`/quotations/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td className="whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td><StatusPill status={r.status} label={QUOTATION_STATUS_LABELS[r.status as QuotationStatus] ?? r.status} /></td>
                <td className="text-right"><a href={`/print/quotation/${r.id}?print=1`} target="_blank" rel="noreferrer" className="text-steel text-xs hover:underline">PDF ↗</a></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {q || status ? <>Nothing matches this filter. <Link href="/quotations" className="text-steel hover:underline">Clear →</Link></>
                    : <>No quotations yet. <Link href="/quotations/new" className="text-steel hover:underline">Create one →</Link></>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination basePath="/quotations" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
