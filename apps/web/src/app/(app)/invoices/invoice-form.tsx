'use client';
import { useActionState, useMemo, useState } from 'react';
import { computeGst, isInterstate, formatINR } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { AiPolishButton } from '@/components/ai-polish-button';
import { LineItemsEditor, emptyRow, type LineRow } from '@/components/line-items-editor';
import { createInvoiceAction, type ActionState } from './actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };

export function InvoiceForm({
  customers,
  supplierStateCode,
  defaultTerms,
  aiEnabled,
  defaultCustomerId = '',
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultTerms: string;
  aiEnabled: boolean;
  defaultCustomerId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createInvoiceAction, {});
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);
  const [terms, setTerms] = useState(defaultTerms);
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
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.stateCode ? ` — state ${c.stateCode}` : ''}</option>
            ))}
          </select>
        </div>
        <div><label className="label">Date *</label><input name="docDate" type="date" defaultValue={today} required className="field" /></div>
        <div><label className="label">PO ref</label><input name="poRef" className="field" placeholder="optional" /></div>
      </div>

      <LineItemsEditor rows={rows} setRows={setRows} />

      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1">
          <label className="label">Terms</label>
          <textarea name="terms" rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} className="field" />
          <AiPolishButton
            kind="terms"
            docType="invoice"
            value={terms}
            onApply={setTerms}
            enabled={aiEnabled}
            context={cust ? `Customer: ${cust.name}.` : undefined}
          />
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
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Create invoice</SubmitButton>
        <span className="text-xs text-faint">{savable} line{savable === 1 ? '' : 's'} will be saved</span>
      </div>
    </form>
  );
}
