import { Fragment } from 'react';
import { formatINR, type ColumnDef } from '@ms/core';

// Read-only line-item table for document DETAIL pages. Mirrors the PDF: rows are
// grouped by consecutive part (groupLabel) with a heading + subtotal, and any
// custom columns render between Description and HSN. Pure server component.

type DetailItem = {
  id: string;
  description: string;
  hsn?: string | null;
  qty: unknown;
  rate: unknown;
  taxableValue: unknown;
  isToolingCharge?: boolean;
  groupLabel?: string | null;
  attributes?: Record<string, string> | null;
};

export function DocumentItemsTable({
  items, columns,
}: {
  items: DetailItem[];
  columns?: ColumnDef[] | null;
}) {
  const cols = (columns ?? []).filter((c) => c?.label?.trim());
  const ncol = 6 + cols.length;

  // Segment into consecutive same-group runs (matches how items are stored/printed).
  type Seg = { group: string; items: DetailItem[] };
  const segs: Seg[] = [];
  for (const it of items) {
    const g = (it.groupLabel ?? '').trim();
    const last = segs[segs.length - 1];
    if (last && last.group === g) last.items.push(it);
    else segs.push({ group: g, items: [it] });
  }

  let sn = 0;
  const rowFor = (it: DetailItem) => {
    sn += 1;
    return (
      <tr key={it.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2">
        <td className="text-faint tabular-nums">{sn}</td>
        <td className="text-ink">
          {it.description}
          {it.isToolingCharge && <span className="pill bg-accent-soft text-accent ml-2 text-[0.65rem]">tooling / NRE</span>}
        </td>
        {cols.map((c) => <td key={c.id} className="text-muted text-xs">{it.attributes?.[c.id]?.trim() || '—'}</td>)}
        <td className="font-mono text-xs">{it.hsn ?? '—'}</td>
        <td className="text-right tabular-nums">{Number(it.qty)}</td>
        <td className="text-right tabular-nums font-mono">{formatINR(it.rate as number)}</td>
        <td className="text-right tabular-nums font-mono">{formatINR(it.taxableValue as number)}</td>
      </tr>
    );
  };

  return (
    <div className="card overflow-x-auto mb-4">
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="text-left text-faint border-b border-line text-xs uppercase [&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
            <th>#</th><th>Description</th>
            {cols.map((c) => <th key={c.id}>{c.label}</th>)}
            <th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {segs.map((seg, si) => {
            if (!seg.group) return <Fragment key={si}>{seg.items.map(rowFor)}</Fragment>;
            const sub = seg.items.reduce((s, it) => s + Number(it.taxableValue || 0), 0);
            return (
              <Fragment key={si}>
                <tr className="bg-surface-2/60 border-b border-line">
                  <td colSpan={ncol} className="px-4 py-2 font-semibold text-ink">
                    <span className="text-accent" aria-hidden>▸</span> {seg.group}
                  </td>
                </tr>
                {seg.items.map(rowFor)}
                <tr className="bg-surface-2/30 border-b border-line">
                  <td colSpan={ncol - 1} className="px-4 py-1.5 text-right text-muted">Subtotal — {seg.group}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-mono font-semibold">{formatINR(sub)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
