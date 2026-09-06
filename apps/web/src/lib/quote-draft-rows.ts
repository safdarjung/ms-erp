import { resolveAttributes, type DocColumn } from './doc-edits';

// Turns an AI quotation draft into what the line editor needs: the model names
// each item's specs ("Material: D2"), the editor stores them per document as
// fields with ids. Same name-matching rule as the assistant's own edits, so a
// draft and a chat edit build identical documents.

type DraftItem = {
  description: string; hsn?: string; qty: number; uom?: string; rate: number; gstRate: number;
  isToolingCharge?: boolean; groupLabel?: string; groupNote?: string;
  specs?: { name: string; value: string }[];
};

export type DraftStoredItem = {
  description: string; hsn: string | null; qty: number; uom: string; rate: number; gstRate: number;
  isToolingCharge: boolean; groupLabel: string | null; groupNote: string | null;
  attributes: Record<string, string>;
};

/**
 * Fold the draft's per-item specs into document fields (creating one per new
 * name, reusing existing ones case-insensitively) and return rows in the shape
 * `rowsFromStored` expects, plus the field list for the editor.
 *
 * `existing` lets a draft merge into a document that already has fields.
 */
export function draftToStored(
  items: DraftItem[],
  existing: DocColumn[] = [],
): { stored: DraftStoredItem[]; columns: DocColumn[] } {
  let columns = existing;
  const stored = items.map((it) => {
    const r = resolveAttributes(columns, it.specs);
    columns = r.columns;
    const group = (it.groupLabel ?? '').trim();
    return {
      description: it.description,
      hsn: it.hsn?.trim() ? it.hsn : null,
      qty: it.qty,
      uom: it.uom?.trim() || 'NOS',
      rate: it.rate,
      gstRate: it.gstRate,
      isToolingCharge: !!it.isToolingCharge,
      groupLabel: group || null,
      groupNote: group ? (it.groupNote ?? '').trim() || null : null,
      attributes: r.attributes,
    };
  });
  return { stored, columns };
}
