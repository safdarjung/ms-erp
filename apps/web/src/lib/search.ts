import 'server-only';
import {
  withTenant, customer, lead, quotation, salesOrder, taxInvoice, payment,
  sql, desc, eq, ne, or, ilike, and, type Tx,
} from '@ms/db';
import {
  paymentStatus, LEAD_STAGE_LABELS, QUOTATION_STATUS_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATE_LABELS,
  type Permission,
} from '@ms/core';
import { requireUser, can } from './rbac';
import { NAV, type NavKey } from './nav-labels';

// Global search: one box, every record. Each group is a small tenant-scoped
// ILIKE query (a handful of rows) that only runs when the person may view that
// screen. Rows come back already shaped for the UI — title, subtitle, link,
// date, amount, status — so /search never has to know the table layout.

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 80;
export const SEARCH_GROUP_LIMIT = 6;
const ARCHIVED = 'archived';

export type SearchKind = 'customer' | 'lead' | 'quotation' | 'order' | 'invoice';

export type SearchRow = {
  id: string;
  title: string;
  /** Contact / phone / GSTIN for a customer; the customer's name for a document. */
  subtitle: string | null;
  href: string;
  date: Date | null;
  amount: number | null;
  /** Raw status key (drives the StatusPill colour); null when there is nothing to show. */
  status: string | null;
  /** Plain-language label for `status`, from @ms/core. */
  statusLabel: string | null;
};

export type SearchGroup = {
  kind: SearchKind;
  label: string;
  /** The list page for this kind, so "See all" can carry the query across. */
  listHref: string;
  rows: SearchRow[];
  /** True when the group hit its row cap — the list page may hold more. */
  maybeMore: boolean;
};

export type SearchResults = { q: string; groups: SearchGroup[] };

/** Trim and cap the raw query; empty string when there is nothing usable. */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').trim().slice(0, SEARCH_MAX_CHARS).trim();
}

/** Escape LIKE metacharacters so "100%" or "a_b" match literally (Postgres escapes with `\`). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `contains` is the wildcard form; `exact` matches the whole value (still case-insensitive). */
type Pattern = { contains: string; exact: string };

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** Join the non-empty parts with a middle dot; null when nothing is left. */
function joinParts(...parts: (string | null | undefined)[]): string | null {
  const s = parts.map((p) => p?.trim()).filter(Boolean).join(' · ');
  return s || null;
}

function labelFor(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, ' ');
}

async function searchCustomers(tx: Tx, p: Pattern): Promise<SearchRow[]> {
  const matches = or(
    ilike(customer.name, p.contains), ilike(customer.contactPerson, p.contains), ilike(customer.phone, p.contains),
    ilike(customer.email, p.contains), ilike(customer.gstin, p.contains),
  );
  // Hidden (archived) customers only surface on an exact hit, so an old name
  // never crowds out the live ones but can still be found on purpose.
  const exact = or(
    ilike(customer.name, p.exact), ilike(customer.phone, p.exact),
    ilike(customer.email, p.exact), ilike(customer.gstin, p.exact),
  );
  const rows = await tx.select({
    id: customer.id, name: customer.name, contactPerson: customer.contactPerson, phone: customer.phone,
    gstin: customer.gstin, status: customer.status,
  }).from(customer)
    .where(and(matches, or(ne(customer.status, ARCHIVED), exact)))
    .orderBy(customer.name).limit(SEARCH_GROUP_LIMIT);
  return rows.map((c) => {
    const archived = c.status === ARCHIVED;
    return {
      id: c.id, title: c.name, subtitle: joinParts(c.contactPerson, c.phone, c.gstin), href: `/customers/${c.id}`,
      date: null, amount: null,
      status: archived ? ARCHIVED : null, statusLabel: archived ? 'Archived' : null,
    };
  });
}

async function searchLeads(tx: Tx, p: Pattern): Promise<SearchRow[]> {
  const rows = await tx.select({
    id: lead.id, customerName: lead.customerName, contact: lead.contact, phone: lead.phone,
    requirement: lead.requirement, source: lead.source, stage: lead.stage,
    valueEstimate: lead.valueEstimate, createdAt: lead.createdAt,
  }).from(lead)
    .where(or(
      ilike(lead.customerName, p.contains), ilike(lead.contact, p.contains), ilike(lead.phone, p.contains),
      ilike(lead.requirement, p.contains), ilike(lead.source, p.contains),
    ))
    .orderBy(desc(lead.createdAt)).limit(SEARCH_GROUP_LIMIT);
  return rows.map((l) => ({
    id: l.id, title: l.customerName, subtitle: joinParts(l.contact, l.phone, l.requirement), href: `/leads/${l.id}`,
    date: l.createdAt, amount: num(l.valueEstimate),
    status: l.stage, statusLabel: labelFor(LEAD_STAGE_LABELS, l.stage),
  }));
}

