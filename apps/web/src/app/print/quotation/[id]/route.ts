import type { NextRequest } from 'next/server';
import { getQuotation } from '@/lib/queries';
import { renderDocumentHTML } from '@/pdf/document-template';
import { quotationDocumentData, withAutoPrint } from '@/pdf/build-document';

// Renders the quotation on the letterhead as a full HTML page.
// ?print=1 auto-opens the browser print dialog (Save as PDF).

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getQuotation(id);
  if (!data?.quotation) return new Response('Quotation not found', { status: 404 });

  let html = renderDocumentHTML(quotationDocumentData(data));
  if (req.nextUrl.searchParams.get('print') === '1') html = withAutoPrint(html);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
