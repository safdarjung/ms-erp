import Link from 'next/link';
import { formatINR, QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listQuotations } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';

export const metadata = { title: 'Quotations' };

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-surface-2 text-muted',
  sent: 'bg-[#e7eef5] text-steel',
  approved: 'bg-[#e4f1ea] text-ok',
  rejected: 'bg-[#f6e6e2] text-crit',
  converted: 'bg-[#e4f1ea] text-ok',
};

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const user = await requireUser();
  const rows = await listQuotations(q, status);

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
        {can(user, 'quotation.create') && <Link href="/quotations/new" className="btn-primary">+ New quotation</Link>}
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
              <th>Number</th><th>Date</th><th>Customer</th><th className="text-right">Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs"><Link href={`/quotations/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td>{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td><span className={`pill capitalize ${STATUS_PILL[r.status] ?? 'bg-surface-2 text-muted'}`}>{r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  {q || status ? <>Nothing matches this filter. <Link href="/quotations" className="text-steel hover:underline">Clear →</Link></>
                    : <>No quotations yet. <Link href="/quotations/new" className="text-steel hover:underline">Create one →</Link></>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
