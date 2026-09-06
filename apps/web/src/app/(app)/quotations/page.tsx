import Link from 'next/link';
import { formatINR, QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listQuotations } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ExportLink } from '@/components/export-link';
import { StatusPill } from '@/components/status-pill';
import { MobileList, DesktopTable, ListCard, EmptyState } from '@/components/list-cards';
import { AskAiLink } from '@/components/app-shell';

export const metadata = { title: 'Quotations' };

const AI_EXAMPLE = 'Sharma Auto ke liye quotation banao';

function statusLabel(status: string): string {
  return QUOTATION_STATUS_LABELS[status as QuotationStatus] ?? status;
}

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
  const canCreate = can(user, 'quotation.create');
  const filtered = Boolean(q || status);

  const newButton = canCreate && <Link href="/quotations/new" className="btn-primary w-full sm:w-auto">+ New quotation</Link>;
  const empty = (colSpan?: number) => (
    <EmptyState
      colSpan={colSpan}
      message={filtered ? <>Nothing matches this filter. <Link href="/quotations" className="text-steel hover:underline">Clear →</Link></> : 'No quotations yet.'}
      action={!filtered && newButton}
      hint={!filtered && <>or ask AI: <AskAiLink question={AI_EXAMPLE}>&ldquo;{AI_EXAMPLE}&rdquo;</AskAiLink></>}
    />
  );
  const pdfHref = (id: string) => `/print/quotation/${id}?print=1`;

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted">{NAV_GROUPS.sales}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
        <div className="flex flex-wrap items-center gap-2">
          {newButton}
          <ExportLink href={exportHref} />
        </div>
      </div>

      <FilterBar
        basePath="/quotations"
        q={q}
        placeholder="Search number or customer…"
        chipParam="status"
        chipValue={status}
        chips={QUOTATION_STATUSES.map((s) => ({ value: s, label: QUOTATION_STATUS_LABELS[s] }))}
      />

      <MobileList>
        {rows.map((r) => (
          <ListCard
            key={r.id}
            title={<span className="font-mono text-xs">{r.number}</span>}
            href={`/quotations/${r.id}`}
            pill={<StatusPill status={r.status} label={statusLabel(r.status)} />}
            line2={r.customerName ?? '—'}
            line3={formatDate(r.docDate)}
            amount={formatINR(r.grandTotal)}
            actions={<>
              <Link href={`/quotations/${r.id}`} className="btn-ghost text-sm">Open</Link>
              <a href={pdfHref(r.id)} target="_blank" rel="noreferrer" className="btn-ghost text-sm">Download PDF</a>
            </>}
          />
        ))}
        {rows.length === 0 && empty()}
      </MobileList>

      <DesktopTable>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/quotations" params={params} col="number" label="Number" /></th>
              <th><SortLink basePath="/quotations" params={params} col="date" label="Date" /></th>
              <th><SortLink basePath="/quotations" params={params} col="customer" label="Customer" /></th>
              <th className="text-right"><SortLink basePath="/quotations" params={params} col="total" label="Total" align="right" /></th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs whitespace-nowrap"><Link href={`/quotations/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td className="whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td><StatusPill status={r.status} label={statusLabel(r.status)} /></td>
                <td className="text-right whitespace-nowrap">
                  <a href={pdfHref(r.id)} target="_blank" rel="noreferrer" className="text-steel text-xs hover:underline">Download PDF ↗</a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && empty(6)}
          </tbody>
        </table>
      </DesktopTable>
      <Pagination basePath="/quotations" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
