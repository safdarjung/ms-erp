'use client';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { computeGst, isInterstate, formatINR } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { AiPolishButton } from '@/components/ai-polish-button';
import { createQuotationAction, type ActionState } from './actions';
import { draftQuotationItemsAction } from './ai-actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };
type Row = { description: string; hsn: string; qty: string; uom: string; rate: string; gstRate: string; tooling: boolean };
const emptyRow = (): Row => ({ description: '', hsn: '', qty: '1', uom: 'NOS', rate: '', gstRate: '18', tooling: false });

type DraftMeta = { assumptions: string[]; flags: string[]; basis: string[] };

function AiDraftCard({
  customerId,
  onDraft,
}: {
  customerId: string;
  onDraft: (rows: Row[], terms: string[], meta: DraftMeta) => void;
}) {
  const [requirement, setRequirement] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      const res = await draftQuotationItemsAction({ requirement, customerId: customerId || undefined });
      if (!res.ok) { setError(res.error); return; }
      const d = res.draft;
      onDraft(
        d.items.map((it) => ({
          description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom,
          rate: String(it.rate), gstRate: String(it.gstRate), tooling: it.isToolingCharge,
        })),
        d.termsSuggestion,
        { assumptions: d.assumptions, flags: d.flags, basis: d.items.map((it) => it.basis).filter(Boolean) },
      );
    });

  return (
    <div className="card p-4 border-accent/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="font-medium text-sm">Draft with AI</span>
        <span className="text-[0.65rem] text-faint">proposes items & rates from your quote history — you review everything</span>
      </div>
      <textarea
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        rows={2}
        className="field mt-1"
        placeholder="Describe the job… e.g. Progressive press tool for 1mm CRCA bracket, 4 stations, ~50k strokes/month + 500 pcs initial production"
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={run}
          disabled={pending || requirement.trim().length < 10}
          className="btn-primary text-xs disabled:opacity-50"
        >
          {pending ? 'Drafting…' : '✦ Draft line items'}
        </button>
        {pending && <span className="text-xs text-faint animate-pulse">Analyzing your quote history…</span>}
        {error && <span className="text-xs text-crit">{error}</span>}
      </div>
    </div>
  );
}

export function QuotationForm({
  customers,
  supplierStateCode,
  defaultTerms,
  aiEnabled,
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultTerms: string;
  aiEnabled: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createQuotationAction, {});
  const [customerId, setCustomerId] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [terms, setTerms] = useState(defaultTerms);
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [undoRows, setUndoRows] = useState<Row[] | null>(null);
  const [suggestedTerms, setSuggestedTerms] = useState<string[] | null>(null);
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

  const applyDraft = (drafted: Row[], termsSuggestion: string[], meta: DraftMeta) => {
    setUndoRows(rows.some((r) => r.description.trim()) ? rows : null);
    setRows(drafted.length ? drafted : [emptyRow()]);
    setDraftMeta(meta);
    if (termsSuggestion.length) {
      if (!terms.trim()) setTerms(termsSuggestion.join('\n'));
      else setSuggestedTerms(termsSuggestion);
    }
  };

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

      {aiEnabled && <AiDraftCard customerId={customerId} onDraft={applyDraft} />}

      {draftMeta && (
        <div className="border border-accent/40 bg-accent-soft/30 rounded-lg p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-mono uppercase tracking-wider text-accent text-[0.65rem]">AI draft applied — review every line before saving</div>
            <div className="flex gap-3">
              {undoRows && (
                <button type="button" className="text-steel hover:underline" onClick={() => { setRows(undoRows); setUndoRows(null); setDraftMeta(null); }}>
                  Undo
                </button>
              )}
              <button type="button" className="text-muted hover:underline" onClick={() => setDraftMeta(null)}>Dismiss</button>
            </div>
          </div>
          {draftMeta.flags.length > 0 && (
            <ul className="space-y-1">
              {draftMeta.flags.map((f, i) => <li key={i} className="text-crit">⚑ {f}</li>)}
            </ul>
          )}
          {draftMeta.assumptions.length > 0 && (
            <ul className="space-y-0.5 text-muted">
              {draftMeta.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
            </ul>
          )}
          {draftMeta.basis.length > 0 && (
            <details>
              <summary className="cursor-pointer text-faint">Rate basis per line</summary>
              <ul className="mt-1 space-y-0.5 text-muted">
                {draftMeta.basis.map((b, i) => <li key={i}>{i + 1}. {b}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

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
          <textarea name="terms" rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} className="field" />
          {suggestedTerms && (
            <div className="mt-1.5 text-xs">
              <button type="button" className="text-accent hover:underline" onClick={() => { setTerms(suggestedTerms.join('\n')); setSuggestedTerms(null); }}>
                ✦ Use AI-suggested terms for this job
              </button>
            </div>
          )}
          <AiPolishButton
            kind="terms"
            docType="quotation"
            value={terms}
            onApply={setTerms}
            enabled={aiEnabled}
            context={cust ? `Customer: ${cust.name}. ${rows.filter((r) => r.description.trim()).length} line items.` : undefined}
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
      <div><SubmitButton className="btn-primary">Create quotation</SubmitButton></div>
    </form>
  );
}
