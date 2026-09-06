import Link from 'next/link';
import type { ReactNode } from 'react';
import { aiEnabled } from '@ms/ai';
import {
  formatINR, formatINRShort, LEAD_STAGES, LEAD_STAGE_LABELS,
  QUOTATION_STATUS_LABELS, INVOICE_STATUS_LABELS, type QuotationStatus, type InvoiceStatus,
} from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { dashboardData, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink, buildPaymentReminderLink } from '@/lib/outreach';
import { formatDate, dueLabel, followupLabel } from '@/lib/format';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { WhatsappButton } from '@/components/whatsapp-button';
import { StatusPill } from '@/components/status-pill';
import { MobileList, DesktopTable, ListCard } from '@/components/list-cards';
import { DismissableTip } from '@/components/app-shell';
import { AskCard } from './ask-card';

export const metadata = { title: 'Home' };

const CLOSED_STAGES: string[] = ['won', 'lost'];

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
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

type DocRow = { id: string; number: string; docDate: Date; status: string; grandTotal: string; customerName: string | null };

function RecentDocs({
  title, href, rows, empty, statusLabel,
}: {
  title: string; href: string; rows: DocRow[]; empty: ReactNode;
  /** Label for a status pill, or null to show none (e.g. an ordinary issued bill). */
  statusLabel: (status: string) => string | null;
}) {
  const headingId = `recent-${href.replace(/\W/g, '')}`;
  const pill = (status: string) => {
    const label = statusLabel(status);
    return label ? <StatusPill status={status} label={label} /> : null;
  };
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-center justify-between mb-2">
        <h2 id={headingId} className="font-medium text-sm">{title}</h2>
        <Link href={href} className="text-xs text-steel hover:underline">See all →</Link>
      </div>
      {rows.length === 0 ? (
        <div className="card px-4 py-6 text-sm text-muted">{empty}</div>
      ) : (
        <>
          <MobileList>
            {rows.map((r) => (
              <ListCard
                key={r.id}
                title={<span className="font-mono text-xs">{r.number}</span>}
                href={`${href}/${r.id}`}
                pill={pill(r.status)}
                line2={r.customerName ?? '—'}
                line3={formatDate(r.docDate)}
                amount={formatINR(r.grandTotal)}
              />
            ))}
          </MobileList>
          <DesktopTable>
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                  <th>Number</th><th>Customer</th><th>Date</th><th>Status</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2">
                    <td className="font-mono text-xs whitespace-nowrap">
                      <Link href={`${href}/${r.id}`} className="text-steel hover:underline">{r.number}</Link>
                    </td>
                    <td className="text-ink truncate max-w-[12rem]">{r.customerName ?? '—'}</td>
                    <td className="text-muted text-xs whitespace-nowrap">{formatDate(r.docDate)}</td>
                    <td>{pill(r.status)}</td>
                    <td className="text-right tabular-nums font-mono whitespace-nowrap">{formatINR(r.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTable>
        </>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [d, outreach] = await Promise.all([dashboardData(), getOutreachSettings()]);
  const firstName = user.name.split(' ')[0];
  const pipelineOpen = d.pipeline.filter((p) => !CLOSED_STAGES.includes(p.stage));
  const pipelineValue = pipelineOpen.reduce((s, p) => s + p.value, 0);
  const maxStage = Math.max(...pipelineOpen.map((p) => p.n), 1);

  // Today: at most three plain lines, each with one thing to do.
  const today: { text: ReactNode; href: string; cta: string }[] = [];
  if (d.overdue > 0.5) {
    today.push({
      text: <><b className="text-ink">{formatINRShort(d.overdue)}</b> to collect from {plural(d.overdueCustomers, 'customer', 'customers')}</>,
      href: '/invoices?status=overdue', cta: 'See who',
    });
  }
  if (d.followupsDue > 0) {
    today.push({ text: <><b className="text-ink">{plural(d.followupsDue, 'follow-up', 'follow-ups')}</b> due today</>, href: '/leads?due=today', cta: 'Call list' });
  }
  if (d.quotesAwaiting.n > 0) {
    today.push({ text: <><b className="text-ink">{plural(d.quotesAwaiting.n, 'quotation', 'quotations')}</b> waiting for a reply</>, href: '/quotations?status=sent', cta: 'Chase' });
  }

  const tiles: { k: string; v: string; extra?: ReactNode; href: string }[] = [
    { k: formatINRShort(d.invoicedThisMonth), v: 'Billed this month', extra: <Delta now={d.invoicedThisMonth} prev={d.invoicedLastMonth} />, href: '/invoices' },
    {
      k: formatINRShort(d.receivables), v: 'Money to collect (baaki)',
      extra: d.overdue > 0.5
        ? <span className="text-xs font-medium text-crit">{formatINRShort(d.overdue)} overdue</span>
        : <span className="text-xs text-ok">nothing overdue</span>,
      href: '/invoices?status=unpaid',
    },
    { k: String(d.ordersOpen.n), v: d.ordersOpen.n === 1 ? 'order in hand' : 'orders in hand', extra: <span className="text-xs text-muted">{formatINRShort(d.ordersOpen.value)}</span>, href: '/orders' },
    { k: String(d.quotesOpen.n), v: d.quotesOpen.n === 1 ? 'open quotation' : 'open quotations', extra: <span className="text-xs text-muted">{formatINRShort(d.quotesOpen.value)}</span>, href: '/quotations' },
    { k: String(d.leadsOpen), v: d.leadsOpen === 1 ? 'open enquiry' : 'open enquiries', extra: <span className="text-xs text-muted">{formatINRShort(pipelineValue)} approx.</span>, href: '/leads' },
  ];

  return (
    <div className="max-w-6xl">
      <p className="text-xs text-muted">{NAV_GROUPS.home}</p>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}, {firstName} 👋</h1>
        <div className="flex flex-wrap gap-2">
          {can(user, 'quotation.create') && <Link href="/quotations/new" className="btn-primary text-sm w-full sm:w-auto">+ New quotation</Link>}
          {can(user, 'invoice.create') && <Link href="/invoices/new" className="btn-ghost text-sm w-full sm:w-auto">+ New bill</Link>}
        </div>
      </div>
      <DismissableTip id="tour">
        New here? <Link href={NAV.guide.href} className="text-accent hover:underline font-medium">Take the quick tour →</Link>
      </DismissableTip>

      <section className="card p-4 mb-6" aria-labelledby="today-heading">
        <h2 id="today-heading" className="text-sm font-medium text-muted mb-1">Today</h2>
        {today.length === 0 ? (
          <p className="text-sm text-ink py-1">Nothing overdue today 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {today.map((t) => (
              <li key={t.href} className="flex items-center justify-between gap-3 py-2 text-sm text-muted">
                <span>{t.text}</span>
                <Link href={t.href} className="btn-ghost !py-1 text-xs shrink-0">{t.cta} →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(d.overdueInvoices.length > 0 || d.followupLeads.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {d.overdueInvoices.length > 0 && (
            <section className="card border-crit/30" aria-labelledby="overdue-heading">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
                <h2 id="overdue-heading" className="font-medium text-sm text-crit flex items-center gap-1.5"><span aria-hidden>⚠</span> Payments overdue</h2>
                <Link href="/invoices?status=overdue" className="text-xs text-steel hover:underline">See all →</Link>
              </div>
              <ul className="divide-y divide-line">
                {d.overdueInvoices.map((r) => {
                  const wa = buildPaymentReminderLink({ phone: r.phone, customerName: r.customerName, invoiceNumber: r.number, outstanding: r.outstanding, companyNumber: outreach.whatsappNumber });
                  const due = dueLabel(r.dueDate);
                  return (
                    <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <Link href={`/invoices/${r.id}`} className="font-mono text-xs text-steel hover:underline">{r.number}</Link>
                        <span className="text-ink"> · {r.customerName ?? '—'}</span>
                        {due && <div className="text-xs text-crit">{due.text}</div>}
                      </div>
                      <span className="tabular-nums font-mono text-crit whitespace-nowrap">{formatINR(r.outstanding)}</span>
                      {wa && <WhatsappButton href={wa} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {d.followupLeads.length > 0 && (
            <section className="card border-warn/30" aria-labelledby="followups-heading">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
                <h2 id="followups-heading" className="font-medium text-sm text-warn flex items-center gap-1.5"><span aria-hidden>◷</span> Follow-ups due</h2>
                <Link href="/leads?due=today" className="text-xs text-steel hover:underline">Call list →</Link>
              </div>
              <ul className="divide-y divide-line">
                {d.followupLeads.map((l) => {
                  const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });
                  const fu = followupLabel(l.nextFollowupAt);
                  return (
                    <li key={l.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-accent hover:underline">{l.customerName}</Link>
                        {l.requirement && <div className="text-xs text-muted truncate">{l.requirement}</div>}
                      </div>
                      {fu && <span className={`text-xs whitespace-nowrap ${fu.tone === 'crit' ? 'text-crit' : 'text-warn'}`}>{fu.text}</span>}
                      {wa && <WhatsappButton href={wa} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line rounded-lg overflow-hidden mb-6">
        {tiles.map((t) => (
          <Link key={t.v} href={t.href} className="bg-surface p-4 sm:p-5 hover:bg-surface-2/60 transition-colors">
            <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
            <div className="text-sm text-muted mt-1">{t.v}</div>
            {t.extra && <div className="mt-1">{t.extra}</div>}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 flex flex-col gap-5">
          <RecentDocs
            title="Recent quotations" href="/quotations" rows={d.recentQuotations}
            statusLabel={(s) => QUOTATION_STATUS_LABELS[s as QuotationStatus] ?? s}
            empty={<>No quotations yet. <Link href="/quotations/new" className="text-steel hover:underline">+ New quotation</Link>, or ask AI: &ldquo;Sharma Auto ke liye quotation banao&rdquo;.</>}
          />
          <RecentDocs
            title="Recent bills" href="/invoices" rows={d.recentInvoices}
            statusLabel={(s) => (s === 'issued' ? null : INVOICE_STATUS_LABELS[s as InvoiceStatus] ?? s)}
            empty={<>No bills yet. <Link href="/invoices/new" className="text-steel hover:underline">+ New bill</Link>, or ask AI: &ldquo;Bharat Pumps ka bill banao&rdquo;.</>}
          />
        </div>

        <div className="flex flex-col gap-5">
          <AskCard enabled={aiEnabled()} />

          <section className="card p-5" aria-labelledby="stages-heading">
            <h2 id="stages-heading" className="font-medium text-sm mb-3">Enquiries by stage</h2>
            {pipelineOpen.length === 0 ? (
              <p className="text-xs text-muted">No open enquiries. <Link href="/leads?new=1#new-enquiry" className="text-steel hover:underline">+ New enquiry</Link></p>
            ) : (
              <div className="space-y-2">
                {LEAD_STAGES.filter((s) => !CLOSED_STAGES.includes(s)).map((stage) => {
                  const p = pipelineOpen.find((x) => x.stage === stage);
                  if (!p) return null;
                  return (
                    <div key={stage} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
                      <span className="text-muted truncate">{LEAD_STAGE_LABELS[stage]}</span>
                      <div className="h-3.5 bg-surface-2 rounded-sm overflow-hidden">
                        <div className="h-full bg-steel/70 rounded-sm" style={{ width: `${(p.n / maxStage) * 100}%` }} />
                      </div>
                      <span className="tabular-nums font-mono text-ink whitespace-nowrap">{p.n} · {formatINRShort(p.value)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
