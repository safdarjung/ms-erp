'use client';
import { useActionState, useMemo, useState } from 'react';
import { computeGst, isInterstate, formatINR } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { createQuotationAction, type ActionState } from './actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };
type Row = { description: string; hsn: string; qty: string; uom: string; rate: string; gstRate: string; tooling: boolean };
const emptyRow = (): Row => ({ description: '', hsn: '', qty: '1', uom: 'NOS', rate: '', gstRate: '18', tooling: false });

export function QuotationForm({
  customers,
  supplierStateCode,
  defaultTerms,
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultTerms: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createQuotationAction, {});
  const [customerId, setCustomerId] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const today = new Date().toISOString().slice(0, 10);

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const totals = useMemo(
    () => computeGst(rows.map((r) => ({ qty: r.qty, rate: r.rate, gstRate: r.gstRate })), interstate),
    [rows, interstate],
  );

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const itemsJson = JSON.stringify(
    rows.filter((r) => r.description.trim()).map((r) => ({
      description: r.description, hsn: r.hsn, qty: Number(r.qty) || 0, uom: r.uom,
      rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0, isToolingCharge: r.tooling,
    })),
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />

      <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="label">Customer *</label>
          <select name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="field">
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.stateCode ? ` — state ${c.stateCode}` : ''}</option>)}
          </select>
        </div>
        <div><label className="label">Date *</label><input name="docDate" type="date" defaultValue={today} required className="field" /></div>
        <div><label className="label">Validity (days)</label><input name="validityDays" type="number" min={1} defaultValue={15} className="field" /></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-[32%]">Description</th><th>HSN/SAC</th><th>Qty</th><th>UOM</th><th>Rate</th><th>GST %</th>
              <th>Tooling</th><th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                <td><input value={r.description} onChange={(e) => update(i, { description: e.target.value })} className="field !py-1" placeholder="Item / service" /></td>
                <td><input value={r.hsn} onChange={(e) => update(i, { hsn: e.target.value })} className="field !py-1 w-24" /></td>
                <td><input value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} className="field !py-1 w-16" inputMode="decimal" /></td>
                <td><input value={r.uom} onChange={(e) => update(i, { uom: e.target.value })} className="field !py-1 w-16" /></td>
                <td><input value={r.rate} onChange={(e) => update(i, { rate: e.target.value })} className="field !py-1 w-24" inputMode="decimal" /></td>
                <td><input value={r.gstRate} onChange={(e) => update(i, { gstRate: e.target.value })} className="field !py-1 w-16" inputMode="decimal" /></td>
                <td className="text-center"><input type="checkbox" checked={r.tooling} onChange={(e) => update(i, { tooling: e.target.checked })} title="One-time tooling / NRE charge" /></td>
                <td className="text-right tabular-nums font-mono">{formatINR((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td>
                <td><button type="button" onClick={() => removeRow(i)} className="text-crit text-sm px-1" aria-label="Remove row">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-3 border-t border-line"><button type="button" onClick={addRow} className="btn-ghost text-xs">+ Add line</button></div>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1">
          <label className="label">Terms</label>
          <textarea name="terms" rows={6} defaultValue={defaultTerms} className="field" />
        </div>
        <div className="card p-4 w-full md:w-72 text-sm self-start">
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(totals.subtotal)}</span></div>
          {interstate ? (
            <div className="flex justify-between py-1"><span className="text-muted">IGST</span><span className="tabular-nums font-mono">{formatINR(totals.igst)}</span></div>
          ) : (
            <>
              <div className="flex justify-between py-1"><span className="text-muted">CGST</span><span className="tabular-nums font-mono">{formatINR(totals.cgst)}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted">SGST</span><span className="tabular-nums font-mono">{formatINR(totals.sgst)}</span></div>
            </>
          )}
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>G. Total</span><span className="tabular-nums font-mono">{formatINR(totals.grand)}</span></div>
          <div className="text-xs text-faint mt-1">{cust ? (interstate ? 'Inter-state → IGST' : 'Intra-state → CGST + SGST') : 'Select a customer'}</div>
        </div>
      </div>

      {state.error && <p className="text-sm text-crit">{state.error}</p>}
      <div><SubmitButton className="btn-primary">Create quotation</SubmitButton></div>
    </form>
  );
}
