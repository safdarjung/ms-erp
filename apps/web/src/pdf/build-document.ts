import { amountInWords, stateLabel, type Letterhead } from '@ms/core';
import { buildTaxLines, type DocumentData } from './document-template';
import { formatDate } from '@/lib/format';

// Turns stored quotation / bill rows into the template's DocumentData. Shared by
// the logged-in print routes and the public share links so a customer opening a
// shared link sees exactly what the shop prints. Presents stored figures only.

type ItemRow = {
  description: string; hsn: string | null; qty: string; uom: string; rate: string; taxableValue: string; gstRate: string;
  isToolingCharge?: boolean; groupLabel: string | null; groupNote: string | null; attributes: Record<string, string> | null;
};
type CustomerRow = { name: string; address: string | null; gstin: string | null; stateCode: string | null } | null;

function company(lh: Letterhead | null): DocumentData['company'] {
  return {
    name: lh?.name ?? 'M.S. ENTERPRISES',
    factory: lh?.factory ?? '',
    office: lh?.office ?? '',
    gstin: lh?.gstin ?? '',
    bank: lh?.bank ?? { name: '', acNo: '', ifsc: '' },
  };
}

function buyer(cust: CustomerRow): DocumentData['buyer'] {
  return {
    name: cust?.name ?? '—',
    addressLines: cust?.address ? [cust.address] : [],
    gstin: cust?.gstin ?? undefined,
    stateLabel: stateLabel(cust?.stateCode) || undefined,
  };
}

const itemsOf = (items: ItemRow[], tooling: boolean): DocumentData['items'] => items.map((i) => ({
  description: i.description,
  hsn: i.hsn ?? '',
  qty: Number(i.qty),
  uom: i.uom,
  rate: Number(i.rate),
  amount: Number(i.taxableValue),
  ...(tooling ? { isTooling: !!i.isToolingCharge } : {}),
  groupLabel: i.groupLabel ?? undefined,
  groupNote: i.groupNote ?? undefined,
  attributes: i.attributes ?? undefined,
}));

const termsOf = (terms: string | null, lh: Letterhead | null) =>
  terms ? terms.split(/\r?\n|\\n/).filter((l) => l.trim()) : (lh?.defaultTerms ?? []);

export function invoiceDocumentData(data: {
  invoice: {
    number: string; docDate: Date; poRef: string | null; placeOfSupply: string | null; isInterstate: boolean; type: string;
    subtotal: string; cgst: string; sgst: string; igst: string; roundOff: string; grandTotal: string;
    terms: string | null; notes: string | null; columnDefs: DocumentData['columns'] | null;
  };
  items: ItemRow[];
  customer: CustomerRow;
  letterhead: Letterhead | null;
}): DocumentData {
  const { invoice: inv, items, customer: cust, letterhead: lh } = data;
  const meta: DocumentData['meta'] = [{ label: 'Date', value: formatDate(inv.docDate) }];
  if (inv.poRef) meta.push({ label: 'PO Ref.', value: inv.poRef });
  if (inv.placeOfSupply) meta.push({ label: 'Place of Supply', value: stateLabel(inv.placeOfSupply) });
  meta.push({ label: 'Tax Type', value: inv.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST' });
  return {
    docLabel: inv.type === 'proforma' ? 'PROFORMA INVOICE' : 'TAX INVOICE',
    company: company(lh),
    buyer: buyer(cust),
    number: inv.number,
    meta,
    columns: inv.columnDefs ?? [],
    items: itemsOf(items, false),
    totals: {
      subtotal: Number(inv.subtotal),
      taxLines: buildTaxLines(inv.isInterstate, items.map((i) => Number(i.gstRate)), {
        cgst: Number(inv.cgst), sgst: Number(inv.sgst), igst: Number(inv.igst),
      }),
      roundOff: Number(inv.roundOff) || undefined,
      grand: Number(inv.grandTotal),
      words: amountInWords(Number(inv.grandTotal)),
    },
    terms: termsOf(inv.terms, lh),
    notes: inv.notes ?? undefined,
  };
}

export function quotationDocumentData(data: {
  quotation: {
    number: string; docDate: Date; validityDays: number; placeOfSupply: string | null; isInterstate: boolean;
    subtotal: string; cgst: string; sgst: string; igst: string; grandTotal: string;
    terms: string | null; notes: string | null; columnDefs: DocumentData['columns'] | null;
  };
  items: ItemRow[];
  customer: CustomerRow;
  letterhead: Letterhead | null;
}): DocumentData {
  const { quotation: q, items, customer: cust, letterhead: lh } = data;
  const validTill = new Date(q.docDate.getTime() + q.validityDays * 86_400_000);
  const meta: DocumentData['meta'] = [
    { label: 'Date', value: formatDate(q.docDate) },
    { label: 'Valid Until', value: `${formatDate(validTill)} (${q.validityDays} days)` },
  ];
  if (q.placeOfSupply) meta.push({ label: 'Place of Supply', value: stateLabel(q.placeOfSupply) });
  meta.push({ label: 'Tax Type', value: q.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST' });
  return {
    docLabel: 'QUOTATION',
    company: company(lh),
    buyer: buyer(cust),
    number: q.number,
    meta,
    columns: q.columnDefs ?? [],
    items: itemsOf(items, true),
    totals: {
      subtotal: Number(q.subtotal),
      taxLines: buildTaxLines(q.isInterstate, items.map((i) => Number(i.gstRate)), {
        cgst: Number(q.cgst), sgst: Number(q.sgst), igst: Number(q.igst),
      }),
      grand: Number(q.grandTotal),
      words: amountInWords(Number(q.grandTotal)),
    },
    terms: termsOf(q.terms, lh),
    notes: q.notes ?? undefined,
  };
}

/** `?print=1` — open the browser's print dialog (Save as PDF) once the page has loaded. */
export function withAutoPrint(html: string): string {
  return html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
}
