import type { NextRequest } from 'next/server';
import { getInvoice } from '@/lib/queries';
import { renderInvoiceHTML, type InvoiceData } from '@/pdf/invoice-template';
import { formatDate } from '@/lib/format';

// Renders the invoice on the M.S. Enterprises letterhead as a full HTML page.
// ?print=1 auto-opens the browser print dialog (Save as PDF).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getInvoice(id);
  if (!data?.invoice) return new Response('Invoice not found', { status: 404 });

  const { invoice: inv, items, customer: cust, letterhead: lh } = data;

  const rates = [...new Set(items.map((i) => Number(i.gstRate)))];
  const one = rates.length === 1 ? rates[0]! : null;
  const taxLines = inv.isInterstate
    ? [{ label: `IGST${one !== null ? ` ${one}%` : ''}`, amount: Number(inv.igst) }]
    : [
        { label: `CGST${one !== null ? ` ${one / 2}%` : ''}`, amount: Number(inv.cgst) },
        { label: `SGST${one !== null ? ` ${one / 2}%` : ''}`, amount: Number(inv.sgst) },
      ];

  const invoiceData: InvoiceData = {
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
    },
    billNo: inv.number,
    date: formatDate(inv.docDate),
    items: items.map((i) => ({ description: i.description, hsn: i.hsn ?? '', qty: Number(i.qty), rate: Number(i.rate) })),
    taxLines,
    terms: inv.terms ? inv.terms.split('\n').filter((l) => l.trim()) : (lh?.defaultTerms ?? []),
  };

  let html = renderInvoiceHTML(invoiceData);
  if (req.nextUrl.searchParams.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
