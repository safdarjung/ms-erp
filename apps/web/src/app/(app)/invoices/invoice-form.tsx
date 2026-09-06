'use client';
import { useActionState, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { computeGst, isInterstate, type ColumnDef } from '@ms/core';
import { AiPolishButton } from '@/components/ai-polish-button';
import {
  LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, itemWarnings, focusIssue, type LineRow,
} from '@/components/line-items-editor';
import { useFormDraft } from '@/components/use-form-draft';
import {
  CustomerSelect, DraftBanner, TotalsCard, IssuesBox, WarningsBox, ServerError, TermsField, SaveBar,
} from '@/components/document-form-parts';
import { createInvoiceAction, updateInvoiceAction, type ActionState } from './actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };

export type InvoiceInitial = {
  customerId: string; docDate: string; poRef: string; terms: string; notes?: string; rows: LineRow[]; columnDefs?: ColumnDef[];
};

export function InvoiceForm({
  customers,
  supplierStateCode,
  defaultTerms,
  aiEnabled,
  defaultCustomerId = '',
  mode = 'create',
  invoiceId,
  initial,
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultTerms: string;
  aiEnabled: boolean;
  defaultCustomerId?: string;
  mode?: 'create' | 'edit';
  invoiceId?: string;
  initial?: InvoiceInitial;
}) {
  const pathname = usePathname();
  const [state, action] = useActionState<ActionState, FormData>(mode === 'edit' ? updateInvoiceAction : createInvoiceAction, {});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId);
  const [rows, setRowsRaw] = useState<LineRow[]>(initial?.rows?.length ? initial.rows : [emptyRow(undefined, 'r-first')]);
  const [columns, setColumnsRaw] = useState<ColumnDef[]>(initial?.columnDefs ?? []);
  const [terms, setTerms] = useState(initial?.terms ?? defaultTerms);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [touched, setTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [warnAck, setWarnAck] = useState(false);
  const warnRef = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);

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

  // Draft safety-net — not cleared on submit; the detail page clears it once the save is confirmed.
  const draftKey = mode === 'edit' && invoiceId ? `invoice:${invoiceId}` : 'invoice:new';
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
  useEffect(() => { if (state.error) saveDraft(); }, [state.error, saveDraft]);

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

  const saveLabel = warnings.length && warnAck ? 'Save anyway' : mode === 'edit' ? 'Save changes' : 'Save bill';

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="columnDefs" value={columnDefsJson} />
      {mode === 'edit' && <input type="hidden" name="id" value={invoiceId} />}

      {showRestore && draft && (
        <DraftBanner
          doc="bill" customerName={draft.customerName} savedAt={savedAt}
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
          <label htmlFor="poRef" className="label">Customer PO no.</label>
          <input id="poRef" name="poRef" defaultValue={initial?.poRef ?? ''} className="field" placeholder="e.g. PO/2026/118 (optional)" maxLength={40} />
        </div>
      </div>

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} showIssues={showIssues} />

      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1 min-w-0">
          <TermsField value={terms} defaultTerms={defaultTerms} onChange={setTerms}>
            <AiPolishButton kind="terms" docType="invoice" value={terms} onApply={setTerms} enabled={aiEnabled}
              context={cust ? `Customer: ${cust.name}.` : undefined} />
          </TermsField>
          <div className="mt-4">
            <label htmlFor="notes" className="label">Notes <span className="font-normal text-muted">(optional — printed on the bill)</span></label>
            <textarea id="notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="e.g. Goods dispatched via Safexpress, LR no. 4471." />
            <AiPolishButton kind="notes" docType="invoice" value={notes} onApply={setNotes} enabled={aiEnabled} context={cust ? `Customer: ${cust.name}.` : undefined} />
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
