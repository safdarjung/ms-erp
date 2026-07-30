import Link from 'next/link';
import { formatINR } from '@ms/core';
import { requireUser, can } from '@/lib/rbac';
import { listQuotations } from '@/lib/queries';
import { formatDate } from '@/lib/format';

export default async function QuotationsPage() {
  const user = await requireUser();
  const rows = await listQuotations();

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
        {can(user, 'quotation.create') && <Link href="/quotations/new" className="btn-primary">+ New quotation</Link>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Number</th><th>Date</th><th>Customer</th><th className="text-right">Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs"><Link href={`/quotations/${r.id}`} className="text-steel hover:underline">{r.number}</Link></td>
                <td>{formatDate(r.docDate)}</td>
                <td className="text-ink">{r.customerName ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{formatINR(r.grandTotal)}</td>
                <td><span className={`pill capitalize ${r.status === 'converted' ? 'bg-[#e4f1ea] text-ok' : 'bg-surface-2 text-muted'}`}>{r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No quotations yet. <Link href="/quotations/new" className="text-steel hover:underline">Create one →</Link></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
