import type { NextRequest } from 'next/server';
import { getInvoice } from '@/lib/queries';
import { renderDocumentHTML } from '@/pdf/document-template';
import { invoiceDocumentData, withAutoPrint } from '@/pdf/build-document';

// Renders the invoice on the M.S. Enterprises letterhead as a full HTML page.
// ?print=1 auto-opens the browser print dialog (Save as PDF).

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getInvoice(id);
  if (!data?.invoice) return new Response('Invoice not found', { status: 404 });

  let html = renderDocumentHTML(invoiceDocumentData(data));
  if (req.nextUrl.searchParams.get('print') === '1') html = withAutoPrint(html);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
