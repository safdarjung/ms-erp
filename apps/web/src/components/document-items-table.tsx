import { Fragment } from 'react';
import { formatINR, formatSpecs, groupRuns, itemSpecs, splitColumns, type ColumnDef } from '@ms/core';

// Read-only line-item table for document DETAIL pages. Mirrors the PDF: rows are
// grouped by consecutive part (groupLabel) with a heading + subtotal; short custom
// fields get their own column and the rest print under the description as
// "Material: D2 · Hardness: 58–60 HRC". Pure server component.

type DetailItem = {
  id: string;
  description: string;
  hsn?: string | null;
  qty: unknown;
  rate: unknown;
  taxableValue: unknown;
  isToolingCharge?: boolean;
  groupLabel?: string | null;
  groupNote?: string | null;
  attributes?: Record<string, string> | null;
};

export function DocumentItemsTable({
  items, columns,
}: {
  items: DetailItem[];
  columns?: ColumnDef[] | null;
}) {
  // @ms/core decides which fields are columns and which read as spec text.
  const { tableCols } = splitColumns(columns);
  const ncol = 6 + tableCols.length;

  let sn = 0;
  const rowFor = (it: DetailItem) => {
    sn += 1;
    const specs = formatSpecs(itemSpecs(columns, it.attributes));
    return (
      <tr key={it.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2">
        <td className="text-faint tabular-nums">{sn}</td>
        <td className="text-ink">
          {it.description}
          {it.isToolingCharge && <span className="pill bg-accent-soft text-accent ml-2 text-xs" title="Charged once (die/tool development), not per piece">one-time charge</span>}
          {specs && (
            <div className="text-xs text-muted mt-0.5 max-w-[22rem] break-words [overflow-wrap:anywhere]">{specs}</div>
          )}
        </td>
        {tableCols.map((c) => <td key={c.id} className="text-muted text-xs">{it.attributes?.[c.id]?.trim() || '—'}</td>)}
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
            <th>#</th><th>Item / description</th>
            {tableCols.map((c) => <th key={c.id}>{c.label}</th>)}
            <th>HSN code</th><th className="text-right">Qty</th><th className="text-right">Rate (₹)</th><th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {groupRuns(items).map((run, si) => {
            if (!run.label) return <Fragment key={si}>{run.items.map(rowFor)}</Fragment>;
            const sub = run.items.reduce((s, it) => s + Number(it.taxableValue || 0), 0);
            return (
              <Fragment key={si}>
                <tr className="bg-surface-2/60 border-b border-line">
                  <td colSpan={ncol} className="px-4 py-2 font-semibold text-ink">
                    <span className="text-accent" aria-hidden>▸</span> {run.label}
                    {run.note && (
                      <span className="text-xs text-muted font-normal ml-2 break-words [overflow-wrap:anywhere]">{run.note}</span>
                    )}
                  </td>
                </tr>
                {run.items.map(rowFor)}
                <tr className="bg-surface-2/30 border-b border-line">
                  <td colSpan={ncol - 1} className="px-4 py-1.5 text-right text-muted">Subtotal — {run.label}</td>
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
