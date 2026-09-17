import 'server-only';
import {
  customer, quotation, quotationItem, taxInvoice, taxInvoiceItem,
  and, desc, eq, ilike, ne, sql, type Tx,
} from '@ms/db';

// "What did we charge for this last time?" — the shop's own pricing memory.
// Reads past quotation and bill lines (tenant-scoped by RLS) so the editor can
// autocomplete an item with its last rate, and the assistant can anchor a new
// quote on real history instead of guessing. Read-only; never feeds GST maths.

export type PriceHistoryRow = {
  description: string;
  hsn: string | null;
  uom: string;
  qty: number;
  rate: number;
  gstRate: number;
  docType: 'quotation' | 'invoice';
  docId: string;
  docNumber: string;
  /** YYYY-MM-DD */
  docDate: string;
  customerId: string;
  customerName: string;
  /** Part heading the line sat under, if any. */
  groupLabel: string | null;
};

export type ItemSuggestion = {
  description: string;
  hsn: string | null;
  uom: string;
  gstRate: number;
  /** Most recent ex-GST unit rate. */
  lastRate: number;
  /** YYYY-MM-DD of that rate. */
  lastDate: string;
  lastCustomer: string;
  lastDocNumber: string;
  /** How many past lines matched this description. */
  times: number;
  /** Lowest and highest rate seen (to show a range when it varies). */
  minRate: number;
  maxRate: number;
};

const MAX_LIMIT = 50;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Split a search into words; each must appear in the description (any order). */
function words(q: string | undefined): string[] {
  return (q ?? '').trim().split(/\s+/).filter((w) => w.length > 0).slice(0, 6);
}

/**
 * Past lines whose description contains every word of `q` (case-insensitive),
 * newest first, optionally for one customer. Quotations and bills are both
 * searched — a bill is the stronger signal (it was actually charged).
 */
export async function priceHistory(
  tx: Tx,
  opts: { q?: string; customerId?: string; limit?: number } = {},
): Promise<PriceHistoryRow[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), MAX_LIMIT);
  const terms = words(opts.q);

  const qFilters = terms.map((w) => ilike(quotationItem.description, `%${likeEscape(w)}%`));
  const iFilters = terms.map((w) => ilike(taxInvoiceItem.description, `%${likeEscape(w)}%`));
  if (opts.customerId) {
    qFilters.push(eq(quotation.customerId, opts.customerId));
    iFilters.push(eq(taxInvoice.customerId, opts.customerId));
  }
  // Cancelled bills never count as "what we charged".
  iFilters.push(ne(taxInvoice.status, 'cancelled'));

  const [qRows, iRows] = await Promise.all([
    tx.select({
      description: quotationItem.description, hsn: quotationItem.hsn, uom: quotationItem.uom,
      qty: quotationItem.qty, rate: quotationItem.rate, gstRate: quotationItem.gstRate, groupLabel: quotationItem.groupLabel,
      docId: quotation.id, docNumber: quotation.number, docDate: quotation.docDate,
      customerId: quotation.customerId, customerName: customer.name,
    }).from(quotationItem)
      .innerJoin(quotation, eq(quotationItem.quotationId, quotation.id))
      .leftJoin(customer, eq(quotation.customerId, customer.id))
      .where(qFilters.length ? and(...qFilters) : undefined)
      .orderBy(desc(quotation.docDate), desc(quotationItem.seq)).limit(limit),
    tx.select({
      description: taxInvoiceItem.description, hsn: taxInvoiceItem.hsn, uom: taxInvoiceItem.uom,
      qty: taxInvoiceItem.qty, rate: taxInvoiceItem.rate, gstRate: taxInvoiceItem.gstRate, groupLabel: taxInvoiceItem.groupLabel,
      docId: taxInvoice.id, docNumber: taxInvoice.number, docDate: taxInvoice.docDate,
      customerId: taxInvoice.customerId, customerName: customer.name,
    }).from(taxInvoiceItem)
      .innerJoin(taxInvoice, eq(taxInvoiceItem.invoiceId, taxInvoice.id))
      .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .where(and(...iFilters))
      .orderBy(desc(taxInvoice.docDate), desc(taxInvoiceItem.seq)).limit(limit),
  ]);

  const shape = (r: (typeof qRows)[number], docType: PriceHistoryRow['docType']): PriceHistoryRow => ({
    description: r.description, hsn: r.hsn ?? null, uom: r.uom, qty: Number(r.qty), rate: Number(r.rate),
    gstRate: Number(r.gstRate), docType, docId: r.docId, docNumber: r.docNumber, docDate: isoDay(r.docDate),
    customerId: r.customerId, customerName: r.customerName ?? '—', groupLabel: r.groupLabel ?? null,
  });

  return [...qRows.map((r) => shape(r, 'quotation')), ...iRows.map((r) => shape(r, 'invoice'))]
    .sort((a, b) => (a.docDate < b.docDate ? 1 : a.docDate > b.docDate ? -1 : 0))
    .slice(0, limit);
}

/**
 * Autocomplete for the line editor: distinct past descriptions matching `q`,
 * each with the most recent rate / HSN / unit and how often it was used.
 */
export async function suggestItems(tx: Tx, q: string, limit = 8): Promise<ItemSuggestion[]> {
  const rows = await priceHistory(tx, { q, limit: MAX_LIMIT });
  const byKey = new Map<string, ItemSuggestion>();
  for (const r of rows) {
    const key = r.description.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        description: r.description.trim(), hsn: r.hsn, uom: r.uom, gstRate: r.gstRate,
        lastRate: r.rate, lastDate: r.docDate, lastCustomer: r.customerName, lastDocNumber: r.docNumber,
        times: 1, minRate: r.rate, maxRate: r.rate,
      });
    } else {
      cur.times += 1;
      cur.minRate = Math.min(cur.minRate, r.rate);
      cur.maxRate = Math.max(cur.maxRate, r.rate);
    }
  }
  // Rows arrive newest-first, so the first sighting is the latest rate; rank
  // by how often the shop has used the line, then by recency.
  return [...byKey.values()]
    .sort((a, b) => b.times - a.times || (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, Math.min(Math.max(1, limit), 20));
}

/** Rate statistics for the assistant's `price_history` tool — plain numbers, no AI maths. */
export function summarizeRates(rows: PriceHistoryRow[]): { count: number; latest?: number; min?: number; max?: number; median?: number } {
  if (!rows.length) return { count: 0 };
  const rates = rows.map((r) => r.rate).sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length % 2 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
  return { count: rows.length, latest: rows[0]!.rate, min: rates[0], max: rates[rates.length - 1], median: Math.round(median * 100) / 100 };
}

/** SQL fragment reused by callers that need "not cancelled" bills. */
export const LIVE_INVOICE = sql`${taxInvoice.status} <> 'cancelled'`;
