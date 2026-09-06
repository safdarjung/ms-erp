'use client';
import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { computeGst, isInterstate, type ColumnDef } from '@ms/core';
import { AiPolishButton } from '@/components/ai-polish-button';
import {
  LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, itemWarnings, rowsFromStored, focusIssue, type LineRow,
} from '@/components/line-items-editor';
import { draftToStored } from '@/lib/quote-draft-rows';
import { useFormDraft } from '@/components/use-form-draft';
import {
  CustomerSelect, DraftBanner, TotalsCard, IssuesBox, WarningsBox, ServerError, TermsField, SaveBar,
} from '@/components/document-form-parts';
import { createQuotationAction, updateQuotationAction, type ActionState } from './actions';
import { draftQuotationItemsAction } from './ai-actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };
type DraftMeta = { assumptions: string[]; flags: string[]; basis: string[] };

export type QuotationInitial = {
  customerId: string; docDate: string; validityDays: number; terms: string; notes: string;
  rows: LineRow[]; columnDefs?: ColumnDef[];
};

function AiFillCard({ customerId, columns, onDraft }: {
  customerId: string;
  columns: ColumnDef[];
  onDraft: (rows: LineRow[], columns: ColumnDef[], terms: string[], meta: DraftMeta) => void;
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
      // The model names each item's specs ("Material: D2"); draftToStored folds
      // them into the document's extra fields (reusing one that already has the
      // name) with the same rule the assistant's own edits use.
      const mapped = (() => {
        try { return draftToStored(d.items, columns); } catch { return null; }
      })();
      if (!mapped) {
        setError('That job needs more extra fields than one document can hold — remove a field and try again.');
        return;
      }
      onDraft(
        // Rebuild grouped rows so dies land under their part heading (groupLabel)
        // and the part's detail (groupNote) sits on every row of that part.
        rowsFromStored(mapped.stored),
        mapped.columns,
        d.termsSuggestion,
        { assumptions: d.assumptions, flags: d.flags, basis: d.items.map((it) => it.basis).filter(Boolean) },
      );
    });

  return (
    <div className="card p-4 border-accent/30">
      <div className="flex items-center gap-2">
        <span className="text-accent" aria-hidden>✦</span>
        <label htmlFor="ai-requirement" className="font-medium text-sm">Fill items with AI</label>
      </div>
      <p className="text-xs text-muted mt-0.5 mb-1">Type the parts, dies and prices — AI fills the table; you check it before saving.</p>
      <textarea
        id="ai-requirement"
        aria-label="Parts, dies and prices for AI to fill in"
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        rows={4}
        className="field mt-1"
        placeholder={'e.g.\nPart 30017AW1002: blanking die 30000, bending die 16000\nPart 41928: blanking & punching die 55000, bending die 20000\n\n…or describe the job in your own words.'}
      />
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button type="button" onClick={run} disabled={pending || requirement.trim().length < 10} aria-busy={pending} className="btn-primary text-xs disabled:opacity-50">
          {pending ? 'Filling…' : '✦ Fill the table'}
        </button>
        {pending && <span className="text-xs text-muted animate-pulse">Looking at your past quotations…</span>}
        {error && <span role="alert" className="text-xs text-crit">{error}</span>}
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
  const pathname = usePathname();
  const [state, action] = useActionState<ActionState, FormData>(mode === 'edit' ? updateQuotationAction : createQuotationAction, {});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId);
  const [rows, setRowsRaw] = useState<LineRow[]>(initial?.rows?.length ? initial.rows : [emptyRow(undefined, 'r-first')]);
  const [columns, setColumnsRaw] = useState<ColumnDef[]>(initial?.columnDefs ?? []);
  const [terms, setTerms] = useState(initial?.terms ?? defaultTerms);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [undoRows, setUndoRows] = useState<LineRow[] | null>(null);
  const [undoCols, setUndoCols] = useState<ColumnDef[] | null>(null);
  const [suggestedTerms, setSuggestedTerms] = useState<string[] | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [warnAck, setWarnAck] = useState(false);
  const warnRef = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  // Any edit to the table counts as "touched" (issues may show) and resets a "Save anyway".
  const setRows: Dispatch<SetStateAction<LineRow[]>> = (u) => { setTouched(true); setWarnAck(false); setRowsRaw(u); };
  const setColumns: Dispatch<SetStateAction<ColumnDef[]>> = (u) => { setTouched(true); setColumnsRaw(u); };

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const items = useMemo(() => serializeItems(rows, columns), [rows, columns]);
  const totals = useMemo(() => computeGst(items, interstate), [items, interstate]);
  const cleanCols = useMemo(() => cleanColumns(columns), [columns]);
  const issues = useMemo(() => itemIssues(rows, columns), [rows, columns]);
  const warnings = useMemo(() => itemWarnings(rows), [rows]);
  const showIssues = touched || submitAttempted;
  const savable = items.length;

  // Draft safety-net — a heavy edit survives a refresh / crash / accidental nav.
  // Not cleared on submit: the detail page clears it once the save is confirmed.
  const draftKey = mode === 'edit' && quotationId ? `quotation:${quotationId}` : 'quotation:new';
  const draftSnapshot = useMemo(
    () => ({ customerId, customerName: cust?.name ?? null, rows, columns, terms, notes }),
    [customerId, cust?.name, rows, columns, terms, notes],
  );
  const { draft, savedAt, save: saveDraft, clear: clearDraft } = useFormDraft(draftKey, draftSnapshot);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const showRestore = !draftDismissed && !!draft
    && ((draft.rows?.some((r) => r.description?.trim()) ?? false) || (draft.columns?.length ?? 0) > 0);
  const restoreDraft = () => {
    if (!draft) return;
    setCustomerId(draft.customerId ?? '');
    setRowsRaw(draft.rows?.length ? draft.rows : [emptyRow()]);
    setColumnsRaw(draft.columns ?? []);
    setTerms(draft.terms ?? '');
    setNotes(draft.notes ?? '');
    setDraftDismissed(true);
  };
  const discardDraft = () => { clearDraft(); setDraftDismissed(true); };
  useEffect(() => { if (state.error) saveDraft(); }, [state.error, saveDraft]); // keep the work safe after a failed save

  // `draftedCols` is the whole field list — the document's own fields plus any
  // the draft's specs added.
  const applyDraft = (drafted: LineRow[], draftedCols: ColumnDef[], termsSuggestion: string[], meta: DraftMeta) => {
    const colsGrew = draftedCols.length > columns.length;
    setUndoRows(rows.some((r) => r.description.trim()) ? rows : null);
    setUndoCols(colsGrew ? columns : null);
    setRows(drafted.length ? drafted : [emptyRow()]);
    if (colsGrew) setColumns(draftedCols);
    setDraftMeta(meta);
    if (termsSuggestion.length) {
      if (!terms.trim()) setTerms(termsSuggestion.join('\n'));
      else setSuggestedTerms(termsSuggestion);
    }
  };

  const itemsJson = JSON.stringify(items);
  const columnDefsJson = JSON.stringify(cleanCols);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    setSubmitAttempted(true);
    if (issues.length) { e.preventDefault(); focusIssue(issues[0]!); return; }
    if (warnings.length && !warnAck) {
      e.preventDefault();
      setWarnAck(true);
      setTimeout(() => warnRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
    }
  };

  const saveLabel = warnings.length && warnAck ? 'Save anyway' : mode === 'edit' ? 'Save changes' : 'Save quotation';

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="columnDefs" value={columnDefsJson} />
      {mode === 'edit' && <input type="hidden" name="id" value={quotationId} />}

      {showRestore && draft && (
        <DraftBanner
          doc="quotation" customerName={draft.customerName} savedAt={savedAt}
          mismatch={mode === 'create' && !!defaultCustomerId && !!draft.customerId && draft.customerId !== defaultCustomerId}
          onContinue={restoreDraft} onFresh={discardDraft}
        />
      )}

      <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {mode === 'edit' ? (
          <div className="col-span-2">
            <span className="label">Customer</span>
            <input type="hidden" name="customerId" value={customerId} />
            <div className="field bg-surface-2 text-muted">{cust?.name ?? '—'}</div>
          </div>
        ) : (
          <CustomerSelect customers={customers} value={customerId} onChange={setCustomerId} returnTo={pathname} />
        )}
        <div>
          <label htmlFor="docDate" className="label">Date *</label>
          <input id="docDate" name="docDate" type="date" defaultValue={initial?.docDate ?? today} required className="field" />
        </div>
        <div>
          <label htmlFor="validityDays" className="label">Valid for (days)</label>
          <input id="validityDays" name="validityDays" type="number" min={1} max={365} inputMode="numeric"
            defaultValue={initial?.validityDays ?? 15} className="field" aria-describedby="validity-help" />
          <p id="validity-help" className="text-xs text-muted mt-1">Customer must accept within this time</p>
        </div>
      </div>

      {aiEnabled && mode === 'create' && <AiFillCard customerId={customerId} columns={columns} onDraft={applyDraft} />}

      {draftMeta && (
        <div role="status" className="border border-accent/40 bg-accent-soft/30 rounded-lg p-4 text-xs space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-medium text-accent">AI filled these lines — please check each one</div>
            <div className="flex gap-3">
              {undoRows && (
                <button type="button" className="text-steel hover:underline"
                  onClick={() => {
                    setRows(undoRows); setUndoRows(null);
                    if (undoCols) { setColumns(undoCols); setUndoCols(null); }
                    setDraftMeta(null);
                  }}>Undo</button>
              )}
              <button type="button" className="text-muted hover:underline" onClick={() => setDraftMeta(null)}>Dismiss</button>
            </div>
          </div>
          {draftMeta.flags.length > 0 && <ul className="space-y-1">{draftMeta.flags.map((f, i) => <li key={i} className="text-crit">⚑ {f}</li>)}</ul>}
          {draftMeta.assumptions.length > 0 && <ul className="space-y-0.5 text-muted">{draftMeta.assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul>}
          {draftMeta.basis.length > 0 && (
            <details className="reveal">
              <summary className="cursor-pointer text-muted"><span className="chev" aria-hidden>▸</span> Where these prices came from</summary>
              <ul className="mt-1 space-y-0.5 text-muted">{draftMeta.basis.map((b, i) => <li key={i}>{i + 1}. {b}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} tooling showIssues={showIssues} />

      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1 min-w-0">
          <TermsField value={terms} defaultTerms={defaultTerms} onChange={setTerms}>
            {suggestedTerms && (
              <div className="mt-1.5 text-xs">
                <button type="button" className="text-accent hover:underline" onClick={() => { setTerms(suggestedTerms.join('\n')); setSuggestedTerms(null); }}>
                  ✦ Use the terms AI suggested for this job
                </button>
              </div>
            )}
            <AiPolishButton kind="terms" docType="quotation" value={terms} onApply={setTerms} enabled={aiEnabled}
              context={cust ? `Customer: ${cust.name}. ${savable} line items.` : undefined} />
          </TermsField>

          <div className="mt-4">
            <label htmlFor="notes" className="label">Notes <span className="font-normal text-muted">(optional — printed on the quotation)</span></label>
            <textarea id="notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="e.g. Prices valid subject to final drawing approval." />
            <AiPolishButton kind="notes" docType="quotation" value={notes} onApply={setNotes} enabled={aiEnabled} context={cust ? `Customer: ${cust.name}.` : undefined} />
          </div>
        </div>
        <TotalsCard totals={totals} gstRates={items.map((i) => i.gstRate)} interstate={interstate} hasCustomer={!!cust} supplierStateCode={supplierStateCode} />
      </div>

      {showIssues && <IssuesBox issues={issues} />}
      {showIssues && <div ref={warnRef}><WarningsBox warnings={warnings} acknowledged={warnAck} /></div>}
      <ServerError message={state.error} />
      <SaveBar total={totals.grand} label={saveLabel} hint={`${savable} ${savable === 1 ? 'item' : 'items'} will be saved`} />
    </form>
  );
}
