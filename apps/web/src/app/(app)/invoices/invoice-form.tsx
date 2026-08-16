'use client';
import { useActionState, useMemo, useState, type FormEvent } from 'react';
import { computeGst, isInterstate, formatINR, type ColumnDef } from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { AiPolishButton } from '@/components/ai-polish-button';
import { LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, type LineRow } from '@/components/line-items-editor';
import { useFormDraft } from '@/components/use-form-draft';
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
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [terms, setTerms] = useState(defaultTerms);
  const today = new Date().toISOString().slice(0, 10);

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const items = useMemo(() => serializeItems(rows, columns), [rows, columns]);
  const totals = useMemo(() => computeGst(items, interstate), [items, interstate]);
  const cleanCols = useMemo(() => cleanColumns(columns), [columns]);
  const issues = useMemo(() => itemIssues(rows), [rows]);
  const savable = items.length;

  const draftSnapshot = useMemo(() => ({ customerId, rows, columns, terms }), [customerId, rows, columns, terms]);
  const { draft, clear: clearDraft } = useFormDraft('invoice:new', draftSnapshot);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const showRestore = !draftDismissed && !!draft
    && ((draft.rows?.some((r) => r.description?.trim()) ?? false) || (draft.columns?.length ?? 0) > 0);
  const restoreDraft = () => {
    if (!draft) return;
    setCustomerId(draft.customerId ?? '');
    setRows(draft.rows?.length ? draft.rows : [emptyRow()]);
    setColumns(draft.columns ?? []);
    setTerms(draft.terms ?? '');
    setDraftDismissed(true);
  };
  const discardDraft = () => { clearDraft(); setDraftDismissed(true); };

  const itemsJson = JSON.stringify(items);
  const columnDefsJson = JSON.stringify(cleanCols);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (issues.length) { e.preventDefault(); return; }
    clearDraft();
  };

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="columnDefs" value={columnDefsJson} />

      {showRestore && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-2.5 text-sm">
          <span aria-hidden>💾</span>
          <span className="flex-1 min-w-0">You have an unsaved draft of this invoice from earlier.</span>
          <button type="button" onClick={restoreDraft} className="btn-primary text-xs !py-1">Restore it</button>
          <button type="button" onClick={discardDraft} className="text-muted text-xs hover:underline">Discard</button>
        </div>
      )}

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

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} />

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

      {issues.length > 0 && (
        <div className="rounded-lg border border-crit/40 bg-[#f6e5e1]/40 px-4 py-2.5 text-sm">
          <div className="font-medium text-crit mb-1">Fix {issues.length === 1 ? 'this' : 'these'} before saving:</div>
          <ul className="list-disc pl-5 text-crit/90 space-y-0.5">
            {issues.map((iss, i) => <li key={i}>{iss.message}</li>)}
          </ul>
        </div>
      )}
      {state.error && (
        <div className="rounded-lg border border-crit/50 bg-[#f6e5e1]/60 px-4 py-2.5 text-sm text-crit">
          <b>Couldn’t save:</b> {state.error} <span className="text-crit/70">— your entries are still here; fix and try again.</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary" disabled={issues.length > 0}>Create invoice</SubmitButton>
        <span className="text-xs text-faint">{savable} line{savable === 1 ? '' : 's'} will be saved</span>
      </div>
    </form>
  );
}
