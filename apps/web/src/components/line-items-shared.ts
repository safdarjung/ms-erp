// Framework-agnostic line-item helpers shared by the client editor (forms) AND
// server components (document detail/edit pages). NOTE: this file must NOT be
// 'use client' — server components (edit pages) call rowsFromStored/serializeItems
// here, and RSC cannot invoke a function exported from a client module.
import { type ColumnDef } from '@ms/core';

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
export const uid = () => `r${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

export const emptyRow = (group?: { gid: string; groupLabel: string }): LineRow => ({
  rid: uid(),
  gid: group?.gid,
  groupLabel: group?.groupLabel,
  description: '', hsn: DEFAULT_HSN, qty: '1', uom: 'NOS', rate: '', gstRate: '18',
  tooling: false, attributes: {},
});

export const newColumn = (label: string): ColumnDef => ({ id: uid(), label });

export const lineAmount = (r: LineRow) => (Number(r.qty) || 0) * (Number(r.rate) || 0);
export const groupSubtotal = (rows: LineRow[], gid: string) =>
  rows.filter((r) => r.gid === gid).reduce((s, r) => s + lineAmount(r), 0);

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

/** Line the rows the way they will be saved (grouped-contiguous, then ungrouped). */
function orderedForSave(rows: LineRow[]): LineRow[] {
  const gids: string[] = [];
  for (const r of rows) if (r.gid && !gids.includes(r.gid)) gids.push(r.gid);
  return [...gids.flatMap((gid) => rows.filter((r) => r.gid === gid)), ...rows.filter((r) => !r.gid)];
}

export type ItemPayload = {
  description: string; hsn: string; qty: number; uom: string; rate: number; gstRate: number;
  isToolingCharge: boolean; groupLabel?: string; attributes: Record<string, string>;
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
      return {
        description: r.description.trim(), hsn: clamp((r.hsn ?? '').trim(), CAP.hsn),
        qty: Number(r.qty) || 0, uom: clamp((r.uom ?? '').trim(), CAP.uom) || 'NOS',
        rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0, isToolingCharge: !!r.tooling,
        groupLabel: label || undefined, attributes,
      };
    });
}

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
      else gid = uid();
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
export const rowQtyBad = (r: LineRow) => !!r.description.trim() && !(Number(r.qty) > 0);
