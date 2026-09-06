import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  formatINR, formatINRShort,
  LEAD_STAGE_LABELS, ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, QUOTATION_STATUS_LABELS,
  type LeadStage, type OrderStatus, type OrderCategory, type QuotationStatus,
} from '@ms/core';
import { requireUser } from '@/lib/rbac';
import { analyticsData } from '@/lib/queries';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { MonthlyBars, HBarList } from '@/components/charts';

export const metadata = { title: 'Reports' };

const OPEN_ORDER_STATUSES: string[] = ['open', 'in_progress'];
const CLOSED_STAGES: string[] = ['won', 'lost'];
const QUOTE_ORDER: QuotationStatus[] = ['draft', 'sent', 'approved', 'converted', 'rejected'];

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (prev <= 0) return <span className="text-xs text-muted">vs {label}: —</span>;
  const p = Math.round(((now - prev) / prev) * 100);
  if (!Number.isFinite(p)) return null;
  return (
    <span className={`text-xs font-medium ${p >= 0 ? 'text-ok' : 'text-crit'}`}>
      {p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs {label}
    </span>
  );
}

function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <h2 className="font-medium text-sm">{title}</h2>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs text-muted font-medium mb-2">{children}</h3>;
}

export default async function AnalyticsPage() {
  await requireUser();
  const d = await analyticsData();

  const openOrderValue = d.ordersByStatus.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).reduce((s, o) => s + o.value, 0);
  const qTotal = d.quotesByStatus.reduce((s, x) => s + x.n, 0);
  const qGet = (s: string) => d.quotesByStatus.find((x) => x.status === s)?.n ?? 0;
  const converted = qGet('converted');
  const acceptedRate = qTotal ? Math.round(((qGet('approved') + converted) / qTotal) * 100) : 0;
  const billedRate = qTotal ? Math.round((converted / qTotal) * 100) : 0;
  const leadOpen = d.leadsByStage.filter((x) => !CLOSED_STAGES.includes(x.stage)).reduce((s, x) => s + x.n, 0);
  const bills = d.sales.invoiceCount === 1 ? '1 bill' : `${d.sales.invoiceCount} bills`;

  const kpis = [
    { k: formatINRShort(d.sales.week), v: 'Sales this week', extra: <Delta now={d.sales.week} prev={d.sales.lastWeek} label="last week" /> },
    { k: formatINRShort(d.sales.month), v: 'Sales this month', extra: <Delta now={d.sales.month} prev={d.sales.lastMonth} label="last month" /> },
    { k: formatINRShort(d.sales.fy), v: 'Sales this year (Apr–Mar)', extra: <Delta now={d.sales.fy} prev={d.sales.lastFy} label="last year" /> },
    { k: formatINRShort(d.sales.allTime), v: `All time · ${bills}`, extra: <span className="text-xs text-muted">about {formatINRShort(d.sales.avgInvoice)} per bill</span> },
  ];

  return (
    <div className="max-w-6xl">
      <p className="text-xs text-muted">{NAV_GROUPS.home}</p>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <span className="text-xs text-muted">Financial year {d.fyLabel} (Apr–Mar)</span>
      </div>

      {/* Sales tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden mb-6">
        {kpis.map((t) => (
          <div key={t.v} className="bg-surface p-4 sm:p-5">
            <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
            <div className="text-sm text-muted mt-1">{t.v}</div>
            <div className="mt-1">{t.extra}</div>
          </div>
        ))}
      </div>

      {/* Sales trend + money to collect */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
        <Card title="Sales by month" sub="last 12 months" className="md:col-span-2">
          <MonthlyBars data={d.revByMonth} fmt={formatINRShort} />
        </Card>
        <Card title="Money to collect" sub={d.aging.total > 0.5 ? `${formatINR(d.aging.total)} still due` : undefined}>
          <div className="space-y-2.5 text-sm">
            <AgingRow label="Not yet due" value={d.aging.current} total={d.aging.total} tone="bg-steel/70" />
            <AgingRow label="1–30 days late" value={d.aging.d30} total={d.aging.total} tone="bg-[#c9a13b]" />
            <AgingRow label="31–60 days late" value={d.aging.d60} total={d.aging.total} tone="bg-warn" />
            <AgingRow label="Over 60 days late" value={d.aging.d60plus} total={d.aging.total} tone="bg-crit" />
          </div>
          {d.aging.total <= 0.5 && <p className="text-xs text-ok mt-3">Nothing due — every bill is paid. 🎉</p>}
        </Card>
      </div>

      {/* Payments received + new customers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <Card title="Payments received" sub="last 12 months">
          <MonthlyBars data={d.collectionsByMonth} fmt={formatINRShort} color="bg-ok/70" />
        </Card>
        <Card title="New customers" sub={`${d.customers} in total`}>
          <MonthlyBars data={d.newCustomersByMonth} fmt={(n) => String(Math.round(n))} color="bg-accent/70" />
        </Card>
      </div>

      {/* Top customers + orders in hand */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <Card title="Top customers" sub="by amount billed, all time">
          <HBarList data={d.topCustomers.map((c) => ({ label: c.name, value: c.value }))} fmt={formatINRShort} emptyLabel="No bills yet." />
        </Card>
        <Card title="Orders in hand" sub={`${formatINR(openOrderValue)} open`}>
          <HBarList
            data={d.ordersByStatus.map((o) => ({ label: ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status, value: o.value, hint: `${o.n}` }))}
            fmt={formatINRShort} color="bg-steel/70" labelWidth="7rem" emptyLabel="No orders yet."
          />
          {d.ordersByCategory.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <SubHeading>By type of work</SubHeading>
              <HBarList data={d.ordersByCategory.map((o) => ({ label: ORDER_CATEGORY_LABELS[o.category as OrderCategory] ?? o.category, value: o.value, hint: `${o.n}` }))} fmt={formatINRShort} color="bg-accent/60" labelWidth="7rem" />
            </div>
          )}
        </Card>
      </div>

      {/* Quotations + enquiries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <Card title="Quotations" sub={`${qTotal} in total`}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat label="Quotes accepted" value={`${acceptedRate}%`} hint="approved or billed" />
            <Stat label="Quotes that became bills" value={`${billedRate}%`} hint={`${converted} of ${qTotal}`} />
          </div>
          <HBarList
            data={QUOTE_ORDER.map((s) => ({ label: QUOTATION_STATUS_LABELS[s], value: qGet(s) }))}
            fmt={(n) => String(Math.round(n))} color="bg-steel/60" labelWidth="8rem" emptyLabel="No quotations yet."
          />
          <p className="text-xs text-muted mt-3">{d.orderedQuotes} became orders.</p>
        </Card>
        <Card title="Enquiries" sub={`${leadOpen} open`}>
          <HBarList
            data={d.leadsByStage.map((l) => ({ label: LEAD_STAGE_LABELS[l.stage as LeadStage] ?? l.stage, value: l.value, hint: `${l.n}` }))}
            fmt={formatINRShort} color="bg-accent/60" labelWidth="8rem" emptyLabel="No enquiries yet."
          />
          <div className="mt-4 pt-3 border-t border-line">
            <SubHeading>Where enquiries come from</SubHeading>
            <HBarList data={d.leadsBySource.map((l) => ({ label: l.source, value: l.n }))} fmt={(n) => `${Math.round(n)}`} color="bg-steel/50" labelWidth="7rem" emptyLabel="No source noted yet." />
          </div>
        </Card>
      </div>

      {/* GST summary */}
      <Card title="GST summary" sub={`this year ${d.fyLabel} · for reference`}>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-line border border-line rounded-lg overflow-hidden">
          {[
            { k: 'Before GST', v: d.gst.taxable },
            { k: 'CGST', v: d.gst.cgst },
            { k: 'SGST', v: d.gst.sgst },
            { k: 'IGST', v: d.gst.igst },
            { k: 'Total GST', v: d.gst.cgst + d.gst.sgst + d.gst.igst },
            { k: 'Billed', v: d.gst.grand },
          ].map((c) => (
            <div key={c.k} className="bg-surface p-3">
              <div className="text-xs text-muted">{c.k}</div>
              <div className="font-mono text-sm font-semibold tabular-nums mt-1">{formatINR(c.v)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-3">From bills issued this year (cancelled ones left out). For reference only — check against your filed returns.</p>
      </Card>

      <div className="mt-5"><Link href={NAV.dashboard.href} className="text-steel text-sm hover:underline">← {NAV.dashboard.label}</Link></div>
    </div>
  );
}

function AgingRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
      <span className="text-muted truncate">{label}</span>
      <div className="h-3.5 bg-surface-2 rounded-sm overflow-hidden"><div className={`h-full ${tone} rounded-sm`} style={{ width: `${value > 0 ? Math.max(2, pct) : 0}%` }} /></div>
      <span className="tabular-nums font-mono text-ink whitespace-nowrap">{formatINRShort(value)}</span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-line rounded-lg p-3">
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
    </div>
  );
}
