import 'server-only';
import type { SQL, Column } from 'drizzle-orm';
import {
  withTenant, customer, lead, leadActivity, quotation, quotationItem, salesOrder, orderItem,
  taxInvoice, taxInvoiceItem, payment, tenant,
  users, role, userRole, inboundMessage, leadChannel,
  count, sql, desc, asc, eq, or, ilike, and,
} from '@ms/db';
import { parseLetterhead, paymentStatus, type Letterhead } from '@ms/core';
import { requireUser } from './rbac';
import { DEFAULT_WHATSAPP_NUMBER, DEFAULT_INTRO, type OutreachSettings } from './outreach';

const like = (q: string) => `%${q.trim()}%`;

// ── Pagination + sorting helpers ────────────────────────────────────────────
// Lists return a page of rows plus the total match count, so the UI can show
// "Showing 1–50 of 214" and Prev/Next without ever loading a whole table.

export const PAGE_SIZE = 50;

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; totalPages: number };

/** Clamp a 1-based page number and derive the SQL limit/offset window. */
function pageWindow(page?: number): { page: number; limit: number; offset: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  return { page: p, limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE };
}

function paged<T>(rows: T[], total: number, page: number): Page<T> {
  return { rows, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/**
 * Resolve a `sort` string ("col:asc" | "col:dir") against a per-entity column
 * WHITELIST — never trust the raw param in the query. Falls back to the default
 * order (usually newest-first) and always appends it as a stable tiebreak.
 */
function orderFor(sort: string | undefined, cols: Record<string, Column>, fallback: SQL[]): SQL[] {
  if (!sort) return fallback;
  const [name, dir] = sort.split(':');
  const col = name ? cols[name] : undefined;
  if (!col) return fallback;
  return [dir === 'asc' ? asc(col) : desc(col), ...fallback];
}

export async function listCustomers(opts: { q?: string; page?: number; sort?: string } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const where = opts.q?.trim()
    ? or(ilike(customer.name, like(opts.q)), ilike(customer.gstin, like(opts.q)),
        ilike(customer.phone, like(opts.q)), ilike(customer.contactPerson, like(opts.q)),
        ilike(customer.email, like(opts.q)), ilike(customer.address, like(opts.q)))
    : undefined;
  const order = orderFor(opts.sort,
    { name: customer.name, credit: customer.creditTermsDays, created: customer.createdAt },
    [desc(customer.createdAt)]);
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select().from(customer).where(where).orderBy(...order).limit(limit).offset(offset),
      tx.select({ n: count() }).from(customer).where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
}

export async function listLeads(opts: { q?: string; stage?: string; page?: number; sort?: string } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const filters: SQL[] = [];
  if (opts.q?.trim()) {
    filters.push(or(
      ilike(lead.customerName, like(opts.q)), ilike(lead.requirement, like(opts.q)), ilike(lead.source, like(opts.q)),
      ilike(lead.phone, like(opts.q)), ilike(lead.contact, like(opts.q)),
    )!);
  }
  if (opts.stage?.trim()) filters.push(eq(lead.stage, opts.stage));
  const where = filters.length ? and(...filters) : undefined;
  const order = orderFor(opts.sort,
    { customer: lead.customerName, value: lead.valueEstimate, stage: lead.stage, created: lead.createdAt },
    [desc(lead.createdAt)]);
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select().from(lead).where(where).orderBy(...order).limit(limit).offset(offset),
      tx.select({ n: count() }).from(lead).where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
}

export async function listInboundMessages(opts: { status?: string; q?: string; page?: number } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const filters: SQL[] = [];
  if (opts.status?.trim()) filters.push(eq(inboundMessage.status, opts.status));
  if (opts.q?.trim()) {
    filters.push(or(
      ilike(inboundMessage.subject, like(opts.q)),
      ilike(inboundMessage.fromEmail, like(opts.q)),
      ilike(inboundMessage.fromName, like(opts.q)),
    )!);
  }
  const where = filters.length ? and(...filters) : undefined;
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select().from(inboundMessage).where(where)
        .orderBy(desc(inboundMessage.receivedAt)).limit(limit).offset(offset),
      tx.select({ n: count() }).from(inboundMessage).where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
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

export async function listInvoices(opts: { q?: string; status?: string; page?: number; sort?: string } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const filters: SQL[] = [];
  if (opts.q?.trim()) filters.push(or(ilike(taxInvoice.number, like(opts.q)), ilike(customer.name, like(opts.q)))!);
  if (opts.status?.trim()) filters.push(eq(taxInvoice.status, opts.status));
  const where = filters.length ? and(...filters) : undefined;
  const order = orderFor(opts.sort,
    { number: taxInvoice.number, date: taxInvoice.docDate, due: taxInvoice.dueDate,
      total: taxInvoice.grandTotal, customer: customer.name },
    [desc(taxInvoice.createdAt)]);
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select({
        id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
        status: taxInvoice.status, grandTotal: taxInvoice.grandTotal, isInterstate: taxInvoice.isInterstate,
        customerName: customer.name,
        received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
      }).from(taxInvoice)
        .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
        .leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
        .where(where)
        .groupBy(taxInvoice.id, customer.name)
        .orderBy(...order).limit(limit).offset(offset),
      tx.select({ n: count() }).from(taxInvoice)
        .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
        .where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
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

export async function listQuotations(opts: { q?: string; status?: string; page?: number; sort?: string } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const filters: SQL[] = [];
  if (opts.q?.trim()) filters.push(or(ilike(quotation.number, like(opts.q)), ilike(customer.name, like(opts.q)))!);
  if (opts.status?.trim()) filters.push(eq(quotation.status, opts.status));
  const where = filters.length ? and(...filters) : undefined;
  const order = orderFor(opts.sort,
    { number: quotation.number, date: quotation.docDate, total: quotation.grandTotal, customer: customer.name },
    [desc(quotation.createdAt)]);
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select({
        id: quotation.id, number: quotation.number, docDate: quotation.docDate, status: quotation.status,
        grandTotal: quotation.grandTotal, customerName: customer.name, convertedInvoiceId: quotation.convertedInvoiceId,
      }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id))
        .where(where).orderBy(...order).limit(limit).offset(offset),
      tx.select({ n: count() }).from(quotation)
        .leftJoin(customer, eq(quotation.customerId, customer.id)).where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
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

export async function listOrders(opts: { q?: string; status?: string; page?: number; sort?: string } = {}) {
  const u = await requireUser();
  const { page, limit, offset } = pageWindow(opts.page);
  const filters: SQL[] = [];
  if (opts.q?.trim()) filters.push(or(ilike(salesOrder.number, like(opts.q)), ilike(customer.name, like(opts.q)), ilike(salesOrder.poRef, like(opts.q)))!);
  if (opts.status?.trim()) filters.push(eq(salesOrder.status, opts.status));
  const where = filters.length ? and(...filters) : undefined;
  const order = orderFor(opts.sort,
    { number: salesOrder.number, date: salesOrder.docDate, delivery: salesOrder.deliveryDate,
      value: salesOrder.totalValue, customer: customer.name },
    [desc(salesOrder.createdAt)]);
  return withTenant(u.tenantId, u.userId, async (tx) => {
    const [rows, [c]] = await Promise.all([
      tx.select({
        id: salesOrder.id, number: salesOrder.number, docDate: salesOrder.docDate, status: salesOrder.status,
        poRef: salesOrder.poRef, orderCategory: salesOrder.orderCategory, materialOwnership: salesOrder.materialOwnership,
        deliveryDate: salesOrder.deliveryDate, totalValue: salesOrder.totalValue,
        convertedInvoiceId: salesOrder.convertedInvoiceId, customerName: customer.name,
      }).from(salesOrder).leftJoin(customer, eq(salesOrder.customerId, customer.id))
        .where(where).orderBy(...order).limit(limit).offset(offset),
      tx.select({ n: count() }).from(salesOrder)
        .leftJoin(customer, eq(salesOrder.customerId, customer.id)).where(where),
    ]);
    return paged(rows, Number(c?.n ?? 0), page);
  });
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

    // Action center: the specific overdue invoices and due follow-ups to act on
    // (with the customer's phone so the dashboard can offer one-tap WhatsApp).
    const overdueRows = await tx.select({
      id: taxInvoice.id, number: taxInvoice.number, dueDate: taxInvoice.dueDate,
      grandTotal: taxInvoice.grandTotal, customerName: customer.name, phone: customer.phone,
      received: sql<string>`coalesce(sum(${payment.amount}), 0)`,
    }).from(taxInvoice)
      .leftJoin(customer, eq(taxInvoice.customerId, customer.id))
      .leftJoin(payment, eq(payment.invoiceId, taxInvoice.id))
      .where(sql`${taxInvoice.status} <> 'cancelled' and ${taxInvoice.dueDate} is not null and ${taxInvoice.dueDate} < now()`)
      .groupBy(taxInvoice.id, customer.name, customer.phone);
    const overdueInvoices = overdueRows
      .map((r) => ({
        id: r.id, number: r.number, dueDate: r.dueDate, customerName: r.customerName, phone: r.phone,
        outstanding: Math.round((Number(r.grandTotal) - Number(r.received)) * 100) / 100,
      }))
      .filter((r) => r.outstanding > 0.5)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 6);

    const followupLeads = await tx.select({
      id: lead.id, customerName: lead.customerName, contact: lead.contact, phone: lead.phone,
      requirement: lead.requirement, nextFollowupAt: lead.nextFollowupAt,
    }).from(lead)
      .where(sql`${lead.nextFollowupAt} is not null and ${lead.nextFollowupAt} <= now() and ${lead.stage} not in ('won','lost')`)
      .orderBy(asc(lead.nextFollowupAt)).limit(6);

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
      overdueInvoices,
      followupLeads,
      recentQuotations,
      recentInvoices,
    };
  });
}
