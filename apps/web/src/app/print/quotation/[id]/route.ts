import type { NextRequest } from 'next/server';
import { getQuotation } from '@/lib/queries';
import { renderInvoiceHTML, type InvoiceData } from '@/pdf/invoice-template';
import { formatDate } from '@/lib/format';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getQuotation(id);
  if (!data?.quotation) return new Response('Quotation not found', { status: 404 });

  const { quotation: q, items, customer: cust, letterhead: lh } = data;
  const rates = [...new Set(items.map((i) => Number(i.gstRate)))];
  const one = rates.length === 1 ? rates[0]! : null;
  const taxLines = q.isInterstate
    ? [{ label: `IGST${one !== null ? ` ${one}%` : ''}`, amount: Number(q.igst) }]
    : [
        { label: `CGST${one !== null ? ` ${one / 2}%` : ''}`, amount: Number(q.cgst) },
        { label: `SGST${one !== null ? ` ${one / 2}%` : ''}`, amount: Number(q.sgst) },
      ];

  const docData: InvoiceData = {
    company: {
      name: lh?.name ?? 'M.S. ENTERPRISES', factory: lh?.factory ?? '', office: lh?.office ?? '',
      gstin: lh?.gstin ?? '', bank: lh?.bank ?? { name: '', acNo: '', ifsc: '' },
    },
    buyer: { name: cust?.name ?? '—', addressLines: cust?.address ? [cust.address] : [], gstin: cust?.gstin ?? undefined },
    billNo: q.number,
    date: formatDate(q.docDate),
    docLabel: 'QUOTATION',
    items: items.map((i) => ({ description: i.description, hsn: i.hsn ?? '', qty: Number(i.qty), rate: Number(i.rate) })),
    taxLines,
    terms: q.terms ? q.terms.split('\n').filter((l) => l.trim()) : (lh?.defaultTerms ?? []),
  };

  let html = renderInvoiceHTML(docData);
  if (req.nextUrl.searchParams.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
