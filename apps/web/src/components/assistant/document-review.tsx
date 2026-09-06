'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MATERIAL_OWNERSHIP_LABELS, ORDER_CATEGORY_LABELS, type ColumnDef } from '@ms/core';
import {
  LineItemsEditor, emptyRow, serializeItems, cleanColumns, itemIssues, rowsFromStored, type LineRow,
} from '@/components/line-items-editor';
import { DocPreview, DocTotals, type PreviewDocMeta, type PreviewLine } from './doc-preview';

// Full-width "Check or change the lines" for a document the assistant proposed:
// the SAME grouped line-items editor the manual forms use (parts, custom
// columns, one-time charge flag), the header fields, terms/notes and live GST
// totals. Rendered through a portal — the assistant drawer is transformed, so
// a fixed modal inside it would be clipped to the drawer's width.

export type ReviewField = { key: string; label: string; type: 'text' | 'number' | 'date' | 'textarea' | 'select'; options?: string[] };
export type ReviewItem = PreviewLine & { hsn?: string; groupNote?: string };

const KIND_LABEL: Record<PreviewDocMeta['type'], string> = { quotation: 'Quotation', invoice: 'Bill (tax invoice)', order: 'Order' };
const CREATE_LABEL: Record<PreviewDocMeta['type'], string> = {
  quotation: 'Yes, create quotation', invoice: 'Yes, create bill', order: 'Yes, create order',
};
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Icon-only controls keep a 44px hit area on phones. */
const HIT = 'min-h-11 min-w-11 inline-flex items-center justify-center';

