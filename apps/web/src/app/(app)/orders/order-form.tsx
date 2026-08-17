'use client';
import { useActionState, useMemo, useState, type FormEvent } from 'react';
import {
  computeGst, isInterstate, formatINR,
  ORDER_CATEGORIES, ORDER_CATEGORY_LABELS, MATERIAL_OWNERSHIP, MATERIAL_OWNERSHIP_LABELS, type ColumnDef,
} from '@ms/core';
import { SubmitButton } from '@/components/submit-button';
import { LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, type LineRow } from '@/components/line-items-editor';
import { useFormDraft } from '@/components/use-form-draft';
import { createOrderAction, updateOrderAction, type ActionState } from './actions';

type Cust = { id: string; name: string; stateCode: string | null; gstin: string | null };

export type OrderInitial = {
  customerId: string; docDate: string; poRef: string; orderCategory: string;
  materialOwnership: string; deliveryDate: string; rows: LineRow[]; columnDefs?: ColumnDef[];
};

export function OrderForm({
  customers, supplierStateCode, defaultCustomerId = '', mode = 'create', orderId, initial,
}: {
  customers: Cust[];
  supplierStateCode: string;
  defaultCustomerId?: string;
  mode?: 'create' | 'edit';
  orderId?: string;
  initial?: OrderInitial;
}) {
  const [state, action] = useActionState<ActionState, FormData>(mode === 'edit' ? updateOrderAction : createOrderAction, {});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId);
  const [rows, setRows] = useState<LineRow[]>(initial?.rows?.length ? initial.rows : [emptyRow()]);
  const [columns, setColumns] = useState<ColumnDef[]>(initial?.columnDefs ?? []);
  const today = new Date().toISOString().slice(0, 10);

  const cust = customers.find((c) => c.id === customerId);
  const interstate = isInterstate(supplierStateCode, cust?.stateCode);
  const items = useMemo(() => serializeItems(rows, columns), [rows, columns]);
  const totals = useMemo(() => computeGst(items, interstate), [items, interstate]);
  const cleanCols = useMemo(() => cleanColumns(columns), [columns]);
  const issues = useMemo(() => itemIssues(rows), [rows]);
  const savable = items.length;

  const draftKey = mode === 'edit' && orderId ? `order:${orderId}` : 'order:new';
  const draftSnapshot = useMemo(() => ({ customerId, rows, columns }), [customerId, rows, columns]);
  const { draft, clear: clearDraft } = useFormDraft(draftKey, draftSnapshot);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const showRestore = !draftDismissed && !!draft
    && ((draft.rows?.some((r) => r.description?.trim()) ?? false) || (draft.columns?.length ?? 0) > 0);
  const restoreDraft = () => {
    if (!draft) return;
    setCustomerId(draft.customerId ?? '');
    setRows(draft.rows?.length ? draft.rows : [emptyRow()]);
    setColumns(draft.columns ?? []);
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
      {mode === 'edit' && <input type="hidden" name="id" value={orderId} />}

      {showRestore && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-2.5 text-sm">
          <span aria-hidden>💾</span>
          <span className="flex-1 min-w-0">You have an unsaved draft of this order from earlier.</span>
          <button type="button" onClick={restoreDraft} className="btn-primary text-xs !py-1">Restore it</button>
          <button type="button" onClick={discardDraft} className="text-muted text-xs hover:underline">Discard</button>
        </div>
      )}

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
        <div><label className="label">Order date *</label><input name="docDate" type="date" defaultValue={initial?.docDate ?? today} required className="field" /></div>
        <div><label className="label">Delivery date</label><input name="deliveryDate" type="date" defaultValue={initial?.deliveryDate ?? ''} className="field" /></div>
        <div className="col-span-2 md:col-span-2">
          <label className="label">Customer PO ref</label>
          <input name="poRef" defaultValue={initial?.poRef ?? ''} className="field" placeholder="PO number / reference" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="orderCategory" defaultValue={initial?.orderCategory ?? 'tool_build'} className="field">
            {ORDER_CATEGORIES.map((c) => <option key={c} value={c}>{ORDER_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Material</label>
          <select name="materialOwnership" defaultValue={initial?.materialOwnership ?? 'customer'} className="field">
            {MATERIAL_OWNERSHIP.map((m) => <option key={m} value={m}>{MATERIAL_OWNERSHIP_LABELS[m]}</option>)}
          </select>
        </div>
      </div>

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} />

      <div className="flex flex-col md:flex-row md:justify-end gap-4">
        <div className="card p-4 w-full md:w-72 text-sm self-start">
          <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mb-2">Order value</div>
          <div className="flex justify-between py-1"><span className="text-muted">Taxable</span><span className="tabular-nums font-mono">{formatINR(totals.subtotal)}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted">GST (est.)</span><span className="tabular-nums font-mono">{formatINR(totals.taxTotal)}</span></div>
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total (est.)</span><span className="tabular-nums font-mono">{formatINR(totals.grand)}</span></div>
          <div className="text-xs text-faint mt-1">{cust ? (interstate ? 'Inter-state → IGST at invoice' : 'Intra-state → CGST + SGST at invoice') : 'GST is finalised on the invoice'}</div>
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
        <SubmitButton className="btn-primary" disabled={issues.length > 0}>{mode === 'edit' ? 'Save changes' : 'Create order'}</SubmitButton>
        <span className="text-xs text-faint">{savable} line{savable === 1 ? '' : 's'} will be saved</span>
      </div>
    </form>
  );
}
