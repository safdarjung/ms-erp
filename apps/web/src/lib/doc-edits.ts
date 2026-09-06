// Line-level edit operations for quotations / invoices / orders, applied by the
// AI agent's update_* actions. The model references lines by the S.No printed on
// the document and describes WHAT to change; this module resolves the ops
// against the current lines into a full replacement item list, plus a
// human-readable change list for the confirmation card.
//
// Pure & dependency-free (tested with node's built-in runner — see __tests__).
// Every number here is still re-validated by zod and re-priced by @ms/core
// before anything is written.

export type DocColumn = { id: string; label: string; display?: 'column' | 'spec' };

export type DocLine = {
  description: string;
  hsn?: string;
  qty: number;
  uom: string;
  rate: number;
  gstRate: number;
  isToolingCharge?: boolean;
  /** Part / section heading (blank = ungrouped). */
  groupLabel?: string;
  /** Detail printed beside the part heading — same on every line of the part. */
  groupNote?: string;
  /** Custom-field values keyed by DocColumn.id. */
  attributes: Record<string, string>;
};

/** Custom-column values as the model sends them: by column NAME, not id. */
export type AttrPair = { name: string; value: string };

export type NewLineInput = {
  description?: string; hsn?: string; qty?: number; uom?: string; rate?: number; gstRate?: number;
  isToolingCharge?: boolean; groupLabel?: string; groupNote?: string;
  attributes?: AttrPair[] | Record<string, string>;
};

/** One edit operation — a flat shape (the tool schema has no oneOf). */
export type EditOp = {
  op: 'update' | 'add' | 'remove' | 'move' | 'adjust_rates' | 'set_gst' | 'set_group'
    | 'rename_group' | 'set_group_note' | 'set_specs'
    | 'set_column' | 'rename_column' | 'remove_column' | 'set_column_display';
  /** Target line (S.No as printed, BEFORE any edits in this batch). */
  line?: number;
  /** Several target lines (adjust_rates / set_gst / set_group). */
  lines?: number[];
  /** Scope by part name (adjust_rates / set_gst). */
  groupLabel?: string;
  toLine?: number;
  afterLine?: number;
  item?: NewLineInput;
  // 'update' fields
  description?: string; hsn?: string; qty?: number; uom?: string; rate?: number; gstRate?: number;
  isToolingCharge?: boolean;
  attributes?: AttrPair[] | Record<string, string>;
  // adjust_rates
  percent?: number; amount?: number; roundTo?: number;
  // groups / fields
  from?: string; to?: string; name?: string;
  values?: { line: number; value: string }[];
  /** set_group / set_group_note / add: the part's detail line ('' clears it). */
  note?: string;
  /** set_column_display: where this field prints. */
  display?: 'column' | 'spec';
  /** set_specs: the same field values applied to every line in scope. */
  specs?: AttrPair[];
};

export type ApplyResult = { lines: DocLine[]; columns: DocColumn[]; changes: string[] };

// Mirrors @ms/core's caps. Kept literal so this engine (and its tests) stay
// dependency-free; zod re-checks the real limits before anything is saved.
export const MAX_DOC_LINES = 60;
export const MAX_DOC_COLUMNS = 16;
const DEFAULT_HSN = '84807100';
const CAP_NOTE = 200;

// ── Formatting ──────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const inr = (n: number): string =>
  '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const q = (s: string) => `“${s.length > 40 ? s.slice(0, 40) + '…' : s}”`;
const norm = (s: string) => s.trim().toLowerCase();
const listLines = (ns: number[]) => (ns.length === 1 ? `line ${ns[0]}` : `lines ${ns.join(', ')}`);

// ── Columns ─────────────────────────────────────────────────────────────────

/** Fresh column id that collides with nothing already in use. */
function nextColumnId(existing: DocColumn[]): string {
  const used = new Set(existing.map((c) => c.id));
  let i = existing.length + 1;
  while (used.has(`c${i}`)) i += 1;
  return `c${i}`;
}