/** Select options shown by their plain label, never the stored key. */
function optionLabel(fieldKey: string, value: string): string {
  if (fieldKey === 'orderCategory') return ORDER_CATEGORY_LABELS[value as keyof typeof ORDER_CATEGORY_LABELS] ?? value;
  if (fieldKey === 'materialOwnership') return MATERIAL_OWNERSHIP_LABELS[value as keyof typeof MATERIAL_OWNERSHIP_LABELS] ?? value;
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function DocumentReviewModal({
  title, doc, fields, payload, items, warning, busy, onConfirm, onClose,
}: {
  title: string;
  doc: PreviewDocMeta;
  fields: ReviewField[];
  payload: Record<string, unknown>;
  items: ReviewItem[];
  warning?: string;
  busy: boolean;
  /** The user's edited payload — goes through the same server checks as the proposal. */
  onConfirm: (edited: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const fld of fields) f[fld.key] = payload[fld.key] == null ? '' : String(payload[fld.key]);
    return f;
  });
  const [rows, setRows] = useState<LineRow[]>(() => {
    const rs = rowsFromStored(items.map((it) => ({
      description: it.description, hsn: it.hsn ?? null, qty: it.qty, uom: it.uom ?? 'NOS', rate: it.rate, gstRate: it.gstRate,
      isToolingCharge: it.isToolingCharge, groupLabel: it.groupLabel ?? null, groupNote: it.groupNote ?? null,
      attributes: it.attributes ?? {},
    })));
    return rs.length ? rs : [emptyRow()];
  });
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    const cd = payload.columnDefs;
    if (!Array.isArray(cd)) return [];
    return cd.map((c) => {
      const col = c as ColumnDef;
      const display = col.display === 'column' || col.display === 'spec' ? col.display : undefined;
      return { id: String(col.id), label: String(col.label), ...(display ? { display } : {}) };
    });
  });
  const [askDiscard, setAskDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const serialized = useMemo(() => serializeItems(rows, columns), [rows, columns]);
  const cleanCols = useMemo(() => {
    const chosen = new Map(columns.map((c) => [c.id, c.display] as const));
    return cleanColumns(columns).map((c) => {
      const display = c.display ?? chosen.get(c.id);
      return display ? { ...c, display } : c;
    });
  }, [columns]);
  const issues = useMemo(() => itemIssues(rows, columns), [rows, columns]);
  const previewLines: PreviewLine[] = useMemo(() => serialized.map((it) => ({
    description: it.description, hsn: it.hsn, qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate,
    isToolingCharge: doc.tooling ? it.isToolingCharge : undefined, groupLabel: it.groupLabel, groupNote: it.groupNote,
    attributes: it.attributes,
  })), [serialized, doc.tooling]);

  // "Did they change anything?" — compared against what the editor opened with,
  // so Back / ✕ / backdrop can ask before throwing edits away.
  const snapshot = useMemo(() => JSON.stringify({ form, serialized, cleanCols }), [form, serialized, cleanCols]);
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;

  // Lock the page behind the modal, move focus inside, and hand it back to the
  // element that opened the editor when it closes.
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = dialogRef.current;
    const first = root?.querySelector<HTMLElement>('input, select, textarea') ?? root?.querySelector<HTMLElement>('[data-close]');
    const t = setTimeout(() => first?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (askDiscard) keepRef.current?.focus();
  }, [askDiscard]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  // Keep Tab inside the dialog; Escape asks before discarding edits.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (askDiscard) setAskDiscard(false);
      else requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const scope = askDiscard ? root.querySelector<HTMLElement>('[data-discard]') ?? root : root;
    const focusables = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !scope.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !scope.contains(active))) { e.preventDefault(); first.focus(); }
  };

  const confirm = () => {
    if (issues.length) return;
    const edited: Record<string, unknown> = { ...payload, ...form };
    edited.items = serialized.map((it) => ({
      description: it.description, hsn: it.hsn, qty: it.qty, uom: it.uom, rate: it.rate, gstRate: it.gstRate,
      ...(doc.tooling ? { isToolingCharge: it.isToolingCharge } : {}),
      ...(it.groupLabel ? { groupLabel: it.groupLabel, ...(it.groupNote ? { groupNote: it.groupNote } : {}) } : {}),
      attributes: it.attributes,
    }));
    edited.columnDefs = cleanCols;
    onConfirm(edited);
  };

  const field = (fld: ReviewField) => {
    const v = form[fld.key] ?? '';
    const set = (val: string) => setForm((f) => ({ ...f, [fld.key]: val }));
    if (fld.type === 'textarea') {
      return <textarea value={v} onChange={(e) => set(e.target.value)} rows={fld.key === 'terms' ? 6 : 2} className="field" />;
    }
    if (fld.type === 'select') {
      return (
        <select value={v} onChange={(e) => set(e.target.value)} className="field">
          {(fld.options ?? []).map((o) => <option key={o} value={o}>{optionLabel(fld.key, o)}</option>)}
        </select>
      );
    }
    return (
      <input type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'} value={v}
        onChange={(e) => set(e.target.value)} className="field" inputMode={fld.type === 'number' ? 'decimal' : undefined} />
    );
  };
  const scalarFields = fields.filter((f) => f.type !== 'textarea');
  const proseFields = fields.filter((f) => f.type === 'textarea');
  const primaryLabel = busy ? 'Saving…' : doc.number ? 'Yes, save changes' : CREATE_LABEL[doc.type];

  const tabs = (cls: string) => (
    <div className={`rounded-lg border border-line bg-surface-2 p-0.5 text-xs ${cls}`} role="tablist" aria-label="Edit or preview">
      {(['edit', 'preview'] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
          className={`min-h-11 sm:min-h-0 px-3 py-1 rounded-md ${tab === t ? 'bg-surface text-ink shadow-sm font-medium' : 'text-muted hover:text-ink'}`}>
          {t === 'edit' ? 'Edit' : 'Preview'}
        </button>
      ))}
    </div>
  );

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-stretch sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}
      ref={dialogRef} onKeyDown={onKeyDown}>
      {/* On phones the sheet is full-screen, so a stray tap outside can't close it. */}
      <div className="absolute inset-0 bg-ink/50" onClick={() => { if (window.matchMedia('(min-width: 640px)').matches) requestClose(); }} aria-hidden />
      <div className="relative bg-bg w-full sm:max-w-5xl sm:rounded-xl shadow-2xl flex flex-col max-h-full sm:max-h-[94vh] overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0" inert={askDiscard || undefined}>
          <header className="flex items-center gap-3 px-4 sm:px-5 min-h-14 border-b border-line bg-surface shrink-0">
            <span className="text-accent" aria-hidden>✦</span>
            <div className="flex-1 min-w-0 py-2">
              <div className="font-semibold text-sm leading-tight truncate">{title}</div>
              <div className="text-xs text-muted leading-tight">{KIND_LABEL[doc.type]}{doc.number ? ` · ${doc.number}` : ''} · check each line, then tap Yes</div>
            </div>
            {tabs('hidden sm:flex')}
            <button type="button" onClick={requestClose} className={`${HIT} text-muted hover:text-ink -mr-2`} aria-label="Close" data-close>✕</button>
          </header>
          <div className="sm:hidden px-4 pt-3">{tabs('flex w-full [&>button]:flex-1')}</div>

          <div className="flex-1 overflow-y-auto scroll-thin p-4 sm:p-5 space-y-4">
            {tab === 'preview' ? (
              <DocPreview lines={previewLines} columns={cleanCols} doc={doc} maxHeight={false} />
            ) : (
              <>
                {scalarFields.length > 0 && (
                  <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                    {scalarFields.map((fld) => (
                      <label key={fld.key} className="text-xs">
                        <span className="label">{fld.label}</span>
                        {field(fld)}
                      </label>
                    ))}
                  </div>
                )}
                <LineItemsEditor rows={rows} setRows={setRows} columns={columns} setColumns={setColumns} tooling={!!doc.tooling} />
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 space-y-3">
                    {proseFields.map((fld) => (
                      <label key={fld.key} className="block text-xs">
                        <span className="label">{fld.label}</span>
                        {field(fld)}
                      </label>
                    ))}
                  </div>
                  <div className="card p-4 w-full md:w-72 self-start">
                    <DocTotals lines={previewLines} doc={doc} />
                    <div className="text-xs text-muted mt-2">GST and totals are worked out for you.</div>
                  </div>
                </div>
              </>
            )}
            {issues.length > 0 && (
              <div className="rounded-lg border border-crit/40 bg-[#f6e5e1]/40 px-4 py-2.5 text-sm" role="alert">
                <div className="font-medium text-crit mb-1">Fix {issues.length === 1 ? 'this' : 'these'} first:</div>
                <ul className="list-disc pl-5 text-crit/90 space-y-0.5">{issues.map((iss, i) => <li key={i}>{iss.message}</li>)}</ul>
              </div>
            )}
            {warning && <div className="text-xs text-crit flex gap-1.5"><span aria-hidden>⚠</span><span>{warning}</span></div>}
          </div>

          <footer className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-line bg-surface shrink-0">
            <span className="text-xs text-muted flex-1 min-w-0 truncate">
              {serialized.length} item{serialized.length === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={requestClose} disabled={busy} className="btn-ghost disabled:opacity-50">Back</button>
            <button type="button" onClick={confirm} disabled={busy || issues.length > 0} className="btn-primary disabled:opacity-50">
              {primaryLabel}
            </button>
          </footer>
        </div>

        {askDiscard && (
          <div className="absolute inset-0 z-10 bg-ink/40 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" data-discard>
            <div className="card p-4 w-full max-w-sm space-y-3 shadow-xl">
              <div id="discard-title" className="font-semibold text-sm">Discard your changes?</div>
              <p className="text-xs text-muted">What you changed here will be lost. The card stays as it was — nothing is saved either way.</p>
              <div className="flex gap-2 justify-end">
                <button ref={keepRef} type="button" className="btn-primary" onClick={() => setAskDiscard(false)}>Keep editing</button>
                <button type="button" className="btn-ghost !text-crit" onClick={onClose}>Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
