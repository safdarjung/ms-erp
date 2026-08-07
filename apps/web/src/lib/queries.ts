import 'server-only';
import type { SQL } from 'drizzle-orm';
import {
  withTenant, customer, lead, leadActivity, quotation, quotationItem, salesOrder, orderItem,
  taxInvoice, taxInvoiceItem, payment, tenant,
  users, role, userRole,
  count, sql, desc, eq, or, ilike, and,
} from '@ms/db';
import { parseLetterhead, paymentStatus, type Letterhead } from '@ms/core';
import { requireUser } from './rbac';

const like = (q: string) => `%${q.trim()}%`;

export async function listCustomers(q?: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(customer)
      .where(q?.trim()
        ? or(ilike(customer.name, like(q)), ilike(customer.gstin, like(q)),
            ilike(customer.phone, like(q)), ilike(customer.contactPerson, like(q)),
            ilike(customer.email, like(q)), ilike(customer.address, like(q)))
        : undefined)
      .orderBy(desc(customer.createdAt)),
  );
}

export async function listLeads(q?: string, stage?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) {
    filters.push(or(
      ilike(lead.customerName, like(q)), ilike(lead.requirement, like(q)), ilike(lead.source, like(q)),
      ilike(lead.phone, like(q)), ilike(lead.contact, like(q)),
    )!);
  }
  if (stage?.trim()) filters.push(eq(lead.stage, stage));
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(lead)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(lead.createdAt)),
  );
}

export async function getLead(id: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
    if (!l) return null;
    const activities = await tx.select({
      id: leadActivity.id, type: leadActivity.type, notes: leadActivity.notes,
      at: leadActivity.at, byName: users.name,
    }).from(leadActivity).leftJoin(users, eq(leadActivity.byUserId, users.id))
      .where(eq(leadActivity.leadId, id)).orderBy(desc(leadActivity.at));
    const [owner] = l.ownerUserId
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, l.ownerUserId)).limit(1)
      : [undefined];
    return { lead: l, activities, ownerName: owner?.name ?? null };
  });
}

export async function usersForSelect() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ id: users.id, name: users.name }).from(users)
      .where(eq(users.status, 'active')).orderBy(users.name),
  );
}

export async function getCustomer(id: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, id)).limit(1);
    if (!c) return null;
    const quotes = await tx.select({
      id: quotation.id, number: quotation.number, docDate: quotation.docDate, status: quotation.status,
      grandTotal: quotation.grandTotal, convertedInvoiceId: quotation.convertedInvoiceId, convertedOrderId: quotation.convertedOrderId,
    }).from(quotation).where(eq(quotation.customerId, id)).orderBy(desc(quotation.createdAt)).limit(50);
    const orders = await tx.select({
      id: salesOrder.id, number: salesOrder.number, docDate: salesOrder.docDate, status: salesOrder.status,
      totalValue: salesOrder.totalValue, convertedInvoiceId: salesOrder.convertedInvoiceId,
    }).from(salesOrder).where(eq(salesOrder.customerId, id)).orderBy(desc(salesOrder.createdAt)).limit(50);
    const invoices = await tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
      status: taxInvoice.status, grandTotal: taxInvoice.grandTotal, isInterstate: taxInvoice.isInterstate,
      received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
    }).from(taxInvoice).leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
      .where(eq(taxInvoice.customerId, id)).groupBy(taxInvoice.id).orderBy(desc(taxInvoice.createdAt)).limit(100);
    return { customer: c, quotes, orders, invoices };
  });
}

export async function customersForSelect() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ id: customer.id, name: customer.name, stateCode: customer.stateCode, gstin: customer.gstin })
      .from(customer).orderBy(customer.name),
  );
}

export async function listInvoices(q?: string, status?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) filters.push(or(ilike(taxInvoice.number, like(q)), ilike(customer.name, like(q)))!);
  if (status?.trim()) filters.push(eq(taxInvoice.status, status));
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
      status: taxInvoice.status, grandTotal: taxInvoice.grandTotal, isInterstate: taxInvoice.isInterstate,
      customerName: customer.name,
      received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
    }).from(taxInvoice)
      .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
      .where(filters.length ? and(...filters) : undefined)
      .groupBy(taxInvoice.id, customer.name)
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
    const payments = await tx.select().from(payment).where(eq(payment.invoiceId, id)).orderBy(desc(payment.paidOn));
    const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
    const received = payments.reduce((s, p) => s + Number(p.amount), 0);
    return { invoice, items, customer: cust ?? null, payments, received, letterhead: parseLetterhead(t?.settings) };
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

export async function listOrders(q?: string, status?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (q?.trim()) filters.push(or(ilike(salesOrder.number, like(q)), ilike(customer.name, like(q)), ilike(salesOrder.poRef, like(q)))!);
  if (status?.trim()) filters.push(eq(salesOrder.status, status));
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({
      id: salesOrder.id, number: salesOrder.number, docDate: salesOrder.docDate, status: salesOrder.status,
      poRef: salesOrder.poRef, orderCategory: salesOrder.orderCategory, materialOwnership: salesOrder.materialOwnership,
      deliveryDate: salesOrder.deliveryDate, totalValue: salesOrder.totalValue,
      convertedInvoiceId: salesOrder.convertedInvoiceId, customerName: customer.name,
    }).from(salesOrder).leftJoin(customer, eq(salesOrder.customerId, customer.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(salesOrder.createdAt)),
  );
}

export async function getOrder(id: string) {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [order] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id)).limit(1);
    if (!order) return null;
    const items = await tx.select().from(orderItem).where(eq(orderItem.orderId, id)).orderBy(orderItem.seq);
    const [cust] = await tx.select().from(customer).where(eq(customer.id, order.customerId)).limit(1);
    return { order, items, customer: cust ?? null };
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
    const [ordersOpen] = await tx.select({ n: count(), value: sql<string>`coalesce(sum(${salesOrder.totalValue}), 0)` })
      .from(salesOrder).where(sql`${salesOrder.status} in ('open','in_progress')`);
    const [followups] = await tx.select({ n: count() }).from(lead)
      .where(sql`${lead.nextFollowupAt} is not null and ${lead.nextFollowupAt} <= now() and ${lead.stage} not in ('won','lost')`);
    const arRows = await tx.select({
      grandTotal: taxInvoice.grandTotal, dueDate: taxInvoice.dueDate, status: taxInvoice.status,
      received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
    }).from(taxInvoice).leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
      .where(sql`${taxInvoice.status} <> 'cancelled'`).groupBy(taxInvoice.id);
    let receivables = 0, overdue = 0;
    for (const r of arRows) {
      const ps = paymentStatus({ status: r.status, grandTotal: Number(r.grandTotal), received: Number(r.received), dueDate: r.dueDate });
      receivables += ps.outstanding;
      if (ps.state === 'overdue') overdue += ps.outstanding;
    }
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
      ordersOpen: { n: Number(ordersOpen?.n ?? 0), value: Number(ordersOpen?.value ?? 0) },
      followupsDue: Number(followups?.n ?? 0),
      receivables,
      overdue,
      recentQuotations,
      recentInvoices,
    };
  });
}
