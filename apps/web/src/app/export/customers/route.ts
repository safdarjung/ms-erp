import type { NextRequest } from 'next/server';
import { exportCustomersCsv, csvResponse, guardExport } from '@/lib/export-csv';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await guardExport('customer.view');
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  return csvResponse(await exportCustomersCsv(q), 'customers');
}
