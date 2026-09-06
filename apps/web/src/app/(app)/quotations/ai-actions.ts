'use server';
import { z } from 'zod';
import { aiEnabled, draftQuotation, polishProse, type QuoteDraft } from '@ms/ai';
import { withTenant, customer, quotation, quotationItem, tenant, desc, eq } from '@ms/db';
import { parseLetterhead } from '@ms/core';
import { requirePermission } from '@/lib/rbac';
import { checkAiRateLimit, recordAiUsage } from '@/lib/ai';

export type DraftResult = { ok: true; draft: QuoteDraft } | { ok: false; error: string };
export type PolishResult = { ok: true; text: string } | { ok: false; error: string };

const AI_UNAVAILABLE = "AI isn't available right now — you can still type the items yourself.";
const AI_BUSY = 'AI is busy — wait a minute and try again, or type the items yourself.';

const draftInput = z.object({
  requirement: z.string().trim().min(10, 'Tell AI a little more — a few words about the parts and prices.').max(4000, 'That is too long for AI — keep it under 4000 characters.'),
  customerId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
});

/** AI-proposed quotation line items — human reviews everything before saving. */
export async function draftQuotationItemsAction(input: {
  requirement: string;
  customerId?: string;
}): Promise<DraftResult> {
  const u = await requirePermission('quotation.create');
  if (!aiEnabled()) return { ok: false, error: AI_UNAVAILABLE };
  if (!checkAiRateLimit(u.tenantId)) return { ok: false, error: AI_BUSY };

  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? AI_UNAVAILABLE };

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
    return { ok: false, error: AI_UNAVAILABLE };
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
  if (!aiEnabled()) return { ok: false, error: AI_UNAVAILABLE };
  if (!checkAiRateLimit(u.tenantId)) return { ok: false, error: AI_BUSY };

  const parsed = polishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That text is too long for AI — shorten it and try again.' };

  try {
    const { text, usage, model } = await polishProse(parsed.data);
    recordAiUsage(u.tenantId, u.userId, 'prose', model, usage);
    return { ok: true, text };
  } catch (e) {
    console.error('prose polish failed:', e);
    return { ok: false, error: AI_UNAVAILABLE };
  }
}
