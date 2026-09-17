import 'server-only';
import { aiEnabled, writeBriefing, type BriefingFacts } from '@ms/ai';
import { withTenant, aiBriefing, tenant, and, eq } from '@ms/db';
import type { CurrentUser } from './auth';
import { checkAiRateLimit, recordAiUsage } from './ai';
import { dashboardData, type DashboardData } from './queries';
import { formatDate } from './format';

// The dashboard's AI briefing: facts come from the same deterministic queries
// the dashboard shows; the model only phrases them. Cached once per business
// per day (ai_briefing) so the model runs at most once a day unless the user
// asks for a fresh one. Fails soft — the dashboard never depends on it.

export type BriefingView =
  | { ok: true; text: string; generatedAt: string; cached: boolean }
  | { ok: true; disabled: true }
  | { ok: false; error: string };

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysLate = (due: Date | null) => (due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86_400_000)) : 0);

/** Shape the dashboard numbers into the facts the model may use — nothing else reaches it. */
export function briefingFactsFrom(d: DashboardData, tenantName: string): BriefingFacts {
  return {
    today: new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'Asia/Kolkata' }).format(new Date()),
    tenantName,
    overdue: {
      count: d.overdueInvoices.length, total: d.overdue, customers: d.overdueCustomers,
      top: d.overdueInvoices.slice(0, 3).map((r) => ({
        customer: r.customerName ?? 'a customer', number: r.number, outstanding: r.outstanding, daysLate: daysLate(r.dueDate),
      })),
    },
    dueSoon: { count: d.dueSoon.n, total: d.dueSoon.total },
    followups: { count: d.followupsDue, names: d.followupLeads.map((l) => l.customerName) },
    staleQuotes: {
      count: d.staleQuotes.length, total: d.staleQuotes.reduce((s, q) => s + Number(q.grandTotal), 0),
      items: d.staleQuotes.slice(0, 3).map((q) => ({ number: q.number, customer: q.customerName ?? 'a customer', days: q.days, total: Number(q.grandTotal) })),
    },
    ordersDue: {
      count: d.ordersDue.length,
      items: d.ordersDue.slice(0, 3).map((o) => ({ number: o.number, customer: o.customerName ?? 'a customer', deliveryDate: formatDate(o.deliveryDate), late: o.late })),
    },
    billedThisMonth: d.invoicedThisMonth,
    billedLastMonth: d.invoicedLastMonth,
    collectedThisMonth: d.collectedThisMonth,
    receivables: d.receivables,
    newEnquiriesThisWeek: d.newEnquiriesThisWeek,
    quotesSentThisWeek: d.quotesSentThisWeek,
    openOrders: { count: d.ordersOpen.n, value: d.ordersOpen.value },
  };
}

/** Today's briefing — from cache, or freshly written (and cached) when missing or `refresh` is set. */
export async function getBriefing(user: CurrentUser, opts: { refresh?: boolean } = {}): Promise<BriefingView> {
  if (!aiEnabled()) return { ok: true, disabled: true };
  const day = todayIST();
  try {
    if (!opts.refresh) {
      const [row] = await withTenant(user.tenantId, user.userId, (tx) =>
        tx.select({ content: aiBriefing.content, createdAt: aiBriefing.createdAt })
          .from(aiBriefing).where(and(eq(aiBriefing.tenantId, user.tenantId), eq(aiBriefing.day, day))).limit(1),
      );
      if (row) return { ok: true, text: row.content, generatedAt: row.createdAt.toISOString(), cached: true };
    }
    if (!checkAiRateLimit(user.tenantId)) return { ok: false, error: 'AI is busy — try again in a minute.' };

    const [d, [t]] = await Promise.all([
      dashboardData(),
      withTenant(user.tenantId, user.userId, (tx) => tx.select({ name: tenant.name }).from(tenant).limit(1)),
    ]);
    const facts = briefingFactsFrom(d, t?.name ?? 'MS Enterprises');
    const { text, usage, model } = await writeBriefing(facts);
    recordAiUsage(user.tenantId, user.userId, 'briefing', model, usage);

    const now = new Date();
    await withTenant(user.tenantId, user.userId, (tx) =>
      tx.insert(aiBriefing)
        .values({ tenantId: user.tenantId, day, content: text, facts, model, createdAt: now })
        .onConflictDoUpdate({ target: [aiBriefing.tenantId, aiBriefing.day], set: { content: text, facts, model, createdAt: now } }),
    );
    return { ok: true, text, generatedAt: now.toISOString(), cached: false };
  } catch (e) {
    console.error('briefing failed:', e);
    return { ok: false, error: 'Couldn’t write today’s summary right now. The numbers above are still correct.' };
  }
}
