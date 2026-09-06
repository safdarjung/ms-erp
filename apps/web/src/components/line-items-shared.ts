// Framework-agnostic line-item helpers shared by the client editor (forms) AND
// server components (document detail/edit pages). NOTE: this file must NOT be
// 'use client' — server components (edit pages) call rowsFromStored/serializeItems
// here, and RSC cannot invoke a function exported from a client module.
// Type-only: keeps this module free of runtime imports, so the forms, the RSC
// pages and the test runner can all use it as-is.
import type { ColumnDef } from '@ms/core';

// A client-side line row. `rid` is a stable React identity; `gid` (when present)
// binds the row to a part/group so renaming the group never remounts inputs.
// `groupLabel` is the printed part name (persisted); `groupNote` is the part's
// detail (drawing no., component, material) — the same value on every row of the
// part, because that is how it is stored; `attributes` holds the values for the
// document's user-defined fields, keyed by ColumnDef.id.
export type LineRow = {
  rid: string;
  gid?: string;
  groupLabel?: string;
  groupNote?: string;
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
export const DEFAULT_UOM = 'NOS';
export const DEFAULT_GST = '18';

let uidSeq = 0;
export const uid = () => `r${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

/** `rid` lets a form give its very first row a stable id — server and client render must agree on DOM ids. */
export const emptyRow = (group?: { gid: string; groupLabel: string; groupNote?: string }, rid?: string): LineRow => ({
  rid: rid ?? uid(),
  gid: group?.gid,
  groupLabel: group?.groupLabel,
  groupNote: group?.groupNote,
  description: '', hsn: DEFAULT_HSN, qty: '1', uom: DEFAULT_UOM, rate: '', gstRate: DEFAULT_GST,
  tooling: false, attributes: {},
});

/** A new extra field starts unnamed — the editor asks for a name; `cleanColumns` drops it if left blank.
 *  `display` is optional: left out, `splitColumns` decides (column while there are few fields, spec after). */
export const newColumn = (label = '', display?: ColumnDef['display']): ColumnDef =>
  display ? { id: uid(), label, display } : { id: uid(), label };

/** True when the row's tax/unit details differ from the shop defaults (HSN, unit, GST %). */
export const rowTaxDiffers = (r: LineRow) =>
  (r.hsn ?? '').trim() !== DEFAULT_HSN || (r.uom ?? '').trim().toUpperCase() !== DEFAULT_UOM || String(Number(r.gstRate)) !== DEFAULT_GST;

/** True when the user has typed anything meaningful into the row. */
export const rowIsFilled = (r: LineRow) =>
  !!r.description.trim() || !!r.rate.trim() || r.qty !== '1' || Object.values(r.attributes ?? {}).some((v) => v.trim());

export const lineAmount = (r: LineRow) => (Number(r.qty) || 0) * (Number(r.rate) || 0);
export const groupSubtotal = (rows: LineRow[], gid: string) =>
  rows.filter((r) => r.gid === gid).reduce((s, r) => s + lineAmount(r), 0);

// Field caps — kept at/under the DB + zod limits so a long value is clamped here
// rather than blowing up the whole save server-side.
const CAP = { hsn: 10, uom: 10, group: 120, groupNote: 200, attr: 2000, colLabel: 60 } as const;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Drop unnamed/blank fields and trim+clamp labels, keeping each field's chosen
 *  `display`. An unnamed field must never be able to fail a save — it's simply ignored. */
export function cleanColumns(columns: ColumnDef[]): ColumnDef[] {
  const seen = new Set<string>();
  const out: ColumnDef[] = [];
  for (const c of columns) {
    const label = clamp(c.label.trim(), CAP.colLabel);
    if (!label || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c.display ? { id: c.id, label, display: c.display } : { id: c.id, label });
  }
  return out;
}

/** Line the rows the way they will be saved (grouped-contiguous, then ungrouped). */
function orderedForSave(rows: LineRow[]): LineRow[] {
  const gids: string[] = [];
  for (const r of rows) if (r.gid && !gids.includes(r.gid)) gids.push(r.gid);
  return [...gids.flatMap((gid) => rows.filter((r) => r.gid === gid)), ...rows.filter((r) => !r.gid)];
}

export type ItemPayload = {
  description: string; hsn: string; qty: number; uom: string; rate: number; gstRate: number;
  isToolingCharge: boolean; groupLabel?: string; groupNote?: string; attributes: Record<string, string>;
};

/**
 * Flatten editor rows into the persisted order — every group's rows contiguously
 * (in group order), then ungrouped rows. Blank-description rows are dropped.
 * Every field is clamped to its limit so no single value can fail the save.
 */
export function serializeItems(rows: LineRow[], columns: ColumnDef[]): ItemPayload[] {
  const validCols = new Set(cleanColumns(columns).map((c) => c.id));
  return orderedForSave(rows)
    .filter((r) => r.description.trim())
    .map((r) => {
      const attributes: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.attributes ?? {})) {
        if (validCols.has(k) && v.trim()) attributes[k] = clamp(v, CAP.attr);
      }
      const label = clamp((r.gid ? r.groupLabel ?? '' : '').trim(), CAP.group);
      // The part's detail rides on every row of the part (that is how it is
      // stored and how the renderers read it back); an ungrouped row has none.
      const note = label ? clamp((r.groupNote ?? '').trim(), CAP.groupNote) : '';
      return {
        description: r.description.trim(), hsn: clamp((r.hsn ?? '').trim(), CAP.hsn),
        qty: Number(r.qty) || 0, uom: clamp((r.uom ?? '').trim(), CAP.uom) || 'NOS',
        rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0, isToolingCharge: !!r.tooling,
        groupLabel: label || undefined, groupNote: note || undefined, attributes,
      };
    });
}

type StoredItem = {
  description: string; hsn?: string | null; qty: unknown; uom: string; rate: unknown; gstRate: unknown;
  isToolingCharge?: boolean; groupLabel?: string | null; groupNote?: string | null;
  attributes?: Record<string, string> | null;
};

/** Rebuild editor rows from stored items — reconstruct a stable gid per run of
 *  consecutive rows sharing the same non-empty group label. The part's note is
 *  the first non-empty one in the run and is put back on every row of that run,
 *  so editing it in one place keeps the whole part in step. */
export function rowsFromStored(items: StoredItem[]): LineRow[] {
  let lastLabel: string | null = null;
  let lastGid: string | undefined;
  const rows = items.map((it) => {
    const label = (it.groupLabel ?? '').trim();
    let gid: string | undefined;
    if (label) {
      if (label === lastLabel && lastGid) gid = lastGid;
      else gid = uid();
      lastGid = gid;
    } else {
      lastGid = undefined;
    }
    lastLabel = label || null;
    return {
      rid: uid(), gid, groupLabel: label || undefined,
      groupNote: (label && (it.groupNote ?? '').trim()) || undefined,
      description: it.description, hsn: it.hsn ?? DEFAULT_HSN,
      qty: String(Number(it.qty)), uom: it.uom, rate: String(Number(it.rate)), gstRate: String(Number(it.gstRate)),
      tooling: !!it.isToolingCharge, attributes: { ...(it.attributes ?? {}) },
    } satisfies LineRow;
  });
  const noteOf = new Map<string, string>();
  for (const r of rows) if (r.gid && r.groupNote && !noteOf.has(r.gid)) noteOf.set(r.gid, r.groupNote);
  return rows.map((r) => (r.gid && noteOf.has(r.gid) ? { ...r, groupNote: noteOf.get(r.gid) } : r));
}

export type ItemIssue = {
  rid: string;
  /** Editor-visible line number (counts every row the way the editor numbers them). */
  line: number;
  message: string;
  /** Which input to focus for this issue. */
  field?: 'description' | 'qty' | 'column';
  /** For column issues: the column whose name is missing. */
  colId?: string;
};

/**
 * Client-side BLOCKING issues — the conditions that would otherwise make the
 * server reject the whole document, plus a priced line with no description
 * (it would silently vanish on save). Surfaced inline so the user fixes them
 * before submitting. Pass `columns` to also catch an unnamed column with values.
 */
export function itemIssues(rows: LineRow[], columns: ColumnDef[] = []): ItemIssue[] {
  const issues: ItemIssue[] = [];
  let described = 0;
  orderedForSave(rows).forEach((r, i) => {
    const line = i + 1;
    const hasDesc = !!r.description.trim();
    if (hasDesc) described += 1;
    if (!hasDesc) {
      if (r.rate.trim() || r.qty !== '1') {
        issues.push({ rid: r.rid, line, field: 'description', message: `Line ${line} has a price but no description — write what it is for.` });
      }
      return;
    }
    if (!(Number(r.qty) > 0)) issues.push({ rid: r.rid, line, field: 'qty', message: `Line ${line}: Quantity must be more than 0.` });
  });
  if (described === 0) issues.push({ rid: '', line: 0, message: 'Add at least one item with a description.' });
  for (const c of columns) {
    if (c.label.trim()) continue;
    if (rows.some((r) => (r.attributes?.[c.id] ?? '').trim())) {
      issues.push({ rid: '', line: 0, field: 'column', colId: c.id, message: 'Name the new field or remove it.' });
    }
  }
  return issues;
}

/**
 * NON-blocking warnings the user may knowingly save past ("Save anyway"):
 * a described line with no rate, or with GST 0%.
 */
export function itemWarnings(rows: LineRow[]): ItemIssue[] {
  const out: ItemIssue[] = [];
  orderedForSave(rows).forEach((r, i) => {
    if (!r.description.trim()) return;
    const line = i + 1;
    if (!(Number(r.rate) > 0)) out.push({ rid: r.rid, line, message: `Line ${line} has no rate (₹0).` });
    if (r.gstRate.trim() !== '' && Number(r.gstRate) === 0) out.push({ rid: r.rid, line, message: `Line ${line} has GST 0% — usually 18%.` });
  });
  // Two parts with one name print as two blocks now, but count as one part
  // everywhere else (and to the assistant), so flag it before it confuses.
  const nameOf = new Map<string, string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (!r.gid) continue;
    const label = (r.groupLabel ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const owner = nameOf.get(key);
    if (owner && owner !== r.gid) dupes.add(label);
    else if (!owner) nameOf.set(key, r.gid);
  }
  for (const label of dupes) {
    out.push({ rid: '', line: 0, message: `Two parts are both called “${label}” — give them different names, or they will be treated as one part.` });
  }
  return out;
}

/** Per-field message for a row (shown next to the input). */
export const rowFieldMessage = (r: LineRow, field: 'description' | 'qty'): string | null => {
  if (field === 'qty') return rowQtyBad(r) ? 'Quantity must be more than 0' : null;
  if (!r.description.trim() && (r.rate.trim() || r.qty !== '1')) return 'Write what this line is for';
  return null;
};

/** True when a row will actually persist but has an invalid quantity. */
export const rowQtyBad = (r: LineRow) => !!r.description.trim() && !(Number(r.qty) > 0);