async function searchQuotations(tx: Tx, p: Pattern): Promise<SearchRow[]> {
  const rows = await tx.select({
    id: quotation.id, number: quotation.number, docDate: quotation.docDate, status: quotation.status,
    grandTotal: quotation.grandTotal, customerName: customer.name,
  }).from(quotation).leftJoin(customer, eq(quotation.customerId, customer.id))
    .where(or(ilike(quotation.number, p.contains), ilike(customer.name, p.contains)))
    .orderBy(desc(quotation.createdAt)).limit(SEARCH_GROUP_LIMIT);
  return rows.map((r) => ({
    id: r.id, title: r.number, subtitle: r.customerName, href: `/quotations/${r.id}`,
    date: r.docDate, amount: num(r.grandTotal),
    status: r.status, statusLabel: labelFor(QUOTATION_STATUS_LABELS, r.status),
  }));
}

async function searchOrders(tx: Tx, p: Pattern): Promise<SearchRow[]> {
  const rows = await tx.select({
    id: salesOrder.id, number: salesOrder.number, docDate: salesOrder.docDate, status: salesOrder.status,
    poRef: salesOrder.poRef, totalValue: salesOrder.totalValue, customerName: customer.name,
  }).from(salesOrder).leftJoin(customer, eq(salesOrder.customerId, customer.id))
    .where(or(ilike(salesOrder.number, p.contains), ilike(salesOrder.poRef, p.contains), ilike(customer.name, p.contains)))
    .orderBy(desc(salesOrder.createdAt)).limit(SEARCH_GROUP_LIMIT);
  return rows.map((r) => ({
    id: r.id, title: r.number, subtitle: joinParts(r.customerName, r.poRef ? `PO ${r.poRef}` : null), href: `/orders/${r.id}`,
    date: r.docDate, amount: num(r.totalValue),
    status: r.status, statusLabel: labelFor(ORDER_STATUS_LABELS, r.status),
  }));
}

// Money received against a bill, as a scalar subquery — payment state is
// derived, never stored (same rule as listInvoices in queries.ts).
const RECEIVED = sql<string>`coalesce((select sum(${payment.amount}) from ${payment} where ${payment.invoiceId} = ${taxInvoice.id}), 0)`;

async function searchInvoices(tx: Tx, p: Pattern): Promise<SearchRow[]> {
  const rows = await tx.select({
    id: taxInvoice.id, number: taxInvoice.number, docDate: taxInvoice.docDate, dueDate: taxInvoice.dueDate,
    status: taxInvoice.status, grandTotal: taxInvoice.grandTotal, customerName: customer.name, received: RECEIVED,
  }).from(taxInvoice).leftJoin(customer, eq(taxInvoice.customerId, customer.id))
    .where(or(ilike(taxInvoice.number, p.contains), ilike(taxInvoice.poRef, p.contains), ilike(customer.name, p.contains)))
    .orderBy(desc(taxInvoice.createdAt)).limit(SEARCH_GROUP_LIMIT);
  return rows.map((r) => {
    const ps = paymentStatus({ status: r.status, grandTotal: Number(r.grandTotal), received: Number(r.received), dueDate: r.dueDate });
    return {
      id: r.id, title: r.number, subtitle: r.customerName, href: `/invoices/${r.id}`,
      date: r.docDate, amount: num(r.grandTotal),
      status: ps.state, statusLabel: PAYMENT_STATE_LABELS[ps.state],
    };
  });
}

type GroupDef = {
  kind: SearchKind;
  nav: NavKey;
  permission: Permission;
  run: (tx: Tx, p: Pattern) => Promise<SearchRow[]>;
};

// Display order on the results page. Labels come from NAV so a group is called
// the same thing here as in the sidebar.
const GROUPS: GroupDef[] = [
  { kind: 'customer', nav: 'customers', permission: 'customer.view', run: searchCustomers },
  { kind: 'lead', nav: 'leads', permission: 'lead.view', run: searchLeads },
  { kind: 'quotation', nav: 'quotations', permission: 'quotation.view', run: searchQuotations },
  { kind: 'order', nav: 'orders', permission: 'order.view', run: searchOrders },
  { kind: 'invoice', nav: 'invoices', permission: 'invoice.view', run: searchInvoices },
];

function toGroup(def: GroupDef, rows: SearchRow[]): SearchGroup {
  const { label, href } = NAV[def.nav];
  return { kind: def.kind, label, listHref: href, rows, maybeMore: rows.length >= SEARCH_GROUP_LIMIT };
}

/**
 * Search every kind of record the current user may view. Queries shorter than
 * SEARCH_MIN_CHARS return the permitted groups with no rows (so the UI can
 * still list what is searchable). All group queries share one tenant transaction.
 */
export async function globalSearch(raw: string): Promise<SearchResults> {
  const u = await requireUser();
  const q = normalizeQuery(raw);
  const allowed = GROUPS.filter((g) => can(u, g.permission));
  if (q.length < SEARCH_MIN_CHARS || allowed.length === 0) {
    return { q, groups: allowed.map((g) => toGroup(g, [])) };
  }
  const p: Pattern = { contains: `%${escapeLike(q)}%`, exact: escapeLike(q) };
  const groups = await withTenant(u.tenantId, u.userId, (tx) =>
    Promise.all(allowed.map(async (g) => toGroup(g, await g.run(tx, p)))),
  );
  return { q, groups };
}

/** Rows across every group. */
export function totalHits(results: SearchResults): number {
  return results.groups.reduce((n, g) => n + g.rows.length, 0);
}
