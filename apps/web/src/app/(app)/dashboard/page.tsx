import Link from 'next/link';
import type { ReactNode } from 'react';
import { aiEnabled } from '@ms/ai';
import { formatINR, formatINRShort, LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { requireUser } from '@/lib/rbac';
import { dashboardData } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { AskCard } from './ask-card';

export const metadata = { title: 'Dashboard' };

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev <= 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (!Number.isFinite(pct) || pct === 0) return null;
  return (
    <span className={`text-xs font-medium ${pct > 0 ? 'text-ok' : 'text-crit'}`}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% vs last month
    </span>
  );
}

function RecentDocs({
  title, href, rows, empty,
}: {
  title: string; href: string; empty: string;
  rows: { id: string; number: string; docDate: Date; status: string; grandTotal: string; customerName: string | null }[];
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <span className="font-medium text-sm">{title}</span>
        <Link href={href} className="text-xs text-steel hover:underline">View all →</Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted">{empty}</div>
      ) : (
        <table className="w-full text-sm min-w-[640px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`${href}/${r.id}`} className="text-steel hover:underline">{r.number}</Link>
                </td>
                <td className="px-2 py-2 text-ink truncate max-w-[10rem]">{r.customerName ?? '—'}</td>
                <td className="px-2 py-2 text-muted text-xs whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-mono whitespace-nowrap">{formatINR(r.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await dashboardData();
  const firstName = user.name.split(' ')[0];
  const pipelineOpen = d.pipeline.filter((p) => !['won', 'lost'].includes(p.stage));
  const pipelineValue = pipelineOpen.reduce((s, p) => s + p.value, 0);
  const maxStage = Math.max(...pipelineOpen.map((p) => p.n), 1);

  const tiles: { k: string; v: string; extra?: ReactNode; href?: string }[] = [
    { k: formatINRShort(d.invoicedThisMonth), v: 'Invoiced this month', extra: <Delta now={d.invoicedThisMonth} prev={d.invoicedLastMonth} />, href: '/invoices' },
    { k: formatINRShort(d.receivables), v: 'Receivables', extra: d.overdue > 0.5 ? <span className="text-xs font-medium text-crit">{formatINRShort(d.overdue)} overdue</span> : <span className="text-xs text-faint">on time</span>, href: '/invoices' },
    { k: formatINRShort(d.ordersOpen.value), v: `${d.ordersOpen.n} open orders`, href: '/orders' },
    { k: formatINRShort(d.quotesOpen.value), v: `${d.quotesOpen.n} open quotations`, href: '/quotations' },
    { k: formatINRShort(pipelineValue), v: `Pipeline · ${d.leadsOpen} leads`, href: '/leads' },
  ];

  return (
    <div className="max-w-6xl">
      <p className="eyebrow">Dashboard</p>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}, {firstName} 👋</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/quotations/new" className="btn-primary text-xs">+ Quotation</Link>
          <Link href="/orders/new" className="btn-ghost text-xs">+ Order</Link>
          <Link href="/invoices/new" className="btn-ghost text-xs">+ Invoice</Link>
          <Link href="/leads" className="btn-ghost text-xs">+ Lead</Link>
        </div>
      </div>

      {(d.overdue > 0.5 || d.followupsDue > 0) && (
        <div className="flex flex-wrap gap-3 mb-6">
          {d.overdue > 0.5 && (
            <Link href="/invoices" className="flex items-center gap-2 rounded-lg border border-crit/30 bg-[#f6e6e2]/60 px-3.5 py-2 text-sm text-crit hover:bg-[#f6e6e2] transition-colors">
              <span aria-hidden>⚠</span> <b>{formatINR(d.overdue)}</b> overdue receivables <span aria-hidden>→</span>
            </Link>
          )}
          {d.followupsDue > 0 && (
            <Link href="/leads" className="flex items-center gap-2 rounded-lg border border-warn/30 bg-[#f6efd9]/70 px-3.5 py-2 text-sm text-warn hover:bg-[#f6efd9] transition-colors">
              <span aria-hidden>◷</span> <b>{d.followupsDue}</b> follow-up{d.followupsDue > 1 ? 's' : ''} due <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line rounded-lg overflow-hidden mb-6">
        {tiles.map((t) => {
          const inner = (
            <>
              <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
              <div className="text-sm text-muted mt-1">{t.v}</div>
              {t.extra && <div className="mt-1">{t.extra}</div>}
            </>
          );
          return t.href
            ? <Link key={t.v} href={t.href} className="bg-surface p-5 hover:bg-surface-2/60 transition-colors">{inner}</Link>
            : <div key={t.v} className="bg-surface p-5">{inner}</div>;
        })}
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 flex flex-col gap-5">
          <RecentDocs title="Recent quotations" href="/quotations" rows={d.recentQuotations}
            empty="No quotations yet — draft your first one (AI can help)." />
          <RecentDocs title="Recent invoices" href="/invoices" rows={d.recentInvoices}
            empty="No invoices yet." />
        </div>

        <div className="flex flex-col gap-5">
          <AskCard enabled={aiEnabled()} />

          <div className="card p-5">
            <div className="font-medium text-sm mb-3">Lead pipeline</div>
            {pipelineOpen.length === 0 ? (
              <p className="text-xs text-muted">No open leads. <Link href="/leads" className="text-steel hover:underline">Add one →</Link></p>
            ) : (
              <div className="space-y-2">
                {LEAD_STAGES.filter((s) => !['won', 'lost'].includes(s)).map((stage) => {
                  const p = pipelineOpen.find((x) => x.stage === stage);
                  if (!p) return null;
                  return (
                    <div key={stage} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-xs">
                      <span className="text-muted">{LEAD_STAGE_LABELS[stage]}</span>
                      <div className="h-3.5 bg-surface-2 rounded-sm overflow-hidden">
                        <div className="h-full bg-steel/70 rounded-sm" style={{ width: `${(p.n / maxStage) * 100}%` }} />
                      </div>
                      <span className="tabular-nums font-mono text-ink">{p.n} · {formatINRShort(p.value)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
