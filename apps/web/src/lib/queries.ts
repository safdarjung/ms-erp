import 'server-only';
import type { SQL } from 'drizzle-orm';
import {
  withTenant, customer, lead, quotation, quotationItem, taxInvoice, taxInvoiceItem, tenant,
  users, role, userRole,
  count, sql, desc, eq, or, ilike, and,
} from '@ms/db';
import { parseLetterhead, type Letterhead } from '@ms/core';
import { requireUser } from './rbac';

const like = (q: string) => `%${q.trim()}%`;

export async function listCustomers(q?: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(customer)
      .where(q?.trim()
        ? or(ilike(customer.name, like(q)), ilike(customer.gstin, like(q)),
            ilike(customer.phone, like(q)), ilike(customer.contactPerson, like(q)))
        : undefined)
      .orderBy(desc(customer.createdAt)),
  );
}

export async function listLeads(q?: string, stage?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) {
    filters.push(or(ilike(lead.customerName, like(q)), ilike(lead.requirement, like(q)), ilike(lead.source, like(q)))!);
  }
  if (stage?.trim()) filters.push(eq(lead.stage, stage));
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(lead)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(lead.createdAt)),
  );
}

export async function customersForSelect() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ id: customer.id, name: customer.name, stateCode: customer.stateCode, gstin: customer.gstin })
      .from(customer).orderBy(customer.name),
  );
}

export async function listInvoices(q?: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, status: taxInvoice.status,
      grandTotal: taxInvoice.grandTotal, isInterstate: taxInvoice.isInterstate, customerName: customer.name,
    }).from(taxInvoice).leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .where(q?.trim() ? or(ilike(taxInvoice.number, like(q)), ilike(customer.name, like(q))) : undefined)
      .orderBy(desc(taxInvoice.createdAt)),
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
    return { invoice, items, customer: cust ?? null, letterhead: parseLetterhead(t?.settings) };
  });
}

export async function getLetterhead(): Promise<Letterhead | null> {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    return parseLetterhead(t?.settings);
  });
}

export async function listQuotations(q?: string, status?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) filters.push(or(ilike(quotation.number, like(q)), ilike(customer.name, like(q)))!);
  if (status?.trim()) filters.push(eq(quotation.status, status));
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: quotation.id, number: quotation.number, docDate: quotation.docDate, status: quotation.status,
      grandTotal: quotation.grandTotal, customerName: customer.name, convertedInvoiceId: quotation.convertedInvoiceId,
    }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(quotation.createdAt)),
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
    return { quotation: q, items, customer: cust ?? null, letterhead: parseLetterhead(t?.settings) };
  });
}

export async function listUsersWithRoles() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const list = await tx.select({
      id: users.id, name: users.name, email: users.email,
      status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
    }).from(users).orderBy(users.createdAt);
    const roles = await tx.select({ userId: userRole.userId, name: role.name })
      .from(userRole).innerJoin(role, eq(userRole.roleId, role.id));
    const byUser = new Map<string, string[]>();
    for (const r of roles) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.name]);
    return list.map((row) => ({ ...row, roles: byUser.get(row.id) ?? [] }));
  });
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

/** Everything the dashboard needs, in one tenant transaction. */
export async function dashboardData() {
  const u = await requireUser();
  const now = new Date();
  // ISO strings, not Date objects — raw sql`` params bypass drizzle's column
  // serialization and the postgres.js driver rejects Dates there.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [customers] = await tx.select({ n: count() }).from(customer);
    const [leadsOpen] = await tx.select({ n: count() }).from(lead)
      .where(sql`${lead.stage} not in ('won','lost')`);
    const [invoices] = await tx.select({
      n: count(), revenue: sql<string>`coalesce(sum(${taxInvoice.grandTotal}), 0)`,
    }).from(taxInvoice);
    const [thisMonth] = await tx.select({ v: sql<string>`coalesce(sum(${taxInvoice.grandTotal}), 0)` })
      .from(taxInvoice).where(sql`${taxInvoice.docDate} >= ${monthStart}`);
    const [lastMonth] = await tx.select({ v: sql<string>`coalesce(sum(${taxInvoice.grandTotal}), 0)` })
      .from(taxInvoice).where(sql`${taxInvoice.docDate} >= ${lastMonthStart} and ${taxInvoice.docDate} < ${monthStart}`);
    const pipeline = await tx.select({
      stage: lead.stage, n: count(), value: sql<string>`coalesce(sum(${lead.valueEstimate}), 0)`,
    }).from(lead).groupBy(lead.stage);
    const [quotesOpen] = await tx.select({ n: count(), value: sql<string>`coalesce(sum(${quotation.grandTotal}), 0)` })
      .from(quotation).where(sql`${quotation.status} in ('draft','sent')`);
    const recentQuotations = await tx.select({
      id: quotation.id, number: quotation.number, docDate: quotation.docDate,
      status: quotation.status, grandTotal: quotation.grandTotal, customerName: customer.name,
    }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id))
      .orderBy(desc(quotation.createdAt)).limit(5);
    const recentInvoices = await tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate,
      status: taxInvoice.status, grandTotal: taxInvoice.grandTotal, customerName: customer.name,
    }).from(taxInvoice).leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .orderBy(desc(taxInvoice.createdAt)).limit(5);

    return {
      customers: Number(customers?.n ?? 0),
      leadsOpen: Number(leadsOpen?.n ?? 0),
      invoices: Number(invoices?.n ?? 0),
      revenue: Number(invoices?.revenue ?? 0),
      invoicedThisMonth: Number(thisMonth?.v ?? 0),
      invoicedLastMonth: Number(lastMonth?.v ?? 0),
      pipeline: pipeline.map((p) => ({ stage: p.stage, n: Number(p.n), value: Number(p.value) })),
      quotesOpen: { n: Number(quotesOpen?.n ?? 0), value: Number(quotesOpen?.value ?? 0) },
      recentQuotations,
      recentInvoices,
    };
  });
}
