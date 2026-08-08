import 'server-only';
import type { SQL } from 'drizzle-orm';
import {
  withTenant, customer, lead, leadActivity, quotation, quotationItem, salesOrder, orderItem,
  taxInvoice, taxInvoiceItem, payment, tenant,
  users, role, userRole, inboundMessage, leadChannel,
  count, sql, desc, eq, or, ilike, and,
} from '@ms/db';
import { parseLetterhead, paymentStatus, type Letterhead } from '@ms/core';
import { requireUser } from './rbac';
import { DEFAULT_WHATSAPP_NUMBER, DEFAULT_INTRO, type OutreachSettings } from './outreach';

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

export async function listInboundMessages(status?: string, q?: string) {
  const u = await requireUser();
  const filters: SQL[] = [];
  if (status?.trim()) filters.push(eq(inboundMessage.status, status));
  if (q?.trim()) {
    filters.push(or(
      ilike(inboundMessage.subject, like(q)),
      ilike(inboundMessage.fromEmail, like(q)),
      ilike(inboundMessage.fromName, like(q)),
    )!);
  }
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(inboundMessage)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(inboundMessage.receivedAt))
      .limit(200),
  );
}

export async function getInboundMessage(id: string) {
  const u = await requireUser();
  const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(inboundMessage).where(eq(inboundMessage.id, id)).limit(1),
  );
  return row ?? null;
}

export async function inboxPendingCount(): Promise<number> {
  const u = await requireUser();
  const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ n: count() }).from(inboundMessage).where(eq(inboundMessage.status, 'pending')),
  );
  return Number(row?.n ?? 0);
}

export async function listLeadChannels() {
  const u = await requireUser();
  return withTenant(u.tenantId, u.userId, (tx) =>
    tx.select().from(leadChannel).orderBy(desc(leadChannel.createdAt)),
  );
}

