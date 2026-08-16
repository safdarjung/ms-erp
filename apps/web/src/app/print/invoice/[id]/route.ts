import type { NextRequest } from 'next/server';
import { amountInWords, stateLabel } from '@ms/core';
import { getInvoice } from '@/lib/queries';
import { buildTaxLines, renderDocumentHTML, type DocumentData } from '@/pdf/document-template';
import { formatDate } from '@/lib/format';

// Renders the invoice on the M.S. Enterprises letterhead as a full HTML page.
// ?print=1 auto-opens the browser print dialog (Save as PDF).

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getInvoice(id);
  if (!data?.invoice) return new Response('Invoice not found', { status: 404 });

  const { invoice: inv, items, customer: cust, letterhead: lh } = data;

  const meta: DocumentData['meta'] = [{ label: 'Date', value: formatDate(inv.docDate) }];
  if (inv.poRef) meta.push({ label: 'PO Ref.', value: inv.poRef });
  if (inv.placeOfSupply) meta.push({ label: 'Place of Supply', value: stateLabel(inv.placeOfSupply) });
  meta.push({ label: 'Tax Type', value: inv.isInterstate ? 'IGST (inter-state)' : 'CGST + SGST' });

  const doc: DocumentData = {
    docLabel: inv.type === 'proforma' ? 'PROFORMA INVOICE' : 'TAX INVOICE',
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
    number: inv.number,
    meta,
    columns: inv.columnDefs ?? [],
    items: items.map((i) => ({
      description: i.description,
      hsn: i.hsn ?? '',
      qty: Number(i.qty),
      uom: i.uom,
      rate: Number(i.rate),
      amount: Number(i.taxableValue),
      groupLabel: i.groupLabel ?? undefined,
      attributes: i.attributes ?? undefined,
    })),
    totals: {
      subtotal: Number(inv.subtotal),
      taxLines: buildTaxLines(inv.isInterstate, items.map((i) => Number(i.gstRate)), {
        cgst: Number(inv.cgst), sgst: Number(inv.sgst), igst: Number(inv.igst),
      }),
      roundOff: Number(inv.roundOff) || undefined,
      grand: Number(inv.grandTotal),
      words: amountInWords(Number(inv.grandTotal)),
    },
    terms: inv.terms ? inv.terms.split(/\r?\n|\\n/).filter((l) => l.trim()) : (lh?.defaultTerms ?? []),
    notes: inv.notes ?? undefined,
  };

  let html = renderDocumentHTML(doc);
  if (req.nextUrl.searchParams.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
