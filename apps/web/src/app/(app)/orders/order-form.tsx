'use client';
import { useActionState, useMemo, useState } from 'react';
import {
  computeGst, isInterstate, formatINR,
  ORDER_CATEGORIES, ORDER_CATEGORY_LABELS, MATERIAL_OWNERSHIP, MATERIAL_OWNERSHIP_LABELS,
} from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { LineItemsEditor, emptyRow, type LineRow } from '@/components/line-items-editor';
import { createOrderAction, type ActionState } from './actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };

export function OrderForm({
  customers, supplierStateCode, defaultCustomerId = '',
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultCustomerId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createOrderAction, {});
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);
  const today = new Date().toISOString().slice(0, 10);

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const totals = useMemo(
    () => computeGst(rows.map((r) => ({ qty: r.qty, rate: r.rate, gstRate: r.gstRate })), interstate),
    [rows, interstate],
  );
  const savable = rows.filter((r) => r.description.trim()).length;

  const itemsJson = JSON.stringify(
    rows.filter((r) => r.description.trim()).map((r) => ({
      description: r.description, hsn: r.hsn, qty: Number(r.qty) || 0, uom: r.uom,
      rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0,
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
        <div><label className="label">Order date *</label><input name="docDate" type="date" defaultValue={today} required className="field" /></div>
        <div><label className="label">Delivery date</label><input name="deliveryDate" type="date" className="field" /></div>
        <div className="col-span-2 md:col-span-2">
          <label className="label">Customer PO ref</label>
          <input name="poRef" className="field" placeholder="PO number / reference" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="orderCategory" defaultValue="tool_build" className="field">
            {ORDER_CATEGORIES.map((c) => <option key={c} value={c}>{ORDER_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Material</label>
          <select name="materialOwnership" defaultValue="customer" className="field">
            {MATERIAL_OWNERSHIP.map((m) => <option key={m} value={m}>{MATERIAL_OWNERSHIP_LABELS[m]}</option>)}
          </select>
        </div>
      </div>

      <LineItemsEditor rows={rows} setRows={setRows} />

      <div className="flex flex-col md:flex-row md:justify-end gap-4">
        <div className="card p-4 w-full md:w-72 text-sm self-start">
          <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mb-2">Order value</div>
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(totals.subtotal)}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted">GST (est.)</span><span className="tabular-nums font-mono">{formatINR(totals.taxTotal)}</span></div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total (est.)</span><span className="tabular-nums font-mono">{formatINR(totals.grand)}</span></div>
          <div className="text-xs text-faint mt-1">{cust ? (interstate ? 'Inter-state → IGST at invoice' : 'Intra-state → CGST + SGST at invoice') : 'GST is finalised on the invoice'}</div>
        </div>
      </div>

      {state.error && <p className="text-sm text-crit">{state.error}</p>}
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Create order</SubmitButton>
        <span className="text-xs text-faint">{savable} line{savable === 1 ? '' : 's'} will be saved</span>
      </div>
    </form>
  );
}
