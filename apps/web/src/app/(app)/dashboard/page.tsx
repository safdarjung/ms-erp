import { formatINRShort } from '@ms/core';
import { dashboardCounts } from '@/lib/queries';

export default async function DashboardPage() {
  const c = await dashboardCounts();
  const tiles = [
    { k: c.leads, v: 'Total leads' },
    { k: c.negotiation, v: 'In negotiation' },
    { k: c.customers, v: 'Customers' },
    { k: c.invoices, v: 'Invoices' },
    { k: formatINRShort(c.revenue), v: 'Invoiced' },
  ];

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Dashboard</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Good morning 👋</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line rounded-lg overflow-hidden">
        {tiles.map((t) => (
          <div key={t.v} className="bg-surface p-5">
            <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
            <div className="text-sm text-muted mt-1">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="card p-5 mt-6 text-sm text-muted">
        <p className="text-ink font-medium mb-1">Phase 1 · walking skeleton</p>
        Multi-tenant foundation with Postgres row-level security is live. Use <span className="font-mono text-ink">Leads</span> and{' '}
        <span className="font-mono text-ink">Customers</span> — every row you see is isolated to this tenant by the database itself.
      </div>
    </div>
  );
}