function findColumn(columns: DocColumn[], name: string): DocColumn | undefined {
  return columns.find((c) => norm(c.label) === norm(name));
}

/**
 * Resolve attribute pairs (by column name) to an id-keyed record, creating any
 * column that does not exist yet. Already id-keyed records pass through when
 * their keys are known ids. Returns the (possibly grown) column list.
 */
export function resolveAttributes(
  columns: DocColumn[],
  attrs: AttrPair[] | Record<string, string> | undefined,
): { attributes: Record<string, string>; columns: DocColumn[]; created: string[] } {
  let cols = columns;
  const out: Record<string, string> = {};
  const created: string[] = [];
  if (!attrs) return { attributes: out, columns: cols, created };
  const pairs: AttrPair[] = Array.isArray(attrs)
    ? attrs
    : Object.entries(attrs).map(([k, v]) => {
        const known = cols.find((c) => c.id === k);
        return { name: known ? known.label : k, value: v };
      });
  for (const p of pairs) {
    const name = String(p?.name ?? '').trim();
    const value = String(p?.value ?? '').trim();
    if (!name) continue;
    let col = findColumn(cols, name);
    if (!col) {
      if (cols.length >= MAX_DOC_COLUMNS) throw new Error(`Cannot add field ${q(name)} — a document can have at most ${MAX_DOC_COLUMNS} extra fields.`);
      col = { id: nextColumnId(cols), label: name.slice(0, 60) };
      cols = [...cols, col];
      created.push(col.label);
    }
    if (value) out[col.id] = value.slice(0, 2000);
  }
  return { attributes: out, columns: cols, created };
}

// ── Lines ───────────────────────────────────────────────────────────────────

type Tagged = DocLine & { origLine?: number };

const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

function normalizeLine(l: Partial<DocLine>, columns: DocColumn[]): DocLine {
  const desc = String(l.description ?? '').trim();
  if (!desc) throw new Error('Every line needs a description.');
  const qty = num(l.qty, 1);
  if (!(qty > 0)) throw new Error(`Line ${q(desc)}: quantity must be greater than 0.`);
  const rate = num(l.rate, 0);
  if (rate < 0) throw new Error(`Line ${q(desc)}: rate cannot be negative.`);
  const gstRate = num(l.gstRate, 18);
  if (gstRate < 0 || gstRate > 40) throw new Error(`Line ${q(desc)}: GST % must be between 0 and 40.`);
  const attributes: Record<string, string> = {};
  const ids = new Set(columns.map((c) => c.id));
  for (const [k, v] of Object.entries(l.attributes ?? {})) if (ids.has(k) && String(v).trim()) attributes[k] = String(v);
  const group = String(l.groupLabel ?? '').trim().slice(0, 120);
  const note = String(l.groupNote ?? '').trim().slice(0, CAP_NOTE);
  return {
    description: desc,
    hsn: String(l.hsn ?? '').trim().slice(0, 10) || DEFAULT_HSN,
    qty: r2(qty), uom: (String(l.uom ?? '').trim() || 'NOS').slice(0, 10), rate: r2(rate), gstRate,
    ...(l.isToolingCharge !== undefined ? { isToolingCharge: !!l.isToolingCharge } : {}),
    ...(group ? { groupLabel: group } : {}),
    ...(group && note ? { groupNote: note } : {}),
    attributes,
  };
}

/** The detail already recorded for a part, so a line joining it inherits the same one. */
function noteOfGroup(lines: { groupLabel?: string; groupNote?: string }[], label: string): string | undefined {
  const g = norm(label);
  return lines.find((l) => norm(l.groupLabel ?? '') === g && (l.groupNote ?? '').trim())?.groupNote;
}

/**
 * Every line of a part must carry that part's detail, so the note survives
 * reordering and shows up wherever the run starts.
 */
