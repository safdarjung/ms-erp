import type { NextRequest } from 'next/server';
import { exportGstSummaryCsv, csvResponse, guardExport } from '@/lib/export-csv';

export const dynamic = 'force-dynamic';

// GST tax breakup is invoice-derived — gate on the same permission as invoices.
export async function GET(_req: NextRequest): Promise<Response> {
  const denied = await guardExport('invoice.view');
  if (denied) return denied;
  return csvResponse(await exportGstSummaryCsv(), 'gst-summary');
}
