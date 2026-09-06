'use client';
import { useActionState, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import {
  computeGst, isInterstate,
  ORDER_CATEGORIES, ORDER_CATEGORY_LABELS, MATERIAL_OWNERSHIP, MATERIAL_OWNERSHIP_LABELS, type ColumnDef,
} from '@ms/core';
import {
  LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, itemWarnings, focusIssue, type LineRow,
} from '@/components/line-items-editor';
import { useFormDraft } from '@/components/use-form-draft';
import {
  CustomerSelect, DraftBanner, TotalsCard, IssuesBox, WarningsBox, ServerError, SaveBar,
} from '@/components/document-form-parts';
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
  const pathname = usePathname();
  const [state, action] = useActionState<ActionState, FormData>(mode === 'edit' ? updateOrderAction : createOrderAction, {});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId);
  const [rows, setRowsRaw] = useState<LineRow[]>(initial?.rows?.length ? initial.rows : [emptyRow(undefined, 'r-first')]);
  const [columns, setColumnsRaw] = useState<ColumnDef[]>(initial?.columnDefs ?? []);
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
  const draftKey = mode === 'edit' && orderId ? `order:${orderId}` : 'order:new';
  const draftSnapshot = useMemo(
    () => ({ customerId, customerName: cust?.name ?? null, rows, columns }),
    [customerId, cust?.name, rows, columns],
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

  const saveLabel = warnings.length && warnAck ? 'Save anyway' : mode === 'edit' ? 'Save changes' : 'Save order';

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="columnDefs" value={columnDefsJson} />
      {mode === 'edit' && <input type="hidden" name="id" value={orderId} />}

      {showRestore && draft && (
        <DraftBanner
          doc="order" customerName={draft.customerName} savedAt={savedAt}
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
          <label htmlFor="docDate" className="label">Order date *</label>
          <input id="docDate" name="docDate" type="date" defaultValue={initial?.docDate ?? today} required className="field" />
        </div>
        <div>
          <label htmlFor="deliveryDate" className="label">Delivery date</label>
          <input id="deliveryDate" name="deliveryDate" type="date" defaultValue={initial?.deliveryDate ?? ''} className="field" />
        </div>
        <div className="col-span-2">
          <label htmlFor="poRef" className="label">Customer PO no.</label>
          <input id="poRef" name="poRef" defaultValue={initial?.poRef ?? ''} className="field" placeholder="e.g. PO/2026/118 (optional)" maxLength={40} />
        </div>
        <div>
          <label htmlFor="orderCategory" className="label">Order type</label>
          <select id="orderCategory" name="orderCategory" defaultValue={initial?.orderCategory ?? 'tool_build'} className="field">
            {ORDER_CATEGORIES.map((c) => <option key={c} value={c}>{ORDER_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="materialOwnership" className="label">Material</label>
          <select id="materialOwnership" name="materialOwnership" defaultValue={initial?.materialOwnership ?? 'customer'} className="field">
            {MATERIAL_OWNERSHIP.map((m) => <option key={m} value={m}>{MATERIAL_OWNERSHIP_LABELS[m]}</option>)}
          </select>
        </div>
      </div>

      <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} showIssues={showIssues} />

      <div className="flex flex-col md:flex-row md:justify-end gap-4">
        <TotalsCard totals={totals} gstRates={items.map((i) => i.gstRate)} interstate={interstate} hasCustomer={!!cust}
          supplierStateCode={supplierStateCode} estimate />
      </div>

      {showIssues && <IssuesBox issues={issues} />}
      {showIssues && <div ref={warnRef}><WarningsBox warnings={warnings} acknowledged={warnAck} /></div>}
      <ServerError message={state.error} />
      <SaveBar total={totals.grand} label={saveLabel} hint={`${savable} ${savable === 1 ? 'item' : 'items'} will be saved`} />
    </form>
  );
}