function syncGroupNotes(lines: DocLine[]): void {
  const byGroup = new Map<string, string>();
  for (const l of lines) {
    const g = norm(l.groupLabel ?? '');
    if (!g) continue;
    const note = (l.groupNote ?? '').trim();
    if (note && !byGroup.has(g)) byGroup.set(g, note);
  }
  for (const l of lines) {
    const g = norm(l.groupLabel ?? '');
    if (!g) { delete l.groupNote; continue; }
    const note = byGroup.get(g);
    if (note) l.groupNote = note; else delete l.groupNote;
  }
}

/** How many separate printed blocks each part name currently occupies. */
function countRuns(lines: { groupLabel?: string }[]): Map<string, number> {
  const runs = new Map<string, number>();
  let last: string | undefined;
  for (const l of lines) {
    const g = (l.groupLabel ?? '').trim();
    if (g && g !== last) runs.set(g, (runs.get(g) ?? 0) + 1);
    last = g || undefined;
  }
  return runs;
}

/** Make each part's lines contiguous (at the position of its first line); ungrouped lines stay put. */
export function regroupLines<T extends { groupLabel?: string }>(lines: T[]): T[] {
  const out: T[] = [];
  const placed = new Set<number>();
  lines.forEach((l, i) => {
    if (placed.has(i)) return;
    const g = (l.groupLabel ?? '').trim();
    if (!g) { out.push(l); placed.add(i); return; }
    lines.forEach((m, j) => {
      if (j >= i && !placed.has(j) && (m.groupLabel ?? '').trim() === g) { out.push(m); placed.add(j); }
    });
  });
  return out;
}

function fieldDiffs(before: DocLine, after: DocLine, columns: DocColumn[]): string[] {
  const d: string[] = [];
  if (before.description !== after.description) d.push(`description → ${q(after.description)}`);
  if (before.qty !== after.qty) d.push(`qty ${before.qty} → ${after.qty}`);
  if (before.uom !== after.uom) d.push(`UOM ${before.uom} → ${after.uom}`);
  if (before.rate !== after.rate) d.push(`rate ${inr(before.rate)} → ${inr(after.rate)}`);
  if (before.gstRate !== after.gstRate) d.push(`GST ${before.gstRate}% → ${after.gstRate}%`);
  if ((before.hsn ?? '') !== (after.hsn ?? '')) d.push(`HSN ${before.hsn || '—'} → ${after.hsn || '—'}`);
  if (!!before.isToolingCharge !== !!after.isToolingCharge) d.push(after.isToolingCharge ? 'marked as a one-time charge' : 'no longer a one-time charge');
  if ((before.groupLabel ?? '') !== (after.groupLabel ?? '')) d.push(`part ${before.groupLabel ? q(before.groupLabel) : '—'} → ${after.groupLabel ? q(after.groupLabel) : '— (no part)'}`);
  if ((before.groupNote ?? '') !== (after.groupNote ?? '')) d.push(`part detail ${after.groupNote ? q(after.groupNote) : 'removed'}`);
  for (const c of columns) {
    const b = before.attributes[c.id] ?? '', a = after.attributes[c.id] ?? '';
    if (b !== a) d.push(`${c.label}: ${b || '—'} → ${a || '—'}`);
  }
  return d;
}

/** Build the ordered set of target lines for scoped ops (lines / groupLabel / all). */
function scopeOf(tagged: Tagged[], op: EditOp, what: string): Tagged[] {
  if (op.lines?.length) return op.lines.map((n) => requireLine(tagged, n));
  if (op.line !== undefined) return [requireLine(tagged, op.line)];
  if (op.groupLabel !== undefined && op.groupLabel !== '') {
    const g = norm(op.groupLabel);
    const hit = tagged.filter((l) => norm(l.groupLabel ?? '') === g);
    if (!hit.length) throw new Error(`No part named ${q(op.groupLabel)} on this document (${what}).`);
    return hit;
  }
  return tagged;
}

