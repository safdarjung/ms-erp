import type { NextRequest } from 'next/server';
import { withTenant } from '@ms/db';
import { verifyShare } from '@/lib/share';
import { loadInvoiceTx, loadQuotationTx } from '@/lib/queries';
import { invoiceDocumentData, quotationDocumentData, withAutoPrint } from '@/pdf/build-document';
import { renderDocumentHTML } from '@/pdf/document-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public share link: /s/q/<quotation id>/<token> · /s/b/<bill id>/<token>.
// No login — the signed, expiring token is the credential. Renders the same
// letterhead PDF page the shop prints, plus a small "Save as PDF" bar for the
// customer. RLS still applies: the tenant comes from the verified token.

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

const GONE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link expired</title>
<style>body{font-family:system-ui,sans-serif;background:#eef1f4;color:#141a21;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.box{background:#fff;border:1px solid #dce3ea;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#55606d;font-size:14px;line-height:1.5}</style></head>
<body><div class="box"><h1>This link has expired</h1><p>Please ask M.S. Enterprises to send the document again.</p></div></body></html>`;

const BAR = `<style>
  .sharebar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 12px;background:#141a21;color:#fff;font:14px system-ui,sans-serif}
  .sharebar button{background:#1c8ea8;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer;min-height:44px}
  .sharebar span{opacity:.8}
  @media print{.sharebar{display:none}}
</style>
<div class="sharebar"><span>Shared by M.S. Enterprises</span><button type="button" onclick="window.print()">Save as PDF / Print</button></div>`;

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string; token: string }> }) {
  const { kind, id, token } = await ctx.params;
  const share = verifyShare(kind, id, token);
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  if (!share) return new Response(GONE, { status: 404, headers });

  const html = await withTenant(share.tenantId, SYSTEM_USER_ID, async (tx) => {
    if (share.kind === 'invoice') {
      const data = await loadInvoiceTx(tx, share.id);
      if (!data || data.invoice.status === 'cancelled') return null;
      return renderDocumentHTML(invoiceDocumentData(data));
    }
    const data = await loadQuotationTx(tx, share.id);
    if (!data) return null;
    return renderDocumentHTML(quotationDocumentData(data));
  });
  if (!html) return new Response(GONE, { status: 404, headers });

  let page = html
    .replace('<meta name="viewport"', '<meta name="robots" content="noindex"><meta name="viewport"')
    .replace('<body>', `<body>${BAR}`);
  if (req.nextUrl.searchParams.get('print') === '1') page = withAutoPrint(page);
  return new Response(page, { headers });
}
