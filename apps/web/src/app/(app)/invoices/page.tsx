import Link from 'next/link';
import { formatINR, paymentStatus, PAYMENT_STATES, PAYMENT_STATE_LABELS, type PaymentState } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listInvoices } from '@/lib/queries';
import { formatDate, dueLabel, type DueTone } from '@/lib/format';
import { NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ExportLink } from '@/components/export-link';
import { StatusPill } from '@/components/status-pill';
import { MobileList, DesktopTable, ListCard, EmptyState } from '@/components/list-cards';
import { AskAiLink } from '@/components/app-shell';

export const metadata = { title: 'Bills (GST invoices)' };

const AI_EXAMPLE = 'Bharat Pumps ka bill banao';
const NEEDS_PAYMENT: PaymentState[] = ['unpaid', 'partial', 'overdue'];
const TONE_CLS: Record<DueTone, string> = { crit: 'text-crit', warn: 'text-warn', muted: 'text-muted' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string }>;
}) {
  const { q, status, page, sort } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize, outstandingTotal } = await listInvoices({ q, status, page: Number(page), sort });
  const params = { q, status, sort };
  const exportHref = `/export/invoices${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const canCreate = can(user, 'invoice.create');
  const canRecordPayment = can(user, 'invoice.edit');
  const filtered = Boolean(q || status);

  const newButton = canCreate && <Link href="/invoices/new" className="btn-primary w-full sm:w-auto">+ New bill</Link>;
  const empty = (colSpan?: number) => (
    <EmptyState
      colSpan={colSpan}
      message={filtered ? <>Nothing matches this filter. <Link href="/invoices" className="text-steel hover:underline">Clear →</Link></> : 'No bills yet.'}
      action={!filtered && newButton}
      hint={!filtered && <>or ask AI: <AskAiLink question={AI_EXAMPLE}>&ldquo;{AI_EXAMPLE}&rdquo;</AskAiLink></>}
    />
  );
  const pdfHref = (id: string) => `/print/invoice/${id}?print=1`;
  const paymentHref = (id: string) => `/invoices/${id}#payment`;

  const derived = rows.map((r) => {
    const ps = paymentStatus({ status: r.status, grandTotal: Number(r.grandTotal), received: Number(r.received), dueDate: r.dueDate });
    const needsPayment = NEEDS_PAYMENT.includes(ps.state);
    const due = needsPayment ? dueLabel(r.dueDate) : null;
    return { ...r, ps, needsPayment, due };
  });

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted">{NAV_GROUPS.sales}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          {outstandingTotal > 0.5 && (
            <p className="text-sm text-muted mt-0.5">
              <b className="text-ink tabular-nums">{formatINR(outstandingTotal)}</b> still to be collected (baaki)
              {filtered ? ' in this list' : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {newButton}
          <ExportLink href={exportHref} />
        </div>
      </div>

      <FilterBar
        basePath="/invoices"
        q={q}
        placeholder="Search number or customer…"
        chipParam="status"
        chipValue={status}
        chips={PAYMENT_STATES.map((s) => ({ value: s, label: PAYMENT_STATE_LABELS[s] }))}
      />

      <MobileList>
        {derived.map((r) => (
          <ListCard
            key={r.id}
            title={<span className="font-mono text-xs">{r.number}</span>}
            href={`/invoices/${r.id}`}
            pill={<StatusPill status={r.ps.state} label={PAYMENT_STATE_LABELS[r.ps.state]} />}
            line2={r.customerName ?? '—'}
            line3={<>{formatDate(r.docDate)}{r.due ? <> · <span className={TONE_CLS[r.due.tone]}>{r.due.text}</span></> : null}</>}
            amount={r.ps.outstanding > 0.5 ? `${formatINR(r.ps.outstanding)} due` : formatINR(r.grandTotal)}
            actions={<>
              {r.needsPayment && canRecordPayment && <Link href={paymentHref(r.id)} className="btn-ghost text-sm">Payment received</Link>}
              <a href={pdfHref(r.id)} target="_blank" rel="noreferrer" className="btn-ghost text-sm">Download PDF</a>
            </>}
          />
        ))}
        {derived.length === 0 && empty()}
      </MobileList>

      <DesktopTable>
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/invoices" params={params} col="number" label="Number" /></th>
              <th><SortLink basePath="/invoices" params={params} col="date" label="Date" /></th>
              <th><SortLink basePath="/invoices" params={params} col="customer" label="Customer" /></th>
              <th className="text-right"><SortLink basePath="/invoices" params={params} col="total" label="Total" align="right" /></th>
              <th className="text-right">Still due</th>
              <th><SortLink basePath="/invoices" params={params} col="due" label="Payment" /></th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {derived.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs whitespace-nowrap">
                  <Link href={`/invoices/${r.id}`} className="text-steel hover:underline">{r.number}</Link>
                </td>
                <td className="whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td className="text-right tabular-nums font-mono">{r.ps.outstanding > 0.5 ? formatINR(r.ps.outstanding) : <span className="text-faint">—</span>}</td>
                <td className="whitespace-nowrap">
                  <StatusPill status={r.ps.state} label={PAYMENT_STATE_LABELS[r.ps.state]} />
                  {r.due && <div className={`text-xs mt-1 ${TONE_CLS[r.due.tone]}`}>{r.due.text}</div>}
                </td>
                <td className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-3">
                    {r.needsPayment && canRecordPayment && (
                      <Link href={paymentHref(r.id)} className="btn-ghost !py-1 text-xs">Payment received</Link>
                    )}
                    <a href={pdfHref(r.id)} target="_blank" rel="noreferrer" className="text-steel text-xs hover:underline">Download PDF ↗</a>
                  </div>
                </td>
              </tr>
            ))}
            {derived.length === 0 && empty(7)}
          </tbody>
        </table>
      </DesktopTable>
      <Pagination basePath="/invoices" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
