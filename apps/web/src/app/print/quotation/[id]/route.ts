import type { NextRequest } from 'next/server';
import { amountInWords, stateLabel } from '@ms/core';
import { getQuotation } from '@/lib/queries';
import { buildTaxLines, renderDocumentHTML, type DocumentData } from '@/pdf/document-template';
import { formatDate } from '@/lib/format';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getQuotation(id);
  if (!data?.quotation) return new Response('Quotation not found', { status: 404 });

  const { quotation: q, items, customer: cust, letterhead: lh } = data;

  const validTill = new Date(q.docDate.getTime() + q.validityDays * 86_400_000);
  const meta: DocumentData['meta'] = [
    { label: 'Date', value: formatDate(q.docDate) },
    { label: 'Valid Until', value: `${formatDate(validTill)} (${q.validityDays} days)` },
  ];
  if (q.placeOfSupply) meta.push({ label: 'Place of Supply', value: stateLabel(q.placeOfSupply) });
  meta.push({ label: 'Tax Type', value: q.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST' });

  const doc: DocumentData = {
    docLabel: 'QUOTATION',
    company: {
      name: lh?.name ?? 'M.S. ENTERPRISES',
      factory: lh?.factory ?? '',
      office: lh?.office ?? '',
      gstin: lh?.gstin ?? '',
      bank: lh?.bank ?? { name: '', acNo: '', ifsc: '' },
    },
    buyer: {
      name: cust?.name ?? '—',
      addressLines: cust?.address ? [cust.address] : [],
      gstin: cust?.gstin ?? undefined,
      stateLabel: stateLabel(cust?.stateCode) || undefined,
    },
    number: q.number,
    meta,
    columns: q.columnDefs ?? [],
    items: items.map((i) => ({
      description: i.description,
      hsn: i.hsn ?? '',
      qty: Number(i.qty),
      uom: i.uom,
      rate: Number(i.rate),
      amount: Number(i.taxableValue),
      isTooling: i.isToolingCharge,
      groupLabel: i.groupLabel ?? undefined,
      attributes: i.attributes ?? undefined,
    })),
    totals: {
      subtotal: Number(q.subtotal),
      taxLines: buildTaxLines(q.isInterstate, items.map((i) => Number(i.gstRate)), {
        cgst: Number(q.cgst), sgst: Number(q.sgst), igst: Number(q.igst),
      }),
      grand: Number(q.grandTotal),
      words: amountInWords(Number(q.grandTotal)),
    },
    terms: q.terms ? q.terms.split(/\r?\n|\\n/).filter((l) => l.trim()) : (lh?.defaultTerms ?? []),
    notes: q.notes ?? undefined,
  };

  let html = renderDocumentHTML(doc);
  if (req.nextUrl.searchParams.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
