'use client';
import { type Dispatch, type SetStateAction } from 'react';
import { formatINR } from '@ms/core';

export type LineRow = {
  description: string; hsn: string; qty: string; uom: string; rate: string; gstRate: string; tooling?: boolean;
};
/** HSN for rubber/plastic moulding dies — this shop's standard line. */
export const DEFAULT_HSN = '84807100';
export const emptyRow = (): LineRow => ({ description: '', hsn: DEFAULT_HSN, qty: '1', uom: 'NOS', rate: '', gstRate: '18', tooling: false });

const lineAmount = (r: LineRow) => (Number(r.qty) || 0) * (Number(r.rate) || 0);

/**
 * Responsive line-item editor: a dense table on desktop, stacked cards on phones
 * (no more 820px horizontal scroll). Controlled — the parent owns `rows`.
 */
export function LineItemsEditor({
  rows, setRows, tooling = false,
}: {
  rows: LineRow[];
  setRows: Dispatch<SetStateAction<LineRow[]>>;
  tooling?: boolean;
}) {
  const update = (i: number, patch: Partial<LineRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const num = (v: string) => /^\d*\.?\d*$/.test(v);

  return (
    <div className="card">
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-[34%]">Description</th><th>HSN/SAC</th><th>Qty</th><th>UOM</th><th>Rate</th><th>GST %</th>
              {tooling && <th>Tooling</th>}<th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                <td><input value={r.description} onChange={(e) => update(i, { description: e.target.value })} className="field !py-1" placeholder="Item / service" /></td>
                <td><input value={r.hsn} onChange={(e) => update(i, { hsn: e.target.value })} className="field !py-1 w-24 font-mono" /></td>
                <td><input value={r.qty} onChange={(e) => num(e.target.value) && update(i, { qty: e.target.value })} className="field !py-1 w-16 text-right" inputMode="decimal" /></td>
                <td><input value={r.uom} onChange={(e) => update(i, { uom: e.target.value })} className="field !py-1 w-16" /></td>
                <td><input value={r.rate} onChange={(e) => num(e.target.value) && update(i, { rate: e.target.value })} className="field !py-1 w-24 text-right" inputMode="decimal" placeholder="0" /></td>
                <td><input value={r.gstRate} onChange={(e) => num(e.target.value) && update(i, { gstRate: e.target.value })} className="field !py-1 w-16 text-right" inputMode="decimal" /></td>
                {tooling && <td className="text-center"><input type="checkbox" checked={!!r.tooling} onChange={(e) => update(i, { tooling: e.target.checked })} title="One-time tooling / NRE charge" /></td>}
                <td className="text-right tabular-nums font-mono whitespace-nowrap">{formatINR(lineAmount(r))}</td>
                <td><button type="button" onClick={() => removeRow(i)} className="text-crit text-sm px-1" aria-label="Remove row">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-line">
        {rows.map((r, i) => (
          <div key={i} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[0.62rem] font-mono uppercase tracking-wider text-faint">Line {i + 1}</span>
              <button type="button" onClick={() => removeRow(i)} className="text-crit text-xs" aria-label="Remove line">Remove ✕</button>
            </div>
            <input value={r.description} onChange={(e) => update(i, { description: e.target.value })} className="field" placeholder="Item / service" />
            <div className="grid grid-cols-2 gap-2">
              <label className="label !mb-0.5 col-span-2">HSN/SAC<input value={r.hsn} onChange={(e) => update(i, { hsn: e.target.value })} className="field font-mono mt-0.5" /></label>
              <label className="label !mb-0.5">Qty<input value={r.qty} onChange={(e) => num(e.target.value) && update(i, { qty: e.target.value })} className="field mt-0.5" inputMode="decimal" /></label>
              <label className="label !mb-0.5">UOM<input value={r.uom} onChange={(e) => update(i, { uom: e.target.value })} className="field mt-0.5" /></label>
              <label className="label !mb-0.5">Rate ₹<input value={r.rate} onChange={(e) => num(e.target.value) && update(i, { rate: e.target.value })} className="field mt-0.5" inputMode="decimal" placeholder="0" /></label>
              <label className="label !mb-0.5">GST %<input value={r.gstRate} onChange={(e) => num(e.target.value) && update(i, { gstRate: e.target.value })} className="field mt-0.5" inputMode="decimal" /></label>
            </div>
            <div className="flex items-center justify-between pt-1">
              {tooling ? (
                <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={!!r.tooling} onChange={(e) => update(i, { tooling: e.target.checked })} /> Tooling / NRE</label>
              ) : <span />}
              <span className="text-sm font-mono tabular-nums">{formatINR(lineAmount(r))}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-line"><button type="button" onClick={addRow} className="btn-ghost text-xs">+ Add line</button></div>
    </div>
  );
}
