import { sql } from 'drizzle-orm';
import { financialYear } from '@ms/core';
import { docSequence } from './schema';
import type { Tx } from './client';

const PREFIX: Record<string, string> = {
  quotation: 'QT', order: 'SO', proforma: 'PI', invoice: 'INV', challan: 'DC',
};

/**
 * Issue the next gap-free document number for a (tenant, docType, financial-year),
 * e.g. INV/26-27/0001. Atomic upsert-and-increment; runs inside the tenant tx.
 */
export async function issueDocNumber(
  tx: Tx,
  tenantId: string,
  docType: string,
  when: Date = new Date(),
): Promise<string> {
  const fy = financialYear(when);
  const prefix = PREFIX[docType] ?? 'DOC';
  const rows = await tx
    .insert(docSequence)
    .values({ tenantId, docType, fy, prefix, nextNumber: 1 })
    .onConflictDoUpdate({
      target: [docSequence.tenantId, docSequence.docType, docSequence.fy],
      set: { nextNumber: sql`${docSequence.nextNumber} + 1` },
    })
    .returning({ n: docSequence.nextNumber });
  const n = rows[0]!.n;
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}
