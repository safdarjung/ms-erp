import type { NextRequest } from 'next/server';
import { amountInWords, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@ms/core';
import { getPaymentReceiptData } from '@/lib/queries-print';
import { balanceAfterPayment, receiptRef } from '@/lib/statement-ledger';
import { renderReceiptHTML, type ReceiptData } from '@/pdf/receipt-template';
import { formatDate } from '@/lib/format';

// Renders a receipt for one recorded payment on the letterhead.
// ?print=1 auto-opens the browser print dialog (Save as PDF).

export async function GET(req: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params;

  let data: Awaited<ReturnType<typeof getPaymentReceiptData>>;
  try {
    data = await getPaymentReceiptData(paymentId);
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') return new Response('Forbidden', { status: 403 });
    throw e;
  }
  if (!data) return new Response('Payment not found', { status: 404 });

  const { payment: p, invoice: inv, customer: cust, payments, letterhead: lh } = data;

  const billTotal = Number(inv.grandTotal);
  const after = balanceAfterPayment({
    billTotal,
    paymentId: p.id,
    payments: payments.map((x) => ({
      id: x.id, date: x.paidOn.toISOString(), amount: Number(x.amount), createdAt: x.createdAt.toISOString(),
    })),
  }) ?? { receivedUpTo: Number(p.amount), balance: billTotal - Number(p.amount) };

  const amount = Number(p.amount);
  const doc: ReceiptData = {
    company: {
      name: lh?.name ?? 'M.S. ENTERPRISES',
      factory: lh?.factory ?? '',
      office: lh?.office ?? '',
      gstin: lh?.gstin ?? '',
      bank: lh?.bank ?? { name: '', acNo: '', ifsc: '' },
    },
    receiptNo: receiptRef(p.id, p.paidOn.toISOString()),
    date: formatDate(p.paidOn),
    receivedFrom: {
      name: cust?.name ?? '—',
      addressLines: cust?.address ? [cust.address] : [],
      gstin: cust?.gstin ?? undefined,
      phone: cust?.phone ?? undefined,
    },
    amount,
    amountWords: amountInWords(amount),
    methodLabel: PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
    reference: p.reference ?? undefined,
    notes: p.notes ?? undefined,
    subjectToRealisation: p.method === 'cheque',
    bill: {
      number: inv.number,
      date: formatDate(inv.docDate),
      total: billTotal,
      receivedUpTo: after.receivedUpTo,
      balanceAfter: after.balance,
      cancelled: inv.status === 'cancelled',
    },
  };

  let html = renderReceiptHTML(doc);
  if (req.nextUrl.searchParams.get('print') === '1') {
    html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script></body>');
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
