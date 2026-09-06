// How a document's user-defined fields are laid out — shared by the PDF, the
// on-screen tables, the line editor and the AI's confirmation card so all four
// always agree. Pure functions, no rendering.

export type ColumnLike = { id: string; label: string; display?: 'column' | 'spec' };

/** Custom fields per document. Spec-line rendering makes many fields practical. */
export const MAX_DOC_COLUMNS = 16;
/** Line items per document. */
export const MAX_DOC_LINES = 60;

/**
 * With no explicit choice, up to this many fields print as table columns; more
 * than that and they all move under the description instead. Keeps an A4 sheet
 * readable when a die needs material + hardness + size + thickness…
 */
export const AUTO_COLUMN_LIMIT = 2;

/**
 * Split a document's fields into the ones that get their own table column and
 * the ones printed under the item description.
 *
 * A field's own `display` always wins. Fields that don't say stay columns while
 * there are few of them (so existing documents look unchanged) and become spec
 * text once the table would get too wide.
 */
export function splitColumns<T extends ColumnLike>(columns: readonly T[] | null | undefined): {
  tableCols: T[];
  specCols: T[];
} {
  const named = (columns ?? []).filter((c) => c?.label?.trim());
  const undecided = named.filter((c) => !c.display);
  const autoIsColumn = undecided.length <= AUTO_COLUMN_LIMIT
    && named.filter((c) => c.display === 'column').length + undecided.length <= AUTO_COLUMN_LIMIT;
  const tableCols: T[] = [];
  const specCols: T[] = [];
  for (const c of named) {
    const asColumn = c.display === 'column' || (!c.display && autoIsColumn);
    (asColumn ? tableCols : specCols).push(c);
  }
  return { tableCols, specCols };
}

/** True when this field prints under the description rather than as a column. */
export const isSpecColumn = (columns: readonly ColumnLike[] | null | undefined, id: string): boolean =>
  splitColumns(columns).specCols.some((c) => c.id === id);

export type SpecPair = { label: string; value: string };

/** The filled spec fields of one item, in the document's field order. */
export function itemSpecs(
  columns: readonly ColumnLike[] | null | undefined,
  attributes: Record<string, string> | null | undefined,
): SpecPair[] {
  const { specCols } = splitColumns(columns);
  const out: SpecPair[] = [];
  for (const c of specCols) {
    const value = (attributes?.[c.id] ?? '').trim();
    if (value) out.push({ label: c.label.trim(), value });
  }
  return out;
}

/** "Material: D2 · Hardness: 58–60 HRC" — one line under the description. */
export const formatSpecs = (specs: SpecPair[]): string =>
  specs.map((s) => `${s.label}: ${s.value}`).join(' · ');

export type GroupedRun<T> = { label: string; note: string; items: T[] };

/**
 * Split items into the runs the document prints: consecutive rows sharing a
 * part name form one block (heading + subtotal); ungrouped rows stand alone.
 * The block's note is the first non-empty `groupNote` in the run.
 */
export function groupRuns<T extends { groupLabel?: string | null; groupNote?: string | null }>(
  items: readonly T[],
): GroupedRun<T>[] {
  const runs: GroupedRun<T>[] = [];
  for (const it of items) {
    const label = (it.groupLabel ?? '').trim();
    const note = (it.groupNote ?? '').trim();
    const last = runs[runs.length - 1];
    if (last && last.label === label) {
      last.items.push(it);
      if (!last.note && note) last.note = note;
    } else {
      runs.push({ label, note, items: [it] });
    }
  }
  return runs;
}
