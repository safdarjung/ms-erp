import 'server-only';
import { withTenant, customer, taxInvoice, payment, tenant, and, asc, eq, inArray, ne } from '@ms/db';
import { parseLetterhead } from '@ms/core';
import { requireUser, can } from './rbac';
import { defaultStatementPeriod } from './statement-ledger';

// Data loaders for the printable collection documents (statement of account,
// payment receipt). Same shape as queries.ts: requireUser() → withTenant(). Both
// throw FORBIDDEN when the user may not see bills; the print routes turn that
// into a 403. Ledger arithmetic lives in statement-ledger.ts (pure).

const FORBIDDEN = 'FORBIDDEN';

/**
 * Customer + every live (non-cancelled) bill and its payments, plus the
 * statement period — `from`/`to` default to the current financial year to date
 * (IST); an inverted range falls back to the default as well.
 */
export async function getCustomerStatementData(customerId: string, from?: string, to?: string) {
  const u = await requireUser();
  if (!can(u, 'invoice.view')) throw new Error(FORBIDDEN);

  const dflt = defaultStatementPeriod();
  let period = { from: from ?? dflt.from, to: to ?? dflt.to };
  if (period.from > period.to) period = dflt;

  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, customerId)).limit(1);
    if (!c) return null;

    const bills = await tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
      poRef: taxInvoice.poRef, grandTotal: taxInvoice.grandTotal, status: taxInvoice.status,
    }).from(taxInvoice)
      .where(and(eq(taxInvoice.customerId, customerId), ne(taxInvoice.status, 'cancelled')))
      .orderBy(asc(taxInvoice.docDate), asc(taxInvoice.number));

    const payments = bills.length
      ? await tx.select({
          id: payment.id, invoiceId: payment.invoiceId, amount: payment.amount, paidOn: payment.paidOn,
          method: payment.method, reference: payment.reference, createdAt: payment.createdAt,
        }).from(payment)
          .where(inArray(payment.invoiceId, bills.map((b) => b.id)))
          .orderBy(asc(payment.paidOn), asc(payment.createdAt))
      : [];

    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    return { customer: c, bills, payments, letterhead: parseLetterhead(t?.settings), period };
  });
}

/** One payment with its bill, the customer and every payment on that bill (for the running balance). */
export async function getPaymentReceiptData(paymentId: string) {
  const u = await requireUser();
  if (!can(u, 'invoice.view')) throw new Error(FORBIDDEN);

  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [p] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
    if (!p) return null;
    const [inv] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, p.invoiceId)).limit(1);
    if (!inv) return null;
    const [cust] = await tx.select().from(customer).where(eq(customer.id, inv.customerId)).limit(1);
    const payments = await tx.select({
      id: payment.id, amount: payment.amount, paidOn: payment.paidOn, createdAt: payment.createdAt,
    }).from(payment).where(eq(payment.invoiceId, inv.id));
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    return { payment: p, invoice: inv, customer: cust ?? null, payments, letterhead: parseLetterhead(t?.settings) };
  });
}
