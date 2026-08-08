import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  formatINR, formatINRShort,
  LEAD_STAGE_LABELS, ORDER_STATUS_LABELS, ORDER_CATEGORY_LABELS, QUOTATION_STATUS_LABELS,
  type LeadStage, type OrderStatus, type OrderCategory, type QuotationStatus,
} from '@ms/core';
import { requireUser } from '@/lib/rbac';
import { analyticsData } from '@/lib/queries';
import { MonthlyBars, HBarList } from '@/components/charts';

export const metadata = { title: 'Analytics' };

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (prev <= 0) return <span className="text-xs text-faint">vs {label}: —</span>;
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
    <div className={`card p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-medium text-sm">{title}</h2>
        {sub && <span className="text-xs text-faint">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export default async function AnalyticsPage() {
  await requireUser();
  const d = await analyticsData();

  const openOrderValue = d.ordersByStatus.filter((o) => ['open', 'in_progress'].includes(o.status)).reduce((s, o) => s + o.value, 0);
  const qTotal = d.quotesByStatus.reduce((s, x) => s + x.n, 0);
  const qGet = (s: string) => d.quotesByStatus.find((x) => x.status === s)?.n ?? 0;
  const converted = qGet('converted');
  const winRate = qTotal ? Math.round(((qGet('approved') + converted) / qTotal) * 100) : 0;
  const convRate = qTotal ? Math.round((converted / qTotal) * 100) : 0;
  const leadOpen = d.leadsByStage.filter((x) => !['won', 'lost'].includes(x.stage)).reduce((s, x) => s + x.n, 0);

  const kpis = [
    { k: formatINRShort(d.sales.week), v: 'Sales this week', extra: <Delta now={d.sales.week} prev={d.sales.lastWeek} label="last week" /> },
    { k: formatINRShort(d.sales.month), v: 'Sales this month', extra: <Delta now={d.sales.month} prev={d.sales.lastMonth} label="last month" /> },
    { k: formatINRShort(d.sales.fy), v: `Sales this FY ${d.fyLabel}`, extra: <Delta now={d.sales.fy} prev={d.sales.lastFy} label="last FY" /> },
    { k: formatINRShort(d.sales.allTime), v: `All-time · ${d.sales.invoiceCount} invoices`, extra: <span className="text-xs text-faint">avg {formatINRShort(d.sales.avgInvoice)}/invoice</span> },
  ];

  return (
    <div className="max-w-6xl">
      <p className="eyebrow">Overview</p>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <span className="text-xs font-mono text-muted">Financial year {d.fyLabel} · Apr–Mar</span>
      </div>

      {/* Sales KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden mb-6">
        {kpis.map((t) => (
          <div key={t.v} className="bg-surface p-5">
            <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
            <div className="text-sm text-muted mt-1">{t.v}</div>
            <div className="mt-1">{t.extra}</div>
          </div>
        ))}
      </div>

      {/* Revenue trend + receivables aging */}
      <div className="grid md:grid-cols-3 gap-5 mb-5">
        <Card title="Revenue" sub="last 12 months" className="md:col-span-2">
          <MonthlyBars data={d.revByMonth} fmt={formatINRShort} />
        </Card>
        <Card title="Receivables" sub={`${formatINR(d.aging.total)} outstanding`}>
          <div className="space-y-2.5 text-sm">
            <AgingRow label="Not overdue" value={d.aging.current} total={d.aging.total} tone="bg-steel/70" />
            <AgingRow label="1–30 days" value={d.aging.d30} total={d.aging.total} tone="bg-[#c9a13b]" />
            <AgingRow label="31–60 days" value={d.aging.d60} total={d.aging.total} tone="bg-warn" />
            <AgingRow label="60+ days" value={d.aging.d60plus} total={d.aging.total} tone="bg-crit" />
          </div>
          {d.aging.total <= 0.5 && <p className="text-xs text-ok mt-3">Nothing outstanding — all invoices settled. 🎉</p>}
        </Card>
      </div>

      {/* Collections + new customers */}
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <Card title="Payments collected" sub="last 12 months">
          <MonthlyBars data={d.collectionsByMonth} fmt={formatINRShort} color="bg-ok/70" />
        </Card>
        <Card title="New customers" sub={`${d.customers} total`}>
          <MonthlyBars data={d.newCustomersByMonth} fmt={(n) => String(Math.round(n))} color="bg-accent/70" />
        </Card>
      </div>

      {/* Top customers + order book */}
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <Card title="Top customers by sales" sub="all-time">
          <HBarList data={d.topCustomers.map((c) => ({ label: c.name, value: c.value }))} fmt={formatINRShort} emptyLabel="No invoiced sales yet." />
        </Card>
        <Card title="Order book" sub={`${formatINR(openOrderValue)} open`}>
          <HBarList
            data={d.ordersByStatus.map((o) => ({ label: ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status, value: o.value, hint: `${o.n}` }))}
            fmt={formatINRShort} color="bg-steel/70" labelWidth="7rem" emptyLabel="No orders yet."
          />
          {d.ordersByCategory.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mb-2">By category</div>
              <HBarList data={d.ordersByCategory.map((o) => ({ label: ORDER_CATEGORY_LABELS[o.category as OrderCategory] ?? o.category, value: o.value, hint: `${o.n}` }))} fmt={formatINRShort} color="bg-accent/60" labelWidth="7rem" />
            </div>
          )}
        </Card>
      </div>

      {/* Quotations + leads */}
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <Card title="Quotations" sub={`${qTotal} total`}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat label="Win rate" value={`${winRate}%`} hint="approved or converted" />
            <Stat label="Converted to invoice" value={`${convRate}%`} hint={`${converted} of ${qTotal}`} />
          </div>
          <HBarList
            data={['draft', 'sent', 'approved', 'converted', 'rejected'].map((s) => ({ label: QUOTATION_STATUS_LABELS[s as QuotationStatus], value: qGet(s) }))}
            fmt={(n) => String(Math.round(n))} color="bg-steel/60" labelWidth="6rem" emptyLabel="No quotations yet."
          />
          <p className="text-xs text-faint mt-3">{d.orderedQuotes} converted to a sales order.</p>
        </Card>
        <Card title="Leads" sub={`${leadOpen} open`}>
          <HBarList
            data={d.leadsByStage.map((l) => ({ label: LEAD_STAGE_LABELS[l.stage as LeadStage] ?? l.stage, value: l.value, hint: `${l.n}` }))}
            fmt={formatINRShort} color="bg-accent/60" labelWidth="7rem" emptyLabel="No leads yet."
          />
          <div className="mt-4 pt-3 border-t border-line">
            <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mb-2">Top sources</div>
            <HBarList data={d.leadsBySource.map((l) => ({ label: l.source, value: l.n }))} fmt={(n) => `${Math.round(n)}`} color="bg-steel/50" labelWidth="7rem" emptyLabel="No source data." />
          </div>
        </Card>
      </div>

      {/* GST summary */}
      <Card title="GST summary" sub={`this FY ${d.fyLabel} · for reference`}>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-line border border-line rounded-lg overflow-hidden">
          {[
            { k: 'Taxable', v: d.gst.taxable },
            { k: 'CGST', v: d.gst.cgst },
            { k: 'SGST', v: d.gst.sgst },
            { k: 'IGST', v: d.gst.igst },
            { k: 'Total tax', v: d.gst.cgst + d.gst.sgst + d.gst.igst },
            { k: 'Invoiced', v: d.gst.grand },
          ].map((c) => (
            <div key={c.k} className="bg-surface p-3">
              <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint">{c.k}</div>
              <div className="font-mono text-sm font-semibold tabular-nums mt-1">{formatINR(c.v)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-faint mt-3">Figures from issued invoices (excludes cancelled). A reference view — reconcile against your filed returns.</p>
      </Card>

      <div className="mt-5"><Link href="/dashboard" className="text-steel text-sm hover:underline">← Dashboard</Link></div>
    </div>
  );
}

function AgingRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs">
      <span className="text-muted">{label}</span>
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
      {hint && <div className="text-[0.65rem] text-faint mt-0.5">{hint}</div>}
    </div>
  );
}
