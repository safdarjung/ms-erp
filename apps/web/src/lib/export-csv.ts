import 'server-only';
import type { SQL } from 'drizzle-orm';
import {
  withTenant, customer, taxInvoice, quotation, payment,
  and, or, eq, ilike, desc, sql,
} from '@ms/db';
import { stateLabel, financialYear, type Permission } from '@ms/core';
import { requireUser, requirePermission } from './rbac';
import { formatDate } from './format';

// CSV export: tenant-scoped, self-contained queries (no coupling to lib/queries.ts)
// plus a hardened toCsv() builder. Money columns arrive as numeric strings from
// the driver; dates are rendered the same way the UI shows them (DD.MM.YYYY).

const BOM = '﻿';
const like = (q: string) => `%${q.trim()}%`;
const money = (v: string | number | null | undefined): string => Number(v ?? 0).toFixed(2);

/** Neutralise a single field: CSV-injection guard, quote/escape as needed. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Prevent CSV/formula injection: a field opening with = + - @ (or tab/CR) can be
  // interpreted as a formula by Excel/Sheets — prefix with an apostrophe to defuse.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Quote when the field contains a comma, quote or newline; escape " → "".
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV string: BOM (Excel UTF-8) + CRLF rows. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(','));
  return BOM + lines.join('\r\n');
}

/** Wrap a CSV string in a downloadable text/csv Response with a dated filename. */
export function csvResponse(csv: string, baseName: string): Response {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, no external libs
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${baseName}-${date}.csv"`,
    },
  });
}

/** Enforce a permission; return a 403 Response if forbidden, else null. */
export async function guardExport(permission: Permission): Promise<Response | null> {
  try {
    await requirePermission(permission);
    return null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('FORBIDDEN')) {
      return new Response('Forbidden', { status: 403 });
    }
    throw err; // login redirects (NEXT_REDIRECT) and anything else propagate
  }
}

export async function exportCustomersCsv(q?: string): Promise<string> {
  const u = await requireUser();
  const rows = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(customer)
      .where(q?.trim()
        ? or(ilike(customer.name, like(q)), ilike(customer.gstin, like(q)),
            ilike(customer.phone, like(q)), ilike(customer.contactPerson, like(q)),
            ilike(customer.email, like(q)), ilike(customer.address, like(q)))
        : undefined)
      .orderBy(desc(customer.createdAt)),
  );
  const headers = [
    'Name', 'Code', 'GSTIN', 'Reg Type', 'State', 'Contact Person', 'Phone',
    'Email', 'Address', 'Credit Terms (Days)', 'Credit Limit', 'Status', 'Created',
  ];
  const body = rows.map((c) => [
    c.name, c.code, c.gstin, c.regType, stateLabel(c.stateCode), c.contactPerson,
    c.phone, c.email, c.address, c.creditTermsDays,
    c.creditLimit == null ? '' : money(c.creditLimit), c.status, formatDate(c.createdAt),
  ]);
  return toCsv(headers, body);
}

export async function exportInvoicesCsv(q?: string, status?: string): Promise<string> {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) filters.push(or(ilike(taxInvoice.number, like(q)), ilike(customer.name, like(q)))!);
  if (status?.trim()) filters.push(eq(taxInvoice.status, status));
  const rows = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
      status: taxInvoice.status, isInterstate: taxInvoice.isInterstate,
      subtotal: taxInvoice.subtotal, cgst: taxInvoice.cgst, sgst: taxInvoice.sgst,
      igst: taxInvoice.igst, roundOff: taxInvoice.roundOff, grandTotal: taxInvoice.grandTotal,
      customerName: customer.name,
      received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
    }).from(taxInvoice)
      .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
      .where(filters.length ? and(...filters) : undefined)
      .groupBy(taxInvoice.id, customer.name)
      .orderBy(desc(taxInvoice.createdAt)),
  );
  const headers = [
    'Number', 'Date', 'Due Date', 'Customer', 'Status', 'Tax Type', 'Subtotal',
    'CGST', 'SGST', 'IGST', 'Round Off', 'Grand Total', 'Received', 'Outstanding',
  ];
  const body = rows.map((r) => {
    const outstanding = Number(r.grandTotal) - Number(r.received);
    return [
      r.number, formatDate(r.docDate), formatDate(r.dueDate), r.customerName ?? '', r.status,
      r.isInterstate ? 'IGST' : 'CGST+SGST',
      money(r.subtotal), money(r.cgst), money(r.sgst), money(r.igst), money(r.roundOff),
      money(r.grandTotal), money(r.received), money(outstanding),
    ];
  });
  return toCsv(headers, body);
}

export async function exportQuotationsCsv(q?: string, status?: string): Promise<string> {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) filters.push(or(ilike(quotation.number, like(q)), ilike(customer.name, like(q)))!);
  if (status?.trim()) filters.push(eq(quotation.status, status));
  const rows = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      number: quotation.number, docDate: quotation.docDate, status: quotation.status,
      isInterstate: quotation.isInterstate, validityDays: quotation.validityDays,
      subtotal: quotation.subtotal, cgst: quotation.cgst, sgst: quotation.sgst,
      igst: quotation.igst, grandTotal: quotation.grandTotal, customerName: customer.name,
      convertedInvoiceId: quotation.convertedInvoiceId,
    }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(quotation.createdAt)),
  );
  const headers = [
    'Number', 'Date', 'Customer', 'Status', 'Tax Type', 'Validity (Days)',
    'Subtotal', 'CGST', 'SGST', 'IGST', 'Grand Total', 'Converted to Invoice',
  ];
  const body = rows.map((r) => [
    r.number, formatDate(r.docDate), r.customerName ?? '', r.status,
    r.isInterstate ? 'IGST' : 'CGST+SGST', r.validityDays,
    money(r.subtotal), money(r.cgst), money(r.sgst), money(r.igst), money(r.grandTotal),
    r.convertedInvoiceId ? 'Yes' : 'No',
  ]);
  return toCsv(headers, body);
}

/** Per-invoice tax breakup for the current financial year (FY starts 1 April). */
export async function exportGstSummaryCsv(): Promise<string> {
  const u = await requireUser();
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, 3, 1).toISOString();
  const rows = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      number: taxInvoice.number, docDate: taxInvoice.docDate,
      subtotal: taxInvoice.subtotal, cgst: taxInvoice.cgst, sgst: taxInvoice.sgst,
      igst: taxInvoice.igst, grandTotal: taxInvoice.grandTotal, customerName: customer.name,
    }).from(taxInvoice).leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .where(and(sql`${taxInvoice.status} <> 'cancelled'`, sql`${taxInvoice.docDate} >= ${fyStart}`))
      .orderBy(taxInvoice.docDate),
  );
  const headers = ['Number', 'Date', 'Customer', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Grand Total'];
  const body: (string | number | null | undefined)[][] = rows.map((r) => [
    r.number, formatDate(r.docDate), r.customerName ?? '',
    money(r.subtotal), money(r.cgst), money(r.sgst), money(r.igst), money(r.grandTotal),
  ]);
  // Trailing totals row — what the accountant needs for the GST return at a glance.
  const total = (key: 'subtotal' | 'cgst' | 'sgst' | 'igst' | 'grandTotal') =>
    rows.reduce((acc, r) => acc + Number(r[key]), 0);
  body.push([
    'TOTAL', `FY ${financialYear(now)}`, '',
    money(total('subtotal')), money(total('cgst')), money(total('sgst')),
    money(total('igst')), money(total('grandTotal')),
  ]);
  return toCsv(headers, body);
}
