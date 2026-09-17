import type { NextRequest } from 'next/server';
import { amountInWords, stateLabel, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@ms/core';
import { getCustomerStatementData } from '@/lib/queries-print';
import { agingBuckets, buildLedger, parseIsoDay } from '@/lib/statement-ledger';
import { renderStatementHTML, type StatementData } from '@/pdf/statement-template';
import { formatDate } from '@/lib/format';

// Renders a customer's statement of account (ledger of bills and payments) on
// the letterhead. ?from=YYYY-MM-DD&to=YYYY-MM-DD picks the period (default:
// this financial year to date; invalid values are ignored). ?print=1 auto-opens
// the browser print dialog (Save as PDF).

export async function GET(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const from = parseIsoDay(sp.get('from')) ?? undefined;
  const to = parseIsoDay(sp.get('to')) ?? undefined;

  let data: Awaited<ReturnType<typeof getCustomerStatementData>>;
  try {
    data = await getCustomerStatementData(customerId, from, to);
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') return new Response('Forbidden', { status: 403 });
    throw e;
  }
  if (!data) return new Response('Customer not found', { status: 404 });

  const { customer: cust, bills, payments, letterhead: lh, period } = data;

  const ledger = buildLedger({
    from: period.from,
    to: period.to,
    bills: bills.map((b) => ({
      id: b.id, number: b.number, date: b.docDate.toISOString(), amount: Number(b.grandTotal),
      poRef: b.poRef, status: b.status,
    })),
    payments: payments.map((p) => ({
      id: p.id, billId: p.invoiceId, date: p.paidOn.toISOString(), amount: Number(p.amount),
      methodLabel: PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
      reference: p.reference, createdAt: p.createdAt.toISOString(),
    })),
  });

  const receivedByBill = new Map<string, number>();
  for (const p of payments) receivedByBill.set(p.invoiceId, (receivedByBill.get(p.invoiceId) ?? 0) + Number(p.amount));
  const aging = agingBuckets(bills.map((b) => ({
    amount: Number(b.grandTotal), received: receivedByBill.get(b.id) ?? 0,
    dueDate: b.dueDate?.toISOString() ?? null, status: b.status,
  })));

  const doc: StatementData = {
    company: {
      name: lh?.name ?? 'M.S. ENTERPRISES',
      factory: lh?.factory ?? '',
      office: lh?.office ?? '',
      gstin: lh?.gstin ?? '',
      bank: lh?.bank ?? { name: '', acNo: '', ifsc: '' },
    },
    customer: {
      name: cust.name,
      addressLines: cust.address ? [cust.address] : [],
      gstin: cust.gstin ?? undefined,
      phone: cust.phone ?? undefined,
      stateLabel: stateLabel(cust.stateCode) || undefined,
    },
    period: { from: formatDate(period.from), to: formatDate(period.to) },
    generatedOn: formatDate(new Date()),
    opening: ledger.opening,
    rows: ledger.rows.map((r) => ({
      date: formatDate(r.date), particulars: r.particulars, against: r.against,
      debit: r.debit, credit: r.credit, balance: r.balance,
    })),
    closing: ledger.closing,
    totals: ledger.totals,
    closingWords: amountInWords(Math.abs(ledger.closing)) + (ledger.closing < -0.005 ? ' (advance)' : ''),
    aging,
    billCount: bills.length,
  };

  let html = renderStatementHTML(doc);
  if (sp.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
