import 'server-only';
import { withTenant, aiUsage, aiAction, users, count, desc, eq, sql } from '@ms/db';
import { requireUser, can } from './rbac';

// What the AI has been doing for this business — for the owner's "AI activity"
// page: how much it is used, by whom, what it proposed and what was saved.

const DAYS = 30;

export type AiAdminData = Awaited<ReturnType<typeof aiAdminData>>;

/** Plain words for ai_action kinds (tool names). */
export const AI_KIND_LABELS: Record<string, string> = {
  create_customer: 'New customer', update_customer: 'Customer changed', delete_customer: 'Customer deleted',
  set_customer_status: 'Customer archived / restored',
  create_lead: 'New enquiry', update_lead: 'Enquiry changed', delete_lead: 'Enquiry deleted',
  log_lead_activity: 'Note on enquiry', convert_lead_to_customer: 'Enquiry → customer',
  create_quotation: 'New quotation', update_quotation: 'Quotation changed', duplicate_quotation: 'Quotation copied',
  set_quotation_status: 'Quotation status', convert_quotation_to_invoice: 'Quotation → bill', convert_quotation_to_order: 'Quotation → order',
  create_order: 'New order', update_order: 'Order changed', set_order_status: 'Order status', convert_order_to_invoice: 'Order → bill',
  create_invoice: 'New bill', update_invoice: 'Bill changed', set_invoice_status: 'Bill status',
  record_payment: 'Payment received', delete_payment: 'Payment removed',
};

export const AI_FEATURE_LABELS: Record<string, string> = {
  assistant: 'Ask AI (chat & actions)', quote_draft: 'Draft with AI (quotation form)', prose: 'Improve wording',
  transcribe: 'Voice typing', briefing: 'Daily summary', extract: 'Reading enquiry emails',
};

export async function aiAdminData() {
  const u = await requireUser();
  if (!can(u, 'settings.manage')) throw new Error('FORBIDDEN: missing settings.manage');
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  return withTenant(u.tenantId, u.userId, async (tx) => {
    const tokens = sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)`;
    const cost = sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`;

    const [month] = await tx.select({ n: count(), tokens, cost }).from(aiUsage).where(sql`${aiUsage.createdAt} >= ${monthStart}`);
    const [window] = await tx.select({ n: count(), tokens, cost }).from(aiUsage).where(sql`${aiUsage.createdAt} >= ${since}`);

    const byDay = await tx.select({
      day: sql<string>`to_char(${aiUsage.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`, n: count(), tokens,
    }).from(aiUsage).where(sql`${aiUsage.createdAt} >= ${since}`).groupBy(sql`1`).orderBy(sql`1`);

    const byFeature = await tx.select({ feature: aiUsage.feature, n: count(), tokens, cost })
      .from(aiUsage).where(sql`${aiUsage.createdAt} >= ${since}`).groupBy(aiUsage.feature).orderBy(desc(count()));

    const byUser = await tx.select({ userId: aiUsage.userId, name: users.name, n: count(), tokens })
      .from(aiUsage).leftJoin(users, eq(aiUsage.userId, users.id))
      .where(sql`${aiUsage.createdAt} >= ${since}`).groupBy(aiUsage.userId, users.name).orderBy(desc(count()));

    const byModel = await tx.select({ model: aiUsage.model, n: count() })
      .from(aiUsage).where(sql`${aiUsage.createdAt} >= ${since}`).groupBy(aiUsage.model).orderBy(desc(count()));

    const actionsByStatus = await tx.select({ status: aiAction.status, n: count() })
      .from(aiAction).where(sql`${aiAction.createdAt} >= ${since}`).groupBy(aiAction.status);

    const recentActions = await tx.select({
      id: aiAction.id, kind: aiAction.kind, summary: aiAction.summary, status: aiAction.status, error: aiAction.error,
      createdAt: aiAction.createdAt, decidedAt: aiAction.decidedAt, expiresAt: aiAction.expiresAt, userName: users.name,
      result: aiAction.result,
    }).from(aiAction).leftJoin(users, eq(aiAction.userId, users.id))
      .orderBy(desc(aiAction.createdAt)).limit(60);

    // Fill the last 30 days so the bars show quiet days too.
    const days: { label: string; value: number; calls: number }[] = [];
    const map = new Map(byDay.map((r) => [r.day, r]));
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const r = map.get(key);
      days.push({ label: String(Number(key.slice(8, 10))), value: Number(r?.tokens ?? 0), calls: Number(r?.n ?? 0) });
    }

    const num = (v: unknown) => Number(v ?? 0);
    const now = Date.now();
    return {
      days: DAYS,
      month: { calls: num(month?.n), tokens: num(month?.tokens), costUsd: num(month?.cost) },
      window: { calls: num(window?.n), tokens: num(window?.tokens), costUsd: num(window?.cost) },
      byDay: days,
      byFeature: byFeature.map((f) => ({ feature: f.feature, label: AI_FEATURE_LABELS[f.feature] ?? f.feature, calls: num(f.n), tokens: num(f.tokens), costUsd: num(f.cost) })),
      byUser: byUser.map((r) => ({ name: r.name ?? (r.userId ? 'Former user' : 'Automatic (email reading)'), calls: num(r.n), tokens: num(r.tokens) })),
      byModel: byModel.map((m) => ({ model: m.model, calls: num(m.n) })),
      actionsByStatus: Object.fromEntries(actionsByStatus.map((a) => [a.status, num(a.n)])) as Record<string, number>,
      recentActions: recentActions.map((a) => ({
        ...a,
        // A pending card past its expiry never got an answer.
        status: a.status === 'pending' && a.expiresAt.getTime() < now ? 'expired' : a.status,
        label: AI_KIND_LABELS[a.kind] ?? a.kind.replace(/_/g, ' '),
        path: (a.result as { path?: string } | null)?.path ?? null,
      })),
    };
  });
}
