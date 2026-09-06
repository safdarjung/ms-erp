'use client';
import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { formatINR, splitColumns, MAX_DOC_COLUMNS, type ColumnDef } from '@ms/core';
import {
  DEFAULT_GST, DEFAULT_HSN, emptyRow, newColumn, uid, lineAmount, groupSubtotal, rowQtyBad, rowTaxDiffers,
  rowIsFilled, rowFieldMessage, type LineRow, type ItemIssue,
} from './line-items-shared';

// Re-export the pure helpers so existing client imports from this module keep
// working. Server components must import them from './line-items-shared' directly
// (importing a plain function through this 'use client' module yields a client ref).
export {
  DEFAULT_HSN, emptyRow, newColumn, cleanColumns, serializeItems, rowsFromStored, itemIssues, itemWarnings,
  type LineRow, type ItemPayload, type ItemIssue,
} from './line-items-shared';

const num = (v: string) => /^\d*\.?\d*$/.test(v);
const DESC_PLACEHOLDER = 'What is it? e.g. Blanking die for bracket LH';
const TOOLING_HELP = 'Charged once (die/tool development), not per piece';
const UNDO_MS = 10_000;
const ICON_BTN = 'min-h-11 min-w-11 inline-flex items-center justify-center rounded';

/**
 * Scroll to and focus the input behind a blocking issue. Both the desktop table
 * and the phone cards are in the DOM (CSS hides one), so we pick the visible one.
 */
