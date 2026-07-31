'use server';
import { z } from 'zod';
import { aiEnabled, draftQuotation, polishProse, type QuoteDraft } from '@ms/ai';
import { withTenant, customer, quotation, quotationItem, tenant, desc, eq } from '@ms/db';
import { parseLetterhead } from '@ms/core';
import { requirePermission } from '@/lib/rbac';
import { checkAiRateLimit, recordAiUsage } from '@/lib/ai';

export type DraftResult = { ok: true; draft: QuoteDraft } | { ok: false; error: string };
export type PolishResult = { ok: true; text: string } | { ok: false; error: string };

const draftInput = z.object({
  requirement: z.string().trim().min(10, 'Describe the job in a bit more detail').max(4000),
  customerId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
});

/** AI-proposed quotation line items — human reviews everything before saving. */
export async function draftQuotationItemsAction(input: {
  requirement: string;
  customerId?: string;
}): Promise<DraftResult> {
  const u = await requirePermission('quotation.create');
  if (!aiEnabled()) return { ok: false, error: 'AI is not configured (set ANTHROPIC_API_KEY).' };
  if (!checkAiRateLimit(u.tenantId)) return { ok: false, error: 'Too many AI requests — try again in a minute.' };

  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    const ctx = await withTenant(u.tenantId, u.userId, async (tx) => {
      const cust = parsed.data.customerId
        ? (await tx.select({ name: customer.name, stateCode: customer.stateCode })
            .from(customer).where(eq(customer.id, parsed.data.customerId)).limit(1))[0]
        : undefined;
      // Recent quoted items as pricing priors (newest first).
      const history = await tx
        .select({
          description: quotationItem.description, hsn: quotationItem.hsn, qty: quotationItem.qty,
          uom: quotationItem.uom, rate: quotationItem.rate, gstRate: quotationItem.gstRate,
          isToolingCharge: quotationItem.isToolingCharge, docDate: quotation.docDate,
        })
        .from(quotationItem)
        .innerJoin(quotation, eq(quotationItem.quotationId, quotation.id))
        .orderBy(desc(quotation.docDate))
        .limit(30);
      const [t] = await tx.select({ settings: tenant.settings }).from(tenant).limit(1);
      return { cust, history, letterhead: parseLetterhead(t?.settings) };
    });

    const { draft, usage, model } = await draftQuotation({
      requirement: parsed.data.requirement,
      customerName: ctx.cust?.name,
      customerState: ctx.cust?.stateCode ?? undefined,
      history: ctx.history.map((h) => ({ ...h, docDate: h.docDate.toISOString().slice(0, 10) })),
      defaultTerms: ctx.letterhead?.defaultTerms,
    });
    recordAiUsage(u.tenantId, u.userId, 'quote_draft', model, usage);
    return { ok: true, draft };
  } catch (e) {
    console.error('quote draft failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Drafting failed — please try again.' };
  }
}

const polishInput = z.object({
  kind: z.enum(['terms', 'notes']),
  docType: z.enum(['quotation', 'invoice']),
  text: z.string().max(6000),
  context: z.string().max(500).optional(),
});

/** Polish/draft the prose fields (terms, notes) — never touches numbers. */
export async function polishProseAction(input: {
  kind: 'terms' | 'notes';
  docType: 'quotation' | 'invoice';
  text: string;
  context?: string;
}): Promise<PolishResult> {
  const u = await requirePermission(input.docType === 'invoice' ? 'invoice.create' : 'quotation.create');
  if (!aiEnabled()) return { ok: false, error: 'AI is not configured (set ANTHROPIC_API_KEY).' };
  if (!checkAiRateLimit(u.tenantId)) return { ok: false, error: 'Too many AI requests — try again in a minute.' };

  const parsed = polishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  try {
    const { text, usage, model } = await polishProse(parsed.data);
    recordAiUsage(u.tenantId, u.userId, 'prose', model, usage);
    return { ok: true, text };
  } catch (e) {
    console.error('prose polish failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Polishing failed — please try again.' };
  }
}
