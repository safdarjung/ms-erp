import Link from 'next/link';
import { formatINR } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listInvoices } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';

export const metadata = { title: 'Invoices' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const rows = await listInvoices(q);

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Finance</p>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">GST Invoices</h1>
        {can(user, 'invoice.create') && <Link href="/invoices/new" className="btn-primary">+ New invoice</Link>}
      </div>

      <FilterBar basePath="/invoices" q={q} placeholder="Search number or customer…" />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Number</th><th>Date</th><th>Customer</th><th>Tax</th>
              <th className="text-right">Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs"><Link href={`/invoices/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td>{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td>{r.isInterstate ? <span className="pill bg-accent-soft text-accent">IGST</span> : <span className="pill bg-surface-2 text-muted">CGST+SGST</span>}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td className="capitalize">{r.status}</td>
                <td className="text-right"><a href={`/print/invoice/${r.id}?print=1`} target="_blank" rel="noreferrer" className="text-steel text-xs hover:underline">PDF ↗</a></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">
                {q ? <>No invoices match this search. <Link href="/invoices" className="text-steel hover:underline">Clear →</Link></>
                  : <>No invoices yet. <Link href="/invoices/new" className="text-steel hover:underline">Create one →</Link></>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
