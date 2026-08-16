'use client';
import { type Dispatch, type SetStateAction } from 'react';
import { formatINR, type ColumnDef } from '@ms/core';

// A client-side line row. `rid` is a stable React identity; `gid` (when present)
// binds the row to a part/group so renaming the group never remounts inputs.
// `groupLabel` is the printed part name (persisted); `attributes` holds the
// values for the document's user-defined columns, keyed by ColumnDef.id.
export type LineRow = {
  rid: string;
  gid?: string;
  groupLabel?: string;
  description: string;
  hsn: string;
  qty: string;
  uom: string;
  rate: string;
  gstRate: string;
  tooling?: boolean;
  attributes: Record<string, string>;
};

/** HSN for rubber/plastic moulding dies — this shop's standard line. */
export const DEFAULT_HSN = '84807100';

let uidSeq = 0;
const uid = () => `r${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

export const emptyRow = (group?: { gid: string; groupLabel: string }): LineRow => ({
  rid: uid(),
  gid: group?.gid,
  groupLabel: group?.groupLabel,
  description: '', hsn: DEFAULT_HSN, qty: '1', uom: 'NOS', rate: '', gstRate: '18',
  tooling: false, attributes: {},
});

export const newColumn = (label: string): ColumnDef => ({ id: uid(), label });

const lineAmount = (r: LineRow) => (Number(r.qty) || 0) * (Number(r.rate) || 0);
const groupSubtotal = (rows: LineRow[], gid: string) =>
  rows.filter((r) => r.gid === gid).reduce((s, r) => s + lineAmount(r), 0);

// ── Serialize / reconstruct (shared by every form + edit page) ───────────────

export type ItemPayload = {
  description: string; hsn: string; qty: number; uom: string; rate: number; gstRate: number;
  isToolingCharge: boolean; groupLabel?: string; attributes: Record<string, string>;
};

// Field caps — kept at/under the DB + zod limits so a long value is clamped here
// rather than blowing up the whole save server-side.
const CAP = { hsn: 10, uom: 10, group: 120, attr: 2000, colLabel: 60 } as const;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Drop unnamed/blank columns and trim+clamp labels. An unnamed column must never
 *  be able to fail a save — it's simply ignored. */
export function cleanColumns(columns: ColumnDef[]): ColumnDef[] {
  const seen = new Set<string>();
  const out: ColumnDef[] = [];
  for (const c of columns) {
    const label = clamp(c.label.trim(), CAP.colLabel);
    if (!label || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, label });
  }
  return out;
}

/** Line the rows the way they will be saved (grouped-contiguous, then ungrouped),
 *  numbering only the rows that will actually persist (blank descriptions dropped). */
function orderedForSave(rows: LineRow[]): LineRow[] {
  const gids: string[] = [];
  for (const r of rows) if (r.gid && !gids.includes(r.gid)) gids.push(r.gid);
  return [...gids.flatMap((gid) => rows.filter((r) => r.gid === gid)), ...rows.filter((r) => !r.gid)];
}

/**
 * Flatten editor rows into the persisted order — every group's rows contiguously
 * (in group order), then ungrouped rows. Blank-description rows are dropped.
 * Every field is clamped to its limit so no single value can fail the save.
 * The print template re-groups by consecutive `groupLabel`, so contiguity matters.
 */
export function serializeItems(rows: LineRow[], columns: ColumnDef[]): ItemPayload[] {
  const validCols = new Set(cleanColumns(columns).map((c) => c.id));
  return orderedForSave(rows)
    .filter((r) => r.description.trim())
    .map((r) => {
      // keep only values for columns that still exist + are named
      const attributes: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.attributes ?? {})) {
        if (validCols.has(k) && v.trim()) attributes[k] = clamp(v, CAP.attr);
      }
      const label = clamp((r.gid ? r.groupLabel ?? '' : '').trim(), CAP.group);
      return {
        description: r.description.trim(), hsn: clamp((r.hsn ?? '').trim(), CAP.hsn),
        qty: Number(r.qty) || 0, uom: clamp((r.uom ?? '').trim(), CAP.uom) || 'NOS',
        rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0, isToolingCharge: !!r.tooling,
        groupLabel: label || undefined, attributes,
      };
    });
}

export type ItemIssue = { rid: string; line: number; message: string };

/** Client-side blocking issues — the same conditions that would otherwise make the
 *  server reject the whole document. Surfaced inline so the user fixes them before
 *  submitting (never a wasted round-trip). */
export function itemIssues(rows: LineRow[]): ItemIssue[] {
  const issues: ItemIssue[] = [];
  let line = 0;
  for (const r of orderedForSave(rows)) {
    if (!r.description.trim()) continue;
    line += 1;
    if (!(Number(r.qty) > 0)) issues.push({ rid: r.rid, line, message: `Line ${line} needs a quantity greater than 0.` });
  }
  if (line === 0) issues.push({ rid: '', line: 0, message: 'Add at least one line with a description.' });
  return issues;
}

/** True when a row will actually persist but has an invalid quantity. */
const rowQtyBad = (r: LineRow) => !!r.description.trim() && !(Number(r.qty) > 0);

type StoredItem = {
  description: string; hsn?: string | null; qty: unknown; uom: string; rate: unknown; gstRate: unknown;
  isToolingCharge?: boolean; groupLabel?: string | null; attributes?: Record<string, string> | null;
};

/** Rebuild editor rows from stored items — reconstruct a stable gid per run of
 *  consecutive rows sharing the same non-empty group label. */
export function rowsFromStored(items: StoredItem[]): LineRow[] {
  let lastLabel: string | null = null;
  let lastGid: string | undefined;
  return items.map((it) => {
    const label = (it.groupLabel ?? '').trim();
    let gid: string | undefined;
    if (label) {
      if (label === lastLabel && lastGid) gid = lastGid;
      else { gid = uid(); }
      lastGid = gid;
    } else {
      lastGid = undefined;
    }
    lastLabel = label || null;
    return {
      rid: uid(), gid, groupLabel: label || undefined,
      description: it.description, hsn: it.hsn ?? DEFAULT_HSN,
      qty: String(Number(it.qty)), uom: it.uom, rate: String(Number(it.rate)), gstRate: String(Number(it.gstRate)),
      tooling: !!it.isToolingCharge, attributes: { ...(it.attributes ?? {}) },
    };
  });
}

const num = (v: string) => /^\d*\.?\d*$/.test(v);

// ── Editor ───────────────────────────────────────────────────────────────────

/**
 * Grouped, column-customisable line-item editor. Rows may sit under a named part
 * (group) with a live subtotal, or be left ungrouped. Users add descriptive
 * columns that render an extra input per row. Responsive: dense table on desktop,
 * stacked cards on phones. Controlled — the parent owns `rows` and `columns`.
 */
export function LineItemsEditor({
  rows, setRows, columns, setColumns, tooling = false,
}: {
  rows: LineRow[];
  setRows: Dispatch<SetStateAction<LineRow[]>>;
  columns: ColumnDef[];
  setColumns: Dispatch<SetStateAction<ColumnDef[]>>;
  tooling?: boolean;
}) {
  // Row helpers keyed by stable rid (safe under reordering / grouping).
  const patch = (rid: string, p: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, ...p } : r)));
  const patchAttr = (rid: string, colId: string, val: string) =>
    setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, attributes: { ...r.attributes, [colId]: val } } : r)));
  const removeRow = (rid: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.rid !== rid) : rs));

  // Group derivation (first-appearance order).
  const gids: string[] = [];
  for (const r of rows) if (r.gid && !gids.includes(r.gid)) gids.push(r.gid);
  const groupRows = (gid: string) => rows.filter((r) => r.gid === gid);
  const groupLabelOf = (gid: string) => rows.find((r) => r.gid === gid)?.groupLabel ?? '';
  const ungrouped = rows.filter((r) => !r.gid);

  const addGroup = () => {
    let n = gids.length + 1;
    const existing = gids.map(groupLabelOf);
    let name = `Part ${n}`;
    while (existing.includes(name)) name = `Part ${++n}`;
    setRows((rs) => [...rs, emptyRow({ gid: uid(), groupLabel: name })]);
  };
  const addToGroup = (gid: string) =>
    setRows((rs) => [...rs, emptyRow({ gid, groupLabel: groupLabelOf(gid) })]);
  const addUngrouped = () => setRows((rs) => [...rs, emptyRow()]);
  const renameGroup = (gid: string, label: string) =>
    setRows((rs) => rs.map((r) => (r.gid === gid ? { ...r, groupLabel: label } : r)));
  const removeGroup = (gid: string) =>
    setRows((rs) => {
      const rest = rs.filter((r) => r.gid !== gid);
      return rest.length ? rest : [emptyRow()];
    });

  // Column helpers.
  const addColumn = () => setColumns((cs) => (cs.length < 12 ? [...cs, newColumn(`Column ${cs.length + 1}`)] : cs));
  const renameColumn = (id: string, label: string) => setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, label } : c)));
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

  // Total table columns: S.No, Description, …custom, HSN, Qty, UOM, Rate, GST, [Tooling], Amount, remove.
  const ncols = 8 + columns.length + (tooling ? 1 : 0) + 1;

  const rowCells = (r: LineRow, sn: number) => (
    <>
      <td className="c text-faint tabular-nums">{sn}</td>
      <td><input value={r.description} onChange={(e) => patch(r.rid, { description: e.target.value })} className="field !py-1" placeholder="Item / die description" /></td>
      {columns.map((c) => (
        <td key={c.id}><input value={r.attributes[c.id] ?? ''} onChange={(e) => patchAttr(r.rid, c.id, e.target.value)} className="field !py-1 min-w-[6rem]" /></td>
      ))}
      <td><input value={r.hsn} onChange={(e) => patch(r.rid, { hsn: e.target.value })} className="field !py-1 w-24 font-mono" /></td>
      <td><input value={r.qty} onChange={(e) => num(e.target.value) && patch(r.rid, { qty: e.target.value })} className={`field !py-1 w-16 text-right ${rowQtyBad(r) ? '!border-crit' : ''}`} inputMode="decimal" title={rowQtyBad(r) ? 'Quantity must be greater than 0' : undefined} /></td>
      <td><input value={r.uom} onChange={(e) => patch(r.rid, { uom: e.target.value })} className="field !py-1 w-16" /></td>
      <td><input value={r.rate} onChange={(e) => num(e.target.value) && patch(r.rid, { rate: e.target.value })} className="field !py-1 w-24 text-right" inputMode="decimal" placeholder="0" /></td>
      <td><input value={r.gstRate} onChange={(e) => num(e.target.value) && patch(r.rid, { gstRate: e.target.value })} className="field !py-1 w-16 text-right" inputMode="decimal" /></td>
      {tooling && <td className="text-center"><input type="checkbox" checked={!!r.tooling} onChange={(e) => patch(r.rid, { tooling: e.target.checked })} title="One-time tooling / NRE charge" /></td>}
      <td className="text-right tabular-nums font-mono whitespace-nowrap">{formatINR(lineAmount(r))}</td>
      <td><button type="button" onClick={() => removeRow(r.rid)} className="text-crit text-sm px-1" aria-label="Remove row">✕</button></td>
    </>
  );

  return (
    <div className="space-y-3">
      {/* Column manager */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mr-1">Columns</span>
        {columns.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 pl-2 pr-1 py-1">
            <input value={c.label} onChange={(e) => renameColumn(c.id, e.target.value)} className="bg-transparent text-xs w-24 outline-none" aria-label="Column name" />
            <button type="button" onClick={() => moveColumn(c.id, -1)} className="text-faint hover:text-fg text-xs px-0.5" aria-label="Move column left">‹</button>
            <button type="button" onClick={() => moveColumn(c.id, 1)} className="text-faint hover:text-fg text-xs px-0.5" aria-label="Move column right">›</button>
            <button type="button" onClick={() => removeColumn(c.id)} className="text-crit text-xs px-0.5" aria-label="Remove column">✕</button>
          </span>
        ))}
        <button type="button" onClick={addColumn} disabled={columns.length >= 12} className="btn-ghost text-xs disabled:opacity-40">+ Add column</button>
        <span className="text-[0.62rem] text-faint ml-auto">Custom columns are descriptive only — they don't affect GST or totals.</span>
      </div>

      {/* Desktop table */}
      <div className="card hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-10">#</th><th>Description</th>
              {columns.map((c) => <th key={c.id}>{c.label || '—'}</th>)}
              <th>HSN/SAC</th><th>Qty</th><th>UOM</th><th>Rate</th><th>GST %</th>
              {tooling && <th>Tooling</th>}<th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let sn = 0;
              return (
                <>
                  {gids.map((gid) => {
                    const gr = groupRows(gid);
                    return (
                      <GroupBlockDesktop
                        key={gid}
                        ncols={ncols}
                        label={groupLabelOf(gid)}
                        subtotal={groupSubtotal(rows, gid)}
                        onRename={(v) => renameGroup(gid, v)}
                        onAddRow={() => addToGroup(gid)}
                        onRemove={() => removeGroup(gid)}
                      >
                        {gr.map((r) => {
                          sn += 1;
                          return <tr key={r.rid} className="border-b border-line [&>td]:px-2 [&>td]:py-1.5">{rowCells(r, sn)}</tr>;
                        })}
                      </GroupBlockDesktop>
                    );
                  })}
                  {ungrouped.length > 0 && gids.length > 0 && (
                    <tr><td colSpan={ncols} className="px-3 pt-3 pb-1 text-[0.62rem] font-mono uppercase tracking-wider text-faint">Other lines</td></tr>
                  )}
                  {ungrouped.map((r) => {
                    sn += 1;
                    return <tr key={r.rid} className="border-b border-line last:border-0 [&>td]:px-2 [&>td]:py-1.5">{rowCells(r, sn)}</tr>;
                  })}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="card md:hidden divide-y divide-line">
        {(() => {
          let sn = 0;
          return (
            <>
              {gids.map((gid) => (
                <div key={gid} className="p-3 space-y-3 bg-surface-2/40">
                  <div className="flex items-center gap-2">
                    <span className="text-accent" aria-hidden>▸</span>
                    <input value={groupLabelOf(gid)} onChange={(e) => renameGroup(gid, e.target.value)} className="field !py-1 flex-1 font-medium" placeholder="Part name" aria-label="Part name" />
                    <button type="button" onClick={() => removeGroup(gid)} className="text-crit text-xs" aria-label="Remove part">✕</button>
                  </div>
                  {groupRows(gid).map((r) => { sn += 1; return <MobileRow key={r.rid} r={r} sn={sn} columns={columns} tooling={tooling} patch={patch} patchAttr={patchAttr} removeRow={removeRow} />; })}
                  <div className="flex items-center justify-between pt-1">
                    <button type="button" onClick={() => addToGroup(gid)} className="btn-ghost text-xs">+ Add die</button>
                    <span className="text-xs text-muted">Subtotal <b className="font-mono tabular-nums">{formatINR(groupSubtotal(rows, gid))}</b></span>
                  </div>
                </div>
              ))}
              {ungrouped.length > 0 && gids.length > 0 && (
                <div className="px-3 pt-3 pb-0 text-[0.62rem] font-mono uppercase tracking-wider text-faint">Other lines</div>
              )}
              {ungrouped.map((r) => { sn += 1; return <MobileRow key={r.rid} r={r} sn={sn} columns={columns} tooling={tooling} patch={patch} patchAttr={patchAttr} removeRow={removeRow} />; })}
            </>
          );
        })()}
      </div>

      {/* Add controls */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addUngrouped} className="btn-ghost text-xs">+ Add line</button>
        <button type="button" onClick={addGroup} className="btn-ghost text-xs">+ Add part / group</button>
      </div>
    </div>
  );
}

function GroupBlockDesktop({
  ncols, label, subtotal, onRename, onAddRow, onRemove, children,
}: {
  ncols: number; label: string; subtotal: number;
  onRename: (v: string) => void; onAddRow: () => void; onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="bg-surface-2/60 border-b border-line">
        <td colSpan={ncols} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-accent" aria-hidden>▸</span>
            <input value={label} onChange={(e) => onRename(e.target.value)} className="field !py-1 w-64 font-medium" placeholder="Part name (printed as a heading)" aria-label="Part name" />
            <button type="button" onClick={onAddRow} className="btn-ghost text-xs">+ Add die</button>
            <button type="button" onClick={onRemove} className="text-crit text-xs ml-1" aria-label="Remove part">Remove part ✕</button>
            <span className="ml-auto text-xs text-muted">Subtotal&nbsp;<b className="font-mono tabular-nums">{formatINR(subtotal)}</b></span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

function MobileRow({
  r, sn, columns, tooling, patch, patchAttr, removeRow,
}: {
  r: LineRow; sn: number; columns: ColumnDef[]; tooling: boolean;
  patch: (rid: string, p: Partial<LineRow>) => void;
  patchAttr: (rid: string, colId: string, val: string) => void;
  removeRow: (rid: string) => void;
}) {
  const numOk = (v: string) => /^\d*\.?\d*$/.test(v);
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.62rem] font-mono uppercase tracking-wider text-faint">Line {sn}</span>
        <button type="button" onClick={() => removeRow(r.rid)} className="text-crit text-xs" aria-label="Remove line">Remove ✕</button>
      </div>
      <input value={r.description} onChange={(e) => patch(r.rid, { description: e.target.value })} className="field" placeholder="Item / die description" />
      {columns.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {columns.map((c) => (
            <label key={c.id} className="label !mb-0.5">{c.label || '—'}<input value={r.attributes[c.id] ?? ''} onChange={(e) => patchAttr(r.rid, c.id, e.target.value)} className="field mt-0.5" /></label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="label !mb-0.5 col-span-2">HSN/SAC<input value={r.hsn} onChange={(e) => patch(r.rid, { hsn: e.target.value })} className="field font-mono mt-0.5" /></label>
        <label className="label !mb-0.5">Qty<input value={r.qty} onChange={(e) => numOk(e.target.value) && patch(r.rid, { qty: e.target.value })} className={`field mt-0.5 ${r.description.trim() && !(Number(r.qty) > 0) ? '!border-crit' : ''}`} inputMode="decimal" /></label>
        <label className="label !mb-0.5">UOM<input value={r.uom} onChange={(e) => patch(r.rid, { uom: e.target.value })} className="field mt-0.5" /></label>
        <label className="label !mb-0.5">Rate ₹<input value={r.rate} onChange={(e) => numOk(e.target.value) && patch(r.rid, { rate: e.target.value })} className="field mt-0.5" inputMode="decimal" placeholder="0" /></label>
        <label className="label !mb-0.5">GST %<input value={r.gstRate} onChange={(e) => numOk(e.target.value) && patch(r.rid, { gstRate: e.target.value })} className="field mt-0.5" inputMode="decimal" /></label>
      </div>
      <div className="flex items-center justify-between pt-1">
        {tooling ? (
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={!!r.tooling} onChange={(e) => patch(r.rid, { tooling: e.target.checked })} /> Tooling / NRE</label>
        ) : <span />}
        <span className="text-sm font-mono tabular-nums">{formatINR(lineAmount(r))}</span>
      </div>
    </div>
  );
}