export async function getOutreachSettings(): Promise<OutreachSettings> {
  const u = await requireUser();
  const [t] = await withTenant(u.tenantId, u.userId, (tx) =>
    tx.select({ settings: tenant.settings }).from(tenant).limit(1),
  );
  const s = (t?.settings ?? {}) as { outreach?: Partial<OutreachSettings> };
  return {
    whatsappNumber: s.outreach?.whatsappNumber || DEFAULT_WHATSAPP_NUMBER,
    template: s.outreach?.template || DEFAULT_INTRO,
  };
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

export type AnalyticsData = Awaited<ReturnType<typeof analyticsData>>;

/** Owner analytics: sales trends, receivables aging, growth, order book, GST. */
export async function analyticsData() {
  const u = await requireUser();
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, 3, 1);
  const lastFyStart = new Date(fyStartYear - 1, 3, 1);
  const twelveMoAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const months: { m: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ m: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-IN', { month: 'short' }) });
  }
  const fillMonthly = (rows: { m: string; v: unknown }[]) => {
    const map = new Map(rows.map((r) => [r.m, Number(r.v)]));
    return months.map((k) => ({ ...k, value: map.get(k.m) ?? 0 }));
  };

  return withTenant(u.tenantId, u.userId, async (tx) => {
    const notCancelled = sql`${taxInvoice.status} <> 'cancelled'`;
    const invSum = async (from: Date, to?: Date) => {
      const [r] = await tx.select({ v: sql<string>`coalesce(sum(${taxInvoice.grandTotal}),0)`, n: count() })
        .from(taxInvoice)
        .where(to
          ? and(notCancelled, sql`${taxInvoice.docDate} >= ${iso(from)} and ${taxInvoice.docDate} < ${iso(to)}`)
          : and(notCancelled, sql`${taxInvoice.docDate} >= ${iso(from)}`));
      return { v: Number(r?.v ?? 0), n: Number(r?.n ?? 0) };
    };

    const [week, lastWeek, month, lastMonth, fy, lastFy, allTime] = await Promise.all([
      invSum(weekStart), invSum(lastWeekStart, weekStart),
      invSum(monthStart), invSum(lastMonthStart, monthStart),
      invSum(fyStart), invSum(lastFyStart, fyStart),
      invSum(new Date(0)),
    ]);

    const monthExpr = (col: typeof taxInvoice.docDate) => sql<string>`to_char(date_trunc('month', ${col}),'YYYY-MM')`;
    const revByMonth = fillMonthly(await tx.select({ m: monthExpr(taxInvoice.docDate), v: sql<string>`coalesce(sum(${taxInvoice.grandTotal}),0)` })
      .from(taxInvoice).where(and(notCancelled, sql`${taxInvoice.docDate} >= ${iso(twelveMoAgo)}`)).groupBy(sql`1`));
    const collectionsByMonth = fillMonthly(await tx.select({ m: sql<string>`to_char(date_trunc('month', ${payment.paidOn}),'YYYY-MM')`, v: sql<string>`coalesce(sum(${payment.amount}),0)` })
      .from(payment).where(sql`${payment.paidOn} >= ${iso(twelveMoAgo)}`).groupBy(sql`1`));
    const newCustomersByMonth = fillMonthly(await tx.select({ m: sql<string>`to_char(date_trunc('month', ${customer.createdAt}),'YYYY-MM')`, v: sql<string>`count(*)` })
      .from(customer).where(sql`${customer.createdAt} >= ${iso(twelveMoAgo)}`).groupBy(sql`1`));

    const [customers] = await tx.select({ n: count() }).from(customer);
    const topCustomers = await tx.select({ name: customer.name, v: sql<string>`coalesce(sum(${taxInvoice.grandTotal}),0)` })
      .from(taxInvoice).innerJoin(customer, eq(customer.id, taxInvoice.customerId))
      .where(notCancelled).groupBy(customer.id, customer.name)
      .orderBy(desc(sql`coalesce(sum(${taxInvoice.grandTotal}),0)`)).limit(8);

    // Receivables aging (JS bucketing from per-invoice outstanding).
    const arRows = await tx.select({ grand: taxInvoice.grandTotal, due: taxInvoice.dueDate, status: taxInvoice.status, received: sql<string>`coalesce(sum(${payment.amount}),0)` })
      .from(taxInvoice).leftJoin(payment, eq(payment.invoiceId, taxInvoice.id)).where(notCancelled).groupBy(taxInvoice.id);
    const aging = { current: 0, d30: 0, d60: 0, d60plus: 0, total: 0 };
    for (const r of arRows) {
      const outstanding = Math.round((Number(r.grand) - Number(r.received)) * 100) / 100;
      if (outstanding <= 0.5) continue;
      aging.total += outstanding;
      const due = r.due ? new Date(r.due) : null;
      const overdueDays = due ? Math.floor((now.getTime() - due.getTime()) / 86_400_000) : -1;
      if (overdueDays <= 0) aging.current += outstanding;
      else if (overdueDays <= 30) aging.d30 += outstanding;
      else if (overdueDays <= 60) aging.d60 += outstanding;
      else aging.d60plus += outstanding;
    }

    const ordersByStatus = await tx.select({ status: salesOrder.status, n: count(), v: sql<string>`coalesce(sum(${salesOrder.totalValue}),0)` }).from(salesOrder).groupBy(salesOrder.status);
    const ordersByCategory = await tx.select({ category: salesOrder.orderCategory, n: count(), v: sql<string>`coalesce(sum(${salesOrder.totalValue}),0)` }).from(salesOrder).groupBy(salesOrder.orderCategory);

    const quotesByStatus = await tx.select({ status: quotation.status, n: count(), v: sql<string>`coalesce(sum(${quotation.grandTotal}),0)` }).from(quotation).groupBy(quotation.status);
    const [orderedQuotes] = await tx.select({ n: count() }).from(quotation).where(sql`${quotation.convertedOrderId} is not null`);

    const leadsByStage = await tx.select({ stage: lead.stage, n: count(), v: sql<string>`coalesce(sum(${lead.valueEstimate}),0)` }).from(lead).groupBy(lead.stage);
    const leadsBySource = await tx.select({ source: lead.source, n: count() }).from(lead).where(sql`${lead.source} is not null and ${lead.source} <> ''`).groupBy(lead.source).orderBy(desc(count())).limit(6);

    const [gst] = await tx.select({
      taxable: sql<string>`coalesce(sum(${taxInvoice.subtotal}),0)`,
      cgst: sql<string>`coalesce(sum(${taxInvoice.cgst}),0)`,
      sgst: sql<string>`coalesce(sum(${taxInvoice.sgst}),0)`,
      igst: sql<string>`coalesce(sum(${taxInvoice.igst}),0)`,
      grand: sql<string>`coalesce(sum(${taxInvoice.grandTotal}),0)`,
    }).from(taxInvoice).where(and(notCancelled, sql`${taxInvoice.docDate} >= ${iso(fyStart)}`));

    const num = (v: unknown) => Number(v ?? 0);
    const fyLabel = `${String(fyStartYear % 100).padStart(2, '0')}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;

    return {
      fyLabel,
      sales: {
        week: week.v, lastWeek: lastWeek.v, month: month.v, lastMonth: lastMonth.v,
        fy: fy.v, lastFy: lastFy.v, allTime: allTime.v,
        invoiceCount: allTime.n, avgInvoice: allTime.n ? allTime.v / allTime.n : 0,
      },
      revByMonth, collectionsByMonth, newCustomersByMonth,
      customers: num(customers?.n),
      topCustomers: topCustomers.map((c) => ({ name: c.name, value: num(c.v) })),
      aging,
      ordersByStatus: ordersByStatus.map((o) => ({ status: o.status, n: num(o.n), value: num(o.v) })),
      ordersByCategory: ordersByCategory.map((o) => ({ category: o.category, n: num(o.n), value: num(o.v) })),
      quotesByStatus: quotesByStatus.map((o) => ({ status: o.status, n: num(o.n), value: num(o.v) })),
      orderedQuotes: num(orderedQuotes?.n),
      leadsByStage: leadsByStage.map((l) => ({ stage: l.stage, n: num(l.n), value: num(l.v) })),
      leadsBySource: leadsBySource.map((l) => ({ source: l.source ?? '—', n: num(l.n) })),
      gst: { taxable: num(gst?.taxable), cgst: num(gst?.cgst), sgst: num(gst?.sgst), igst: num(gst?.igst), grand: num(gst?.grand) },
    };
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
