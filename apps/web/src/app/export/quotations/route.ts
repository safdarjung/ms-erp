import type { NextRequest } from 'next/server';
import { exportQuotationsCsv, csvResponse, guardExport } from '@/lib/export-csv';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await guardExport('quotation.view');
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  return csvResponse(await exportQuotationsCsv(q, status), 'quotations');
}
