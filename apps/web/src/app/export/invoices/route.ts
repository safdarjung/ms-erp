import type { NextRequest } from 'next/server';
import { exportInvoicesCsv, csvResponse, guardExport } from '@/lib/export-csv';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await guardExport('invoice.view');
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  return csvResponse(await exportInvoicesCsv(q, status), 'invoices');
}
