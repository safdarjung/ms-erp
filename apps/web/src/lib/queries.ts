import 'server-only';
import { withTenant, customer, lead, quotation, quotationItem, taxInvoice, taxInvoiceItem, tenant, count, sql, desc, eq } from '@ms/db';
import { requireUser } from './rbac';

export async function listCustomers() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) => tx.select().from(customer).orderBy(desc(customer.createdAt)));
}

export async function listLeads() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) => tx.select().from(lead).orderBy(desc(lead.createdAt)));
}

export async function customersForSelect() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ id: customer.id, name: customer.name, stateCode: customer.stateCode, gstin: customer.gstin })
      .from(customer).orderBy(customer.name),
  );
}

export async function listInvoices() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, status: taxInvoice.status,
      grandTotal: taxInvoice.grandTotal, isInterstate: taxInvoice.isInterstate, customerName: customer.name,
    }).from(taxInvoice).leftJoin(customer, eq(taxInvoice.customerId, customer.id)).orderBy(desc(taxInvoice.createdAt)),
  );
}

export async function getInvoice(id: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [invoice] = await tx.select().from(taxInvoice).where(eq(taxInvoice.id, id)).limit(1);
    if (!invoice) return null;
    const items = await tx.select().from(taxInvoiceItem).where(eq(taxInvoiceItem.invoiceId, id)).orderBy(taxInvoiceItem.seq);
    const [cust] = await tx.select().from(customer).where(eq(customer.id, invoice.customerId)).limit(1);
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const letterhead = (t?.settings as any)?.letterhead ?? null;
    return { invoice, items, customer: cust ?? null, letterhead };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLetterhead(): Promise<any> {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (t?.settings as any)?.letterhead ?? null;
  });
}

export async function listQuotations() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: quotation.id, number: quotation.number, docDate: quotation.docDate, status: quotation.status,
      grandTotal: quotation.grandTotal, customerName: customer.name, convertedInvoiceId: quotation.convertedInvoiceId,
    }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id)).orderBy(desc(quotation.createdAt)),
  );
}

export async function getQuotation(id: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [q] = await tx.select().from(quotation).where(eq(quotation.id, id)).limit(1);
    if (!q) return null;
    const items = await tx.select().from(quotationItem).where(eq(quotationItem.quotationId, id)).orderBy(quotationItem.seq);
    const [cust] = await tx.select().from(customer).where(eq(customer.id, q.customerId)).limit(1);
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const letterhead = (t?.settings as any)?.letterhead ?? null;
    return { quotation: q, items, customer: cust ?? null, letterhead };
  });
}

export async function dashboardCounts() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [c] = await tx.select({ n: count() }).from(customer);
    const [l] = await tx.select({ n: count() }).from(lead);
    const [won] = await tx.select({ n: count() }).from(lead).where(eq(lead.stage, 'won'));
    const [neg] = await tx.select({ n: count() }).from(lead).where(eq(lead.stage, 'negotiation'));
    const [inv] = await tx.select({
      n: count(), revenue: sql<string>`coalesce(sum(${taxInvoice.grandTotal}), 0)`,
    }).from(taxInvoice);
    return {
      customers: Number(c?.n ?? 0), leads: Number(l?.n ?? 0), won: Number(won?.n ?? 0),
      negotiation: Number(neg?.n ?? 0), invoices: Number(inv?.n ?? 0), revenue: Number(inv?.revenue ?? 0),
    };
  });
}