export function focusIssue(issue: ItemIssue) {
  if (typeof document === 'undefined') return;
  let el: HTMLElement | null = null;
  if (issue.field === 'column' && issue.colId) {
    el = document.getElementById(`col-${issue.colId}`);
  } else {
    const sel = issue.rid
      ? `[data-line="${issue.rid}"][data-field="${issue.field ?? 'description'}"]`
      : '[data-field="description"]';
    const all = Array.from(document.querySelectorAll<HTMLElement>(sel));
    el = all.find((c) => c.offsetParent !== null) ?? all[0] ?? null;
  }
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

type Undo = { rows: LineRow[]; at: number; label: string };

/**
 * Grouped line-item editor with user-defined extra fields. Rows may sit under a
 * named part (name + optional detail + live subtotal) or be left ungrouped.
 * An extra field is either a table column or a "spec" shown under the item —
 * `splitColumns` decides when the user hasn't. HSN / unit / GST % stay tucked
 * away per row ("More") unless they differ from the shop defaults. Controlled —
 * the parent owns `rows` and `columns`. `showIssues` lets a form keep the editor
 * calm until the user has touched it or pressed Save.
 */
export function LineItemsEditor({
  rows, setRows, columns, setColumns, tooling = false, showIssues = true,
}: {
  rows: LineRow[];
  setRows: Dispatch<SetStateAction<LineRow[]>>;
  columns: ColumnDef[];
  setColumns: Dispatch<SetStateAction<ColumnDef[]>>;
  tooling?: boolean;
  showIssues?: boolean;
}) {
  const [taxOpen, setTaxOpen] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const patch = (rid: string, p: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, ...p } : r)));
  const patchAttr = (rid: string, colId: string, val: string) =>
    setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, attributes: { ...r.attributes, [colId]: val } } : r)));

  const isTaxOpen = (r: LineRow) => taxOpen[r.rid] ?? (expandAll || rowTaxDiffers(r));
  const setRowTaxOpen = (rid: string, open: boolean) => setTaxOpen((m) => ({ ...m, [rid]: open }));

  const gids: string[] = [];
  for (const r of rows) if (r.gid && !gids.includes(r.gid)) gids.push(r.gid);
  const groupRows = (gid: string) => rows.filter((r) => r.gid === gid);
  const groupLabelOf = (gid: string) => rows.find((r) => r.gid === gid)?.groupLabel ?? '';
  /** The part's detail — the same value on every row of the part. */
  const groupNoteOf = (gid: string) => rows.find((r) => r.gid === gid)?.groupNote ?? '';
  const ungrouped = rows.filter((r) => !r.gid);
  const allDefaultTax = rows.every((r) => !rowTaxDiffers(r));

  // Which extra fields are table columns and which print under the item. A field
  // still being named has no say yet (splitColumns ignores unnamed ones), so we
  // keep it as a column — that's where the user is already looking.
  const { specCols } = splitColumns(columns);
  const specIds = new Set(specCols.map((c) => c.id));
  const tableCols = columns.filter((c) => !specIds.has(c.id));
  const colName = (c: ColumnDef) => c.label.trim() || 'New field';

  // ── Remove with undo (rows) / inline confirm (parts) ──────────────────────
  const removeRows = (victims: LineRow[], label: string) => {
    if (!victims.length) return;
    const ids = new Set(victims.map((v) => v.rid));
    const at = rows.findIndex((r) => ids.has(r.rid));
    setRows((rs) => {
      const rest = rs.filter((r) => !ids.has(r.rid));
      return rest.length ? rest : [emptyRow()];
    });
    setUndo({ rows: victims, at: Math.max(0, at), label });
  };
  const removeRow = (r: LineRow, sn: number) => removeRows([r], `Item ${sn} removed`);
  const askRemoveGroup = (gid: string) => {
    const gr = groupRows(gid);
    if (gr.some(rowIsFilled) || groupNoteOf(gid).trim()) setConfirmGroup(gid);
    else removeRows(gr, `${groupLabelOf(gid) || 'Part'} removed`);
  };
  const removeGroupNow = (gid: string) => {
    setConfirmGroup(null);
    removeRows(groupRows(gid), `${groupLabelOf(gid) || 'Part'} removed`);
  };
  const restoreUndo = () => {
    if (!undo) return;
    const u = undo;
    setRows((rs) => {
      const base = rs.length === 1 && !rowIsFilled(rs[0]!) ? [] : rs;
      const next = [...base];
      next.splice(Math.min(u.at, next.length), 0, ...u.rows);
      return next;
    });
    setUndo(null);
  };

  // ── Add ───────────────────────────────────────────────────────────────────
  const addGroup = () => {
    let n = gids.length + 1;
    const existing = gids.map(groupLabelOf);
    let name = `Part ${n}`;
    while (existing.includes(name)) name = `Part ${++n}`;
    setRows((rs) => {
      // The form starts with one blank line. If it is still untouched when the
      // first part is added, drop it — otherwise it lingers under "Other items"
      // and gets half-filled by accident.
      const keep = rs.some((r) => r.gid) || rs.some(rowIsFilled) ? rs : rs.filter(rowIsFilled);
      return [...keep, emptyRow({ gid: uid(), groupLabel: name })];
    });
  };
  const addToGroup = (gid: string) =>
    setRows((rs) => [...rs, emptyRow({ gid, groupLabel: groupLabelOf(gid), groupNote: groupNoteOf(gid) || undefined })]);
  const addUngrouped = () => setRows((rs) => [...rs, emptyRow()]);
  // Renaming a part keeps its detail — the note belongs to the run, not the name.
  const renameGroup = (gid: string, label: string) =>
    setRows((rs) => rs.map((r) => (r.gid === gid ? { ...r, groupLabel: label } : r)));
  const setGroupNote = (gid: string, note: string) =>
    setRows((rs) => rs.map((r) => (r.gid === gid ? { ...r, groupNote: note } : r)));

  // ── Extra fields ──────────────────────────────────────────────────────────
  // A new field says nothing about how it prints: with few fields `splitColumns`
  // keeps it a column, and once there are three it moves them all under the item.
  const addColumn = () => {
    if (columns.length >= MAX_DOC_COLUMNS) return;
    const col = newColumn();
    setColumns((cs) => [...cs, col]);
    setTimeout(() => document.getElementById(`col-${col.id}`)?.focus(), 0);
  };
  const renameColumn = (id: string, label: string) => setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, label } : c)));
  const setColumnDisplay = (id: string, display: 'column' | 'spec') =>
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, display } : c)));
  const removeColumn = (id: string) => setColumns((cs) => cs.filter((c) => c.id !== id));
  const moveColumn = (id: string, dir: -1 | 1) =>
    setColumns((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const columnHasValues = (id: string) => rows.some((r) => (r.attributes?.[id] ?? '').trim());

  // Columns: # · description · extra columns… · qty · rate · (one-time) · amount · more · remove
  const ncols = 7 + tableCols.length + (tooling ? 1 : 0);

  const renderRow = (r: LineRow, sn: number, last: boolean) => {
    const descMsg = showIssues ? rowFieldMessage(r, 'description') : null;
    const qtyMsg = showIssues ? rowFieldMessage(r, 'qty') : null;
    const open = isTaxOpen(r);
    // The specs line stays open whenever the document has spec fields: they are
    // there to be filled in per item, and hiding them behind a toggle would mean
    // one extra click on every single line.
    const extras = specCols.length > 0 || open;
    return (
      <Fragment key={r.rid}>
        <tr className={`border-b border-line ${last && !extras ? 'last:border-0' : ''} [&>td]:px-2 [&>td]:py-1.5 [&>td]:align-top`}>
          <td className="text-faint tabular-nums pt-3">{sn}</td>
          <td>
            <input
              id={`line-${r.rid}`} data-line={r.rid} data-field="description"
              value={r.description} onChange={(e) => patch(r.rid, { description: e.target.value })}
              className={`field !py-1 ${descMsg ? '!border-crit' : ''}`} placeholder={DESC_PLACEHOLDER}
              aria-label={`Item / description, line ${sn}`} aria-invalid={descMsg ? true : undefined}
              aria-describedby={descMsg ? `line-${r.rid}-desc-msg` : undefined}
            />
            {descMsg && <div id={`line-${r.rid}-desc-msg`} className="text-xs text-crit mt-0.5">{descMsg}</div>}
          </td>
          {tableCols.map((c) => (
            <td key={c.id}>
              <input value={r.attributes[c.id] ?? ''} onChange={(e) => patchAttr(r.rid, c.id, e.target.value)}
                className="field !py-1 min-w-[6rem]" aria-label={`${colName(c)}, line ${sn}`} />
            </td>
          ))}
          <td>
            <input
              data-line={r.rid} data-field="qty"
              value={r.qty} onChange={(e) => num(e.target.value) && patch(r.rid, { qty: e.target.value })}
              className={`field !py-1 w-16 text-right ${qtyMsg ? '!border-crit' : ''}`} inputMode="decimal"
              aria-label={`Qty, line ${sn}`} aria-invalid={qtyMsg ? true : undefined}
              aria-describedby={qtyMsg ? `line-${r.rid}-qty-msg` : undefined}
            />
            {qtyMsg && <div id={`line-${r.rid}-qty-msg`} className="text-xs text-crit mt-0.5 w-32">{qtyMsg}</div>}
          </td>
          <td>
            <input value={r.rate} onChange={(e) => num(e.target.value) && patch(r.rid, { rate: e.target.value })}
              className="field !py-1 w-24 text-right" inputMode="decimal" placeholder="0" aria-label={`Rate (₹), line ${sn}`} />
          </td>
          {tooling && (
            <td className="text-center pt-3">
              <input type="checkbox" checked={!!r.tooling} onChange={(e) => patch(r.rid, { tooling: e.target.checked })}
                aria-label={`One-time charge, line ${sn}`} title={TOOLING_HELP} className="w-4 h-4" />
            </td>
          )}
          <td className="text-right tabular-nums font-mono whitespace-nowrap pt-3">{formatINR(lineAmount(r))}</td>
          <td className="whitespace-nowrap pt-2">
            <button type="button" onClick={() => setRowTaxOpen(r.rid, !open)} aria-expanded={open}
              aria-label={`Tax details, line ${sn}`} className="text-xs text-steel hover:underline">
              {open ? 'Less ▴' : 'More ▾'}
            </button>
          </td>
          <td className="!py-0">
            <button type="button" onClick={() => removeRow(r, sn)} className={`${ICON_BTN} text-crit hover:bg-[#f6e5e1]`}
              aria-label={`Remove line ${sn}`} title="Remove this line">✕</button>
          </td>
        </tr>
        {extras && (
          <tr className={`bg-surface-2/40 border-b border-line ${last ? 'last:border-0' : ''}`}>
            <td colSpan={ncols} className="px-3 py-2 space-y-2">
              {specCols.length > 0 && <SpecFields r={r} sn={sn} cols={specCols} patchAttr={patchAttr} />}
              {open && <TaxFields r={r} sn={sn} patch={patch} compact />}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="space-y-3">
      {columns.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <span className="text-xs text-muted mr-1 mt-2">Extra fields</span>
            {columns.map((c) => {
              const unnamed = !c.label.trim() && columnHasValues(c.id) && showIssues;
              const named = c.label.trim();
              // Show the field's own choice, or the one splitColumns made for it.
              const shownAs: 'column' | 'spec' = c.display ?? (specIds.has(c.id) ? 'spec' : 'column');
              return (
                <span key={c.id} className={`rounded-md border bg-surface-2 px-1 py-0.5 ${unnamed ? 'border-crit' : 'border-line'}`}>
                  <span className="flex items-center gap-0.5">
                    <input id={`col-${c.id}`} value={c.label} onChange={(e) => renameColumn(c.id, e.target.value)}
                      className="bg-transparent text-sm w-40 px-1 outline-none min-h-11 sm:min-h-0" placeholder="Field name, e.g. Material"
                      aria-label="Extra field name" aria-invalid={unnamed || undefined} maxLength={60} />
                    <button type="button" onClick={() => moveColumn(c.id, -1)} className={`${ICON_BTN} text-faint hover:text-ink`}
                      aria-label={`Move ${named || 'this field'} earlier`} title="Move earlier">‹</button>
                    <button type="button" onClick={() => moveColumn(c.id, 1)} className={`${ICON_BTN} text-faint hover:text-ink`}
                      aria-label={`Move ${named || 'this field'} later`} title="Move later">›</button>
                    <button type="button" onClick={() => removeColumn(c.id)} className={`${ICON_BTN} text-crit hover:bg-[#f6e5e1]`}
                      aria-label={`Remove field ${named}`.trim()} title="Remove this field">✕</button>
                  </span>
                  <span className="flex items-center gap-1.5 px-1 pb-0.5 text-xs text-muted">
                    <label htmlFor={`col-${c.id}-show`}>Show as</label>
                    <select id={`col-${c.id}-show`} value={shownAs} onChange={(e) => setColumnDisplay(c.id, e.target.value as 'column' | 'spec')}
                      aria-label={`Show ${named || 'this field'} as`} className="field !w-auto !py-0.5 !px-1.5 text-xs">
                      <option value="column">Column</option>
                      <option value="spec">Under the item</option>
                    </select>
                  </span>
                </span>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            Fields shown under the item keep the table narrow — good for material, hardness, size.
            Printed on the document — doesn&apos;t change GST or totals.
          </p>
        </div>
      )}

      {/* Desktop table */}
      <div className="card hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-10">#</th><th>Item / description</th>
              {tableCols.map((c) => <th key={c.id}>{c.label.trim() || <span className="normal-case font-normal">New field</span>}</th>)}
              <th className="w-20">Qty</th><th className="w-28">Rate (₹)</th>
              {tooling && <th className="w-24 text-center" title={TOOLING_HELP}>One-time charge</th>}
              <th className="text-right">Amount</th>
              <th className="w-16"><span className="sr-only-text">Tax details</span></th>
              <th className="w-12"><span className="sr-only-text">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let sn = 0;
              const total = rows.length;
              return (
                <>
                  {gids.map((gid) => {
                    const gr = groupRows(gid);
                    return (
                      <Fragment key={gid}>
                        <tr className="bg-surface-2/60 border-b border-line">
                          <td colSpan={ncols} className="px-3 py-2">
                            <PartHeader
                              label={groupLabelOf(gid)} note={groupNoteOf(gid)} count={gr.length} subtotal={groupSubtotal(rows, gid)}
                              confirming={confirmGroup === gid}
                              onRename={(v) => renameGroup(gid, v)} onNote={(v) => setGroupNote(gid, v)} onAddRow={() => addToGroup(gid)}
                              onAskRemove={() => askRemoveGroup(gid)} onRemove={() => removeGroupNow(gid)} onKeep={() => setConfirmGroup(null)}
                            />
                          </td>
                        </tr>
                        {gr.map((r) => { sn += 1; return renderRow(r, sn, sn === total); })}
                      </Fragment>
                    );
                  })}
                  {ungrouped.length > 0 && gids.length > 0 && (
                    <tr><td colSpan={ncols} className="px-3 pt-3 pb-1 text-xs text-muted">Other items</td></tr>
                  )}
                  {ungrouped.map((r) => { sn += 1; return renderRow(r, sn, sn === total); })}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>

      {/* Phone cards */}
      <div className="card md:hidden divide-y divide-line">
        {(() => {
          let sn = 0;
          const mobileRow = (r: LineRow) => {
            sn += 1;
            const n = sn;
            return (
              <MobileRow key={r.rid} r={r} sn={n} columns={columns} tooling={tooling} showIssues={showIssues}
                taxOpen={isTaxOpen(r)} onTaxToggle={(o) => setRowTaxOpen(r.rid, o)}
                patch={patch} patchAttr={patchAttr} onRemove={() => removeRow(r, n)} />
            );
          };
          return (
            <>
              {gids.map((gid) => (
                <div key={gid} className="p-3 space-y-3 bg-surface-2/40">
                  <PartHeader
                    label={groupLabelOf(gid)} note={groupNoteOf(gid)} count={groupRows(gid).length} subtotal={groupSubtotal(rows, gid)}
                    confirming={confirmGroup === gid} compact
                    onRename={(v) => renameGroup(gid, v)} onNote={(v) => setGroupNote(gid, v)} onAddRow={() => addToGroup(gid)}
                    onAskRemove={() => askRemoveGroup(gid)} onRemove={() => removeGroupNow(gid)} onKeep={() => setConfirmGroup(null)}
                  />
                  {groupRows(gid).map(mobileRow)}
                </div>
              ))}
              {ungrouped.length > 0 && gids.length > 0 && <div className="px-3 pt-3 pb-0 text-xs text-muted">Other items</div>}
              {ungrouped.map(mobileRow)}
            </>
          );
        })()}
      </div>

      {/* Tax caption + undo */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {allDefaultTax
            ? <>GST {DEFAULT_GST}% and HSN {DEFAULT_HSN} applied to all items</>
            : <>Tax details (HSN, unit, GST %) differ on some lines</>}
          {' · '}
          <button type="button" className="text-steel hover:underline" onClick={() => { setExpandAll((v) => !v); setTaxOpen({}); }}>
            {expandAll ? 'Hide tax details' : 'Change'}
          </button>
        </span>
        {undo && (
          <span role="status" className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-ink">
            {undo.label} · <button type="button" onClick={restoreUndo} className="font-medium text-accent hover:underline">Undo</button>
          </span>
        )}
      </div>

      {/* Add controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={addUngrouped} className="btn-ghost text-xs">+ Add item</button>
        <button type="button" onClick={addGroup} className="btn-ghost text-xs">+ Add part (with its dies)</button>
        <span className="text-xs text-muted basis-full lg:basis-auto">
          Use a part when you&apos;re quoting several dies for one part — they print under the part name with a subtotal.
        </span>
        <button
          type="button" onClick={addColumn} disabled={columns.length >= MAX_DOC_COLUMNS}
          className="text-xs text-muted hover:text-ink hover:underline disabled:opacity-40 min-h-11 sm:min-h-0 sm:ml-auto"
          title="Adds a descriptive field like Material, Hardness or Cavities — printed on the document, doesn't change totals"
        >
          + Extra field (e.g. Material)
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TaxFields({ r, sn, patch, compact = false }: {
  r: LineRow; sn: number; patch: (rid: string, p: Partial<LineRow>) => void; compact?: boolean;
}) {
  const cls = compact ? 'field !py-1' : 'field mt-0.5';
  return (
    <div className={compact ? 'flex flex-wrap items-end gap-3' : 'grid grid-cols-3 gap-2'}>
      <label className="label !mb-0.5">HSN code
        <input value={r.hsn} onChange={(e) => /^\d*$/.test(e.target.value) && patch(r.rid, { hsn: e.target.value })}
          className={`${cls} font-mono ${compact ? 'w-32' : ''}`} inputMode="numeric" pattern="[0-9]*" maxLength={10}
          aria-label={`HSN code, line ${sn}`} placeholder={DEFAULT_HSN} />
      </label>
      <label className="label !mb-0.5">Unit
        <input value={r.uom} onChange={(e) => patch(r.rid, { uom: e.target.value })} className={`${cls} ${compact ? 'w-20' : ''}`}
          maxLength={10} placeholder="NOS" aria-label={`Unit, line ${sn}`} />
      </label>
      <label className="label !mb-0.5">GST %
        <input value={r.gstRate} onChange={(e) => num(e.target.value) && patch(r.rid, { gstRate: e.target.value })}
          className={`${cls} text-right ${compact ? 'w-20' : ''}`} inputMode="decimal" aria-label={`GST %, line ${sn}`} />
      </label>
    </div>
  );
}

function PartHeader({
  label, note, count, subtotal, confirming, compact = false, onRename, onNote, onAddRow, onAskRemove, onRemove, onKeep,
}: {
  label: string; note: string; count: number; subtotal: number; confirming: boolean; compact?: boolean;
  onRename: (v: string) => void; onNote: (v: string) => void;
  onAddRow: () => void; onAskRemove: () => void; onRemove: () => void; onKeep: () => void;
}) {
  const name = label.trim() || 'this part';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-accent" aria-hidden>▸</span>
        <input value={label} onChange={(e) => onRename(e.target.value)} className={`field !py-1 font-medium ${compact ? 'flex-1 min-w-0' : 'w-64'}`}
          placeholder="Part name, e.g. Bracket LH (printed as a heading)" aria-label="Part name" maxLength={120} />
        {!compact && <button type="button" onClick={onAddRow} className="btn-ghost text-xs">+ Add die</button>}
        {confirming ? (
          <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-xs text-crit basis-full sm:basis-auto">
            Remove {name} and its {count} {count === 1 ? 'die' : 'dies'}?
            <button type="button" onClick={onRemove} className="btn text-xs bg-crit text-white !py-1">Remove</button>
            <button type="button" onClick={onKeep} className="btn-ghost text-xs !py-1">Keep</button>
          </span>
        ) : (
          <button type="button" onClick={onAskRemove} className={`${ICON_BTN} text-crit hover:bg-[#f6e5e1]`}
            aria-label={`Remove part ${label.trim()}`.trim()} title="Remove this part and its dies">✕</button>
        )}
        <span className={`text-xs text-muted ${compact ? 'basis-full flex justify-between items-center' : 'ml-auto'}`}>
          {compact && <button type="button" onClick={onAddRow} className="btn-ghost text-xs">+ Add die</button>}
          <span>Subtotal&nbsp;<b className="font-mono tabular-nums">{formatINR(subtotal)}</b></span>
        </span>
      </div>
      {/* One detail for the whole part — printed beside the heading. */}
      <input value={note} onChange={(e) => onNote(e.target.value)} className={`field !py-1 text-sm ${compact ? '' : 'max-w-2xl'}`}
        placeholder="Drawing no., component, material… (optional)" aria-label="Part detail" maxLength={200} />
    </div>
  );
}

/** The extra fields that print under the item — one small labelled box each. */
function SpecFields({ r, sn, cols, patchAttr }: {
  r: LineRow; sn: number; cols: ColumnDef[];
  patchAttr: (rid: string, colId: string, val: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {cols.map((c) => {
        const name = c.label.trim() || 'Detail';
        return (
          <label key={c.id} className="label !mb-0">{name}
            <input value={r.attributes[c.id] ?? ''} onChange={(e) => patchAttr(r.rid, c.id, e.target.value)}
              className="field !py-1 mt-0.5 w-36 font-normal" aria-label={`${name}, line ${sn}`} />
          </label>
        );
      })}
    </div>
  );
}

function MobileRow({
  r, sn, columns, tooling, showIssues, taxOpen, onTaxToggle, patch, patchAttr, onRemove,
}: {
  r: LineRow; sn: number; columns: ColumnDef[]; tooling: boolean; showIssues: boolean;
  taxOpen: boolean; onTaxToggle: (open: boolean) => void;
  patch: (rid: string, p: Partial<LineRow>) => void;
  patchAttr: (rid: string, colId: string, val: string) => void;
  onRemove: () => void;
}) {
  const descMsg = showIssues ? rowFieldMessage(r, 'description') : null;
  const qtyMsg = showIssues ? rowFieldMessage(r, 'qty') : null;
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Item {sn}</span>
        <button type="button" onClick={onRemove} className={`${ICON_BTN} text-crit hover:bg-[#f6e5e1] -mr-2`} aria-label={`Remove line ${sn}`} title="Remove this line">✕</button>
      </div>
      <label className="label !mb-0.5">Item / description
        <input id={`line-${r.rid}-m`} data-line={r.rid} data-field="description" value={r.description}
          onChange={(e) => patch(r.rid, { description: e.target.value })}
          className={`field mt-0.5 ${descMsg ? '!border-crit' : ''}`} placeholder={DESC_PLACEHOLDER}
          aria-invalid={descMsg ? true : undefined} aria-describedby={descMsg ? `line-${r.rid}-m-desc-msg` : undefined} />
      </label>
      {descMsg && <div id={`line-${r.rid}-m-desc-msg`} className="text-xs text-crit -mt-1">{descMsg}</div>}
      {columns.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {columns.map((c) => {
            const name = c.label.trim() || 'New field';
            return (
              <label key={c.id} className="label !mb-0.5">{name}
                <input value={r.attributes[c.id] ?? ''} onChange={(e) => patchAttr(r.rid, c.id, e.target.value)}
                  className="field mt-0.5 font-normal" aria-label={`${name}, line ${sn}`} />
              </label>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="label !mb-0.5">Qty
          <input data-line={r.rid} data-field="qty" value={r.qty} onChange={(e) => num(e.target.value) && patch(r.rid, { qty: e.target.value })}
            className={`field mt-0.5 ${qtyMsg ? '!border-crit' : ''}`} inputMode="decimal"
            aria-invalid={qtyMsg ? true : undefined} aria-describedby={qtyMsg ? `line-${r.rid}-m-qty-msg` : undefined} />
          {qtyMsg && <span id={`line-${r.rid}-m-qty-msg`} className="block text-xs text-crit font-normal mt-0.5">{qtyMsg}</span>}
        </label>
        <label className="label !mb-0.5">Rate (₹)
          <input value={r.rate} onChange={(e) => num(e.target.value) && patch(r.rid, { rate: e.target.value })} className="field mt-0.5" inputMode="decimal" placeholder="0" />
        </label>
      </div>
      <details open={taxOpen} onToggle={(e) => onTaxToggle(e.currentTarget.open)} className="reveal">
        <summary className="text-xs text-steel cursor-pointer min-h-11 flex items-center gap-1">
          <span className="chev" aria-hidden>▸</span>
          Tax details · HSN {r.hsn.trim() || '—'} · {r.uom.trim() || '—'} · GST {r.gstRate.trim() || '0'}%
        </summary>
        <div className="pb-1"><TaxFields r={r} sn={sn} patch={patch} /></div>
      </details>
      <div className="flex items-center justify-between pt-1">
        {tooling ? (
          <label className="flex items-center gap-2 text-xs text-muted min-h-11" title={TOOLING_HELP}>
            <input type="checkbox" checked={!!r.tooling} onChange={(e) => patch(r.rid, { tooling: e.target.checked })} className="w-4 h-4" /> One-time charge
          </label>
        ) : <span />}
        <span className="text-sm font-mono tabular-nums">{formatINR(lineAmount(r))}</span>
      </div>
    </div>
  );
}
