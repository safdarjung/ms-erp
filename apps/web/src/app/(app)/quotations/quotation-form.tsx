'use client';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { computeGst, isInterstate, formatINR, type ColumnDef } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { AiPolishButton } from '@/components/ai-polish-button';
import { LineItemsEditor, emptyRow, serializeItems, type LineRow } from '@/components/line-items-editor';
import { createQuotationAction, updateQuotationAction, type ActionState } from './actions';
import { draftQuotationItemsAction } from './ai-actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };
type DraftMeta = { assumptions: string[]; flags: string[]; basis: string[] };

export type QuotationInitial = {
  customerId: string; docDate: string; validityDays: number; terms: string; notes: string;
  rows: LineRow[]; columnDefs?: ColumnDef[];
};

function AiDraftCard({
  customerId, onDraft,
}: {
  customerId: string;
  onDraft: (rows: LineRow[], terms: string[], meta: DraftMeta) => void;
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
          ...emptyRow(),
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
        <span className="text-[0.65rem] text-faint">proposes items &amp; rates from your quote history — you review everything</span>
      </div>
      <textarea
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        rows={2}
        className="field mt-1"
        placeholder="Describe the job… e.g. Progressive press tool for 1mm CRCA bracket, 4 stations, ~50k strokes/month + 500 pcs initial production"
      />
      <div className="flex items-center gap-3 mt-2">
        <button type="button" onClick={run} disabled={pending || requirement.trim().length < 10} className="btn-primary text-xs disabled:opacity-50">
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
  mode = 'create',
  quotationId,
  initial,
  defaultCustomerId = '',
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultTerms: string;
  aiEnabled: boolean;
  mode?: 'create' | 'edit';
  quotationId?: string;
  initial?: QuotationInitial;
  defaultCustomerId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(mode === 'edit' ? updateQuotationAction : createQuotationAction, {});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId);
  const [rows, setRows] = useState<LineRow[]>(initial?.rows?.length ? initial.rows : [emptyRow()]);
  const [columns, setColumns] = useState<ColumnDef[]>(initial?.columnDefs ?? []);
  const [terms, setTerms] = useState(initial?.terms ?? defaultTerms);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [undoRows, setUndoRows] = useState<LineRow[] | null>(null);
  const [suggestedTerms, setSuggestedTerms] = useState<string[] | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const items = useMemo(() => serializeItems(rows, columns), [rows, columns]);
  const totals = useMemo(() => computeGst(items, interstate), [items, interstate]);
  const savable = items.length;

  const applyDraft = (drafted: LineRow[], termsSuggestion: string[], meta: DraftMeta) => {
    setUndoRows(rows.some((r) => r.description.trim()) ? rows : null);
    setRows(drafted.length ? drafted : [emptyRow()]);
    setDraftMeta(meta);
    if (termsSuggestion.length) {
      if (!terms.trim()) setTerms(termsSuggestion.join('\n'));
      else setSuggestedTerms(termsSuggestion);
    }
  };

  const itemsJson = JSON.stringify(items);
  const columnDefsJson = JSON.stringify(columns);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="columnDefs" value={columnDefsJson} />
      {mode === 'edit' && <input type="hidden" name="id" value={quotationId} />}

      <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {mode === 'edit' ? (
          <div className="col-span-2">
            <label className="label">Customer</label>
            <input type="hidden" name="customerId" value={customerId} />
            <div className="field bg-surface-2 text-muted">{cust?.name ?? '—'}</div>
          </div>
        ) : (
          <div className="col-span-2">
            <label className="label">Customer *</label>
            <select name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="field">
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.stateCode ? ` — state ${c.stateCode}` : ''}</option>)}
            </select>
          </div>
        )}
        <div><label className="label">Date *</label><input name="docDate" type="date" defaultValue={initial?.docDate ?? today} required className="field" /></div>
        <div><label className="label">Validity (days)</label><input name="validityDays" type="number" min={1} defaultValue={initial?.validityDays ?? 15} className="field" /></div>
      </div>

      {aiEnabled && mode === 'create' && <AiDraftCard customerId={customerId} onDraft={applyDraft} />}

      {draftMeta && (
        <div className="border border-accent/40 bg-accent-soft/30 rounded-lg p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-mono uppercase tracking-wider text-accent text-[0.65rem]">AI draft applied — review every line before saving</div>
            <div className="flex gap-3">
              {undoRows && (
                <button type="button" className="text-steel hover:underline" onClick={() => { setRows(undoRows); setUndoRows(null); setDraftMeta(null); }}>Undo</button>
              )}
              <button type="button" className="text-muted hover:underline" onClick={() => setDraftMeta(null)}>Dismiss</button>
            </div>
          </div>
          {draftMeta.flags.length > 0 && <ul className="space-y-1">{draftMeta.flags.map((f, i) => <li key={i} className="text-crit">⚑ {f}</li>)}</ul>}
          {draftMeta.assumptions.length > 0 && <ul className="space-y-0.5 text-muted">{draftMeta.assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul>}
          {draftMeta.basis.length > 0 && (
            <details>
              <summary className="cursor-pointer text-faint">Rate basis per line</summary>
              <ul className="mt-1 space-y-0.5 text-muted">{draftMeta.basis.map((b, i) => <li key={i}>{i + 1}. {b}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} tooling />

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
          <AiPolishButton kind="terms" docType="quotation" value={terms} onApply={setTerms} enabled={aiEnabled}
            context={cust ? `Customer: ${cust.name}. ${savable} line items.` : undefined} />

          <div className="mt-4">
            <label className="label">Notes <span className="font-normal text-faint">(optional — printed on the quotation)</span></label>
            <textarea name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="e.g. Prices valid subject to final drawing approval." />
            <AiPolishButton kind="notes" docType="quotation" value={notes} onApply={setNotes} enabled={aiEnabled} context={cust ? `Customer: ${cust.name}.` : undefined} />
          </div>
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
        <SubmitButton className="btn-primary">{mode === 'edit' ? 'Save changes' : 'Create quotation'}</SubmitButton>
        <span className="text-xs text-faint">{savable} line{savable === 1 ? '' : 's'} will be saved</span>
      </div>
    </form>
  );
}