function requireLine(tagged: Tagged[], n: number | undefined): Tagged {
  const line = Number(n);
  const hit = tagged.find((l) => l.origLine === line);
  if (!Number.isInteger(line) || !hit) {
    const max = tagged.reduce((m, l) => Math.max(m, l.origLine ?? 0), 0);
    throw new Error(`Line ${n} does not exist — the document has ${max} lines (line numbers are the S.No as printed; read it with get_document).`);
  }
  return hit;
}

/**
 * Apply edit operations to the current lines. Line numbers in every op refer to
 * the document as it stood BEFORE this batch (so the model can plan all edits
 * from one get_document read). Lines added in this batch cannot be targeted by
 * later ops in the same batch.
 */
export function applyDocEdits(current: DocLine[], columns: DocColumn[], ops: EditOp[]): ApplyResult {
  let cols: DocColumn[] = columns.map((c) => ({ id: c.id, label: c.label }));
  let lines: Tagged[] = current.map((l, i) => ({ ...l, attributes: { ...l.attributes }, origLine: i + 1 }));
  const changes: string[] = [];
  if (!Array.isArray(ops) || !ops.length) throw new Error('No edits given — pass at least one edit operation.');

  for (const op of ops) {
    switch (op.op) {
      case 'update': {
        const target = requireLine(lines, op.line);
        const before: DocLine = { ...target, attributes: { ...target.attributes } };
        const patch: Partial<DocLine> = {};
        if (op.description !== undefined) patch.description = op.description;
        if (op.hsn !== undefined) patch.hsn = op.hsn;
        if (op.qty !== undefined) patch.qty = op.qty;
        if (op.uom !== undefined) patch.uom = op.uom;
        if (op.rate !== undefined) patch.rate = op.rate;
        if (op.gstRate !== undefined) patch.gstRate = op.gstRate;
        if (op.isToolingCharge !== undefined) patch.isToolingCharge = op.isToolingCharge;
        if (op.groupLabel !== undefined) {
          patch.groupLabel = op.groupLabel;
          // Joining a part means taking that part's detail with it.
          patch.groupNote = op.note !== undefined ? op.note : (noteOfGroup(lines, op.groupLabel) ?? '');
        } else if (op.note !== undefined) patch.groupNote = op.note;
        let attributes = target.attributes;
        if (op.attributes !== undefined) {
          const r = resolveAttributes(cols, op.attributes);
          cols = r.columns;
          attributes = { ...target.attributes, ...r.attributes };
          for (const c of r.created) changes.push(`New field ${q(c)}`);
        }
        const next = normalizeLine({ ...target, ...patch, attributes }, cols);
        Object.assign(target, next);
        const d = fieldDiffs(before, next, cols);
        if (d.length) changes.push(`Line ${op.line} ${q(before.description)}: ${d.join('; ')}`);
        break;
      }
      case 'add': {
        const it = op.item ?? {};
        if (lines.length >= MAX_DOC_LINES) throw new Error(`Cannot add a line — a document can have at most ${MAX_DOC_LINES} lines.`);
        const r = resolveAttributes(cols, it.attributes);
        cols = r.columns;
        for (const c of r.created) changes.push(`New field ${q(c)}`);
        const inheritedNote = it.groupLabel ? noteOfGroup(lines, it.groupLabel) : undefined;
        const line = normalizeLine(
          { ...it, groupNote: it.groupNote ?? op.note ?? inheritedNote, attributes: r.attributes },
          cols,
        );
        let idx = lines.length;
        if (op.afterLine !== undefined) {
          if (op.afterLine === 0) idx = 0;
          else idx = lines.indexOf(requireLine(lines, op.afterLine)) + 1;
        } else if (line.groupLabel) {
          // No position given — append to the end of that part when it exists.
          const g = norm(line.groupLabel);
          const last = lines.map((l, i) => (norm(l.groupLabel ?? '') === g ? i : -1)).filter((i) => i >= 0).pop();
          if (last !== undefined) idx = last + 1;
        }
        lines = [...lines.slice(0, idx), { ...line }, ...lines.slice(idx)];
        changes.push(`+ Added ${q(line.description)} — ${line.qty} ${line.uom} × ${inr(line.rate)}${line.groupLabel ? ` under ${q(line.groupLabel)}` : ''}`);
        break;
      }
      case 'remove': {
        const target = requireLine(lines, op.line);
        lines = lines.filter((l) => l !== target);
        if (!lines.length) throw new Error('Cannot remove the last line — a document needs at least one line.');
        changes.push(`− Removed line ${op.line} ${q(target.description)} (${inr(r2(target.qty * target.rate))})`);
        break;
      }
      case 'move': {
        const target = requireLine(lines, op.line);
        const dest = requireLine(lines, op.toLine);
        if (target === dest) break;
        const rest = lines.filter((l) => l !== target);
        const j = rest.indexOf(dest);
        const movingDown = lines.indexOf(target) < lines.indexOf(dest);
        const at = movingDown ? j + 1 : j;
        lines = [...rest.slice(0, at), target, ...rest.slice(at)];
        if (op.groupLabel !== undefined) Object.assign(target, normalizeLine({ ...target, groupLabel: op.groupLabel }, cols));
        changes.push(`Moved line ${op.line} ${q(target.description)} to position ${op.toLine}`);
        break;
      }
      case 'adjust_rates': {
        const targets = scopeOf(lines, op, 'adjust_rates');
        const pct = op.percent !== undefined ? Number(op.percent) : undefined;
        const amt = op.amount !== undefined ? Number(op.amount) : undefined;
        if (pct === undefined && amt === undefined) throw new Error('adjust_rates needs percent or amount.');
        const step = op.roundTo && op.roundTo > 0 ? op.roundTo : 0;
        const details: string[] = [];
        for (const t of targets) {
          const before = t.rate;
          let next = pct !== undefined ? before * (1 + pct / 100) : before + (amt ?? 0);
          if (step) next = Math.round(next / step) * step;
          next = Math.max(0, r2(next));
          t.rate = next;
          details.push(`${q(t.description)} ${inr(before)} → ${inr(next)}`);
        }
        const how = pct !== undefined ? `${pct > 0 ? '+' : ''}${pct}%` : `${(amt ?? 0) > 0 ? '+' : '−'}${inr(Math.abs(amt ?? 0))}`;
        const scope = op.groupLabel ? ` (part ${q(op.groupLabel)})` : op.lines?.length || op.line !== undefined ? '' : ' (all lines)';
        changes.push(`Rates ${how} on ${targets.length} line${targets.length === 1 ? '' : 's'}${scope}${step ? `, rounded to ${inr(step)}` : ''}`);
        changes.push(...details.slice(0, 8).map((d) => `  · ${d}`));
        if (details.length > 8) changes.push(`  · …and ${details.length - 8} more`);
        break;
      }
      case 'set_gst': {
        const targets = scopeOf(lines, op, 'set_gst');
        const g = Number(op.gstRate);
        if (!Number.isFinite(g) || g < 0 || g > 40) throw new Error('set_gst needs a gstRate between 0 and 40.');
        const froms = new Set(targets.map((t) => t.gstRate));
        for (const t of targets) t.gstRate = g;
        changes.push(`GST ${[...froms].map((f) => `${f}%`).join('/')} → ${g}% on ${targets.length} line${targets.length === 1 ? '' : 's'}${op.groupLabel ? ` (part ${q(op.groupLabel)})` : ''}`);
        break;
      }
      case 'set_group': {
        const targets = (op.lines?.length ? op.lines : op.line !== undefined ? [op.line] : []).map((n) => requireLine(lines, n));
        if (!targets.length) throw new Error('set_group needs lines.');
        const label = String(op.groupLabel ?? '').trim().slice(0, 120);
        const note = op.note !== undefined
          ? String(op.note).trim().slice(0, CAP_NOTE)
          : (label ? noteOfGroup(lines, label) ?? '' : '');
        for (const t of targets) {
          if (label) { t.groupLabel = label; if (note) t.groupNote = note; else delete t.groupNote; }
          else { delete t.groupLabel; delete t.groupNote; }
        }
        changes.push(`${listLines(targets.map((t) => t.origLine!))} → ${label ? `part ${q(label)}` : 'no part'}`);
        break;
      }
      case 'rename_group': {
        const from = String(op.from ?? '').trim(), to = String(op.to ?? '').trim().slice(0, 120);
        if (!from || !to) throw new Error('rename_group needs from and to.');
        const hit = lines.filter((l) => norm(l.groupLabel ?? '') === norm(from));
        if (!hit.length) throw new Error(`No part named ${q(from)} on this document.`);
        for (const l of hit) l.groupLabel = to;
        changes.push(`Part ${q(from)} → ${q(to)} (${hit.length} line${hit.length === 1 ? '' : 's'})`);
        break;
      }
      case 'set_group_note': {
        const label = String(op.groupLabel ?? op.name ?? '').trim();
        if (!label) throw new Error('set_group_note needs the part name in groupLabel.');
        const hit = lines.filter((l) => norm(l.groupLabel ?? '') === norm(label));
        if (!hit.length) throw new Error(`No part named ${q(label)} on this document.`);
        const note = String(op.note ?? '').trim().slice(0, CAP_NOTE);
        for (const l of hit) { if (note) l.groupNote = note; else delete l.groupNote; }
        changes.push(note ? `Part ${q(hit[0]!.groupLabel!)} detail → ${q(note)}` : `Part ${q(hit[0]!.groupLabel!)} detail removed`);
        break;
      }
      case 'set_specs': {
        const targets = scopeOf(lines, op, 'set_specs');
        if (!op.specs?.length) throw new Error('set_specs needs specs ({name,value} pairs).');
        // Clearing a field the document doesn't have is a no-op, not a reason to
        // create an empty one.
        const usable = op.specs.filter((sp) => String(sp?.value ?? '').trim() || findColumn(cols, String(sp?.name ?? '')));
        const r = resolveAttributes(cols, usable);
        cols = r.columns;
        for (const c of r.created) changes.push(`New field ${q(c)}`);
        // A blank value clears that field on those lines.
        const clearIds = new Set(
          usable.filter((s) => !String(s?.value ?? '').trim())
            .map((s) => cols.find((c) => norm(c.label) === norm(String(s?.name ?? '')))?.id)
            .filter((id): id is string => !!id),
        );
        for (const t of targets) {
          Object.assign(t.attributes, r.attributes);
          for (const id of clearIds) delete t.attributes[id];
        }
        const shown = Object.entries(r.attributes)
          .map(([id, v]) => `${cols.find((c) => c.id === id)?.label ?? id}: ${v}`).join(', ');
        const scope = op.groupLabel ? ` of part ${q(op.groupLabel)}` : '';
        changes.push(`${targets.length} line${targets.length === 1 ? '' : 's'}${scope}: ${shown || 'fields cleared'}`);
        break;
      }
      case 'set_column_display': {
        const col = findColumn(cols, String(op.name ?? op.from ?? ''));
        if (!col) throw new Error(`No field named ${q(String(op.name ?? op.from ?? ''))}.`);
        const display = op.display === 'column' || op.display === 'spec' ? op.display : undefined;
        if (!display) throw new Error("set_column_display needs display: 'column' or 'spec'.");
        cols = cols.map((c) => (c.id === col.id ? { ...c, display } : c));
        changes.push(`Field ${q(col.label)} now shows ${display === 'column' ? 'as its own column' : 'under the item'}`);
        break;
      }
      case 'set_column': {
        const name = String(op.name ?? '').trim();
        if (!name) throw new Error('set_column needs a field name.');
        let col = findColumn(cols, name);
        if (!col) {
          if (cols.length >= MAX_DOC_COLUMNS) throw new Error(`Cannot add field ${q(name)} — at most ${MAX_DOC_COLUMNS} extra fields.`);
          col = { id: nextColumnId(cols), label: name.slice(0, 60), ...(op.display ? { display: op.display } : {}) };
          cols = [...cols, col];
          changes.push(`New field ${q(col.label)}`);
        }
        let n = 0;
        for (const v of op.values ?? []) {
          const t = requireLine(lines, v.line);
          const val = String(v.value ?? '').trim();
          if (val) t.attributes[col.id] = val.slice(0, 2000); else delete t.attributes[col.id];
          n += 1;
        }
        if (n) changes.push(`Field ${q(col.label)}: ${n} value${n === 1 ? '' : 's'} set`);
        break;
      }
      case 'rename_column': {
        const col = findColumn(cols, String(op.from ?? ''));
        if (!col) throw new Error(`No field named ${q(String(op.from ?? ''))}.`);
        const to = String(op.to ?? '').trim().slice(0, 60);
        if (!to) throw new Error('rename_column needs a new name.');
        cols = cols.map((c) => (c.id === col.id ? { ...c, label: to } : c));
        changes.push(`Field ${q(col.label)} → ${q(to)}`);
        break;
      }
      case 'remove_column': {
        const col = findColumn(cols, String(op.name ?? ''));
        if (!col) throw new Error(`No field named ${q(String(op.name ?? ''))}.`);
        cols = cols.filter((c) => c.id !== col.id);
        for (const l of lines) delete l.attributes[col.id];
        changes.push(`Field ${q(col.label)} removed`);
        break;
      }
      default:
        throw new Error(`Unknown edit op "${String((op as { op?: unknown }).op)}".`);
    }
  }

  if (lines.length > MAX_DOC_LINES) throw new Error(`Too many lines (max ${MAX_DOC_LINES}).`);
  // A part is identified by its name, so lines sharing one are always printed as
  // a single block. If the document happened to show that name in two separate
  // places, say so — the user must never discover a silent restructure.
  for (const [label, runs] of countRuns(lines)) {
    if (runs > 1) changes.push(`The ${runs} blocks named ${q(label)} are now one part`);
  }
  const validIds = new Set(cols.map((c) => c.id));
  const out: DocLine[] = regroupLines(lines).map(({ origLine: _o, ...l }) => ({
    ...l,
    attributes: Object.fromEntries(Object.entries(l.attributes).filter(([k]) => validIds.has(k))),
  }));
  syncGroupNotes(out);
  return { lines: out, columns: cols, changes };
}

/**
 * Describe a wholesale replacement (model sent a full `items` array) as a change
 * list: pairs lines by description, reports field diffs, then additions/removals.
 */
export function diffDocLines(before: DocLine[], after: DocLine[], columns: DocColumn[]): string[] {
  const changes: string[] = [];
  const unmatched = new Set(after.map((_, i) => i));
  before.forEach((b, i) => {
    let j = -1;
    for (const k of unmatched) { if (norm(after[k]!.description) === norm(b.description)) { j = k; break; } }
    if (j < 0) { changes.push(`− Removed line ${i + 1} ${q(b.description)} (${inr(r2(b.qty * b.rate))})`); return; }
    unmatched.delete(j);
    const d = fieldDiffs(b, after[j]!, columns);
    if (d.length) changes.push(`Line ${i + 1} ${q(b.description)}: ${d.join('; ')}`);
  });
  for (const j of unmatched) {
    const a = after[j]!;
    changes.push(`+ Added ${q(a.description)} — ${a.qty} ${a.uom} × ${inr(a.rate)}${a.groupLabel ? ` under ${q(a.groupLabel)}` : ''}`);
  }
  return changes;
}
