import { activeProvider, anthropic } from './client';
import { gemini, usageFromGemini, withGeminiFallback } from './gemini';
import { AI_MODELS, addUsage, emptyUsage, type TokenUsage } from './models';

// The dashboard's "today" briefing: the app gathers the facts deterministically
// (money due, follow-ups, quotations waiting, orders due…) and the model only
// turns them into three to five plain lines. Numbers never come from the model.

export type BriefingFacts = {
  today: string;
  tenantName: string;
  overdue: { count: number; total: number; customers: number; top: { customer: string; number: string; outstanding: number; daysLate: number }[] };
  dueSoon: { count: number; total: number };
  followups: { count: number; names: string[] };
  staleQuotes: { count: number; total: number; items: { number: string; customer: string; days: number; total: number }[] };
  ordersDue: { count: number; items: { number: string; customer: string; deliveryDate: string; late: boolean }[] };
  billedThisMonth: number;
  billedLastMonth: number;
  collectedThisMonth: number;
  receivables: number;
  newEnquiriesThisWeek: number;
  quotesSentThisWeek: number;
  openOrders: { count: number; value: number };
};

const SYSTEM = `
You write the morning briefing shown on the home screen of the ERP of an Indian precision die & machining job-shop. The reader is the owner or a sales person — a shop-floor businessperson, not a software user.

Rules:
- Use ONLY the facts you are given. Never add, estimate or round numbers beyond what is given; copy amounts exactly as formatted.
- 3 to 5 lines, each starting with "• ", each one thing to do or one thing worth knowing, most urgent first (money overdue → follow-ups due today → quotations waiting for a reply → orders due → how the month is going).
- Plain shop words: bill, quotation, order, enquiry, customer, "still due", "overdue". A little Indian business idiom is fine ("baaki"), but write in English. No headings, no markdown, no emojis, no greeting, no sign-off.
- Name the customer and document number when you mention a specific bill or quotation; suggest the concrete next step ("call", "send a reminder", "chase").
- If nothing needs attention, say so warmly in one line and add one line on the month's billing.
- Under 90 words in total.
`.trim();

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Render the facts as compact prose input for the model. */
export function briefingFactsText(f: BriefingFacts): string {
  const lines: string[] = [`Today: ${f.today}. Business: ${f.tenantName}.`];
  if (f.overdue.count) {
    lines.push(`Overdue bills: ${f.overdue.count} from ${f.overdue.customers} customer(s), total ${inr(f.overdue.total)}. Largest: ` +
      f.overdue.top.map((t) => `${t.customer} — ${t.number} ${inr(t.outstanding)} (${t.daysLate} days late)`).join('; ') + '.');
  } else lines.push('Overdue bills: none.');
  if (f.dueSoon.count) lines.push(`Bills due within 7 days: ${f.dueSoon.count}, ${inr(f.dueSoon.total)}.`);
  lines.push(f.followups.count
    ? `Follow-ups due today or earlier: ${f.followups.count} (${f.followups.names.slice(0, 4).join(', ')}${f.followups.count > 4 ? ', …' : ''}).`
    : 'Follow-ups due: none.');
  lines.push(f.staleQuotes.count
    ? `Quotations sent 5+ days ago with no answer: ${f.staleQuotes.count}, worth ${inr(f.staleQuotes.total)}: ` +
      f.staleQuotes.items.map((q) => `${q.number} ${q.customer} ${inr(q.total)} (${q.days} days)`).join('; ') + '.'
    : 'Quotations waiting for a reply: none.');
  lines.push(f.ordersDue.count
    ? `Orders due within 7 days or late: ` + f.ordersDue.items.map((o) => `${o.number} ${o.customer} due ${o.deliveryDate}${o.late ? ' (LATE)' : ''}`).join('; ') + '.'
    : 'Orders due this week: none.');
  lines.push(`Billed this month: ${inr(f.billedThisMonth)} (last month ${inr(f.billedLastMonth)}). Payments received this month: ${inr(f.collectedThisMonth)}. Total still to collect: ${inr(f.receivables)}.`);
  lines.push(`New enquiries this week: ${f.newEnquiriesThisWeek}. Quotations sent this week: ${f.quotesSentThisWeek}. Open orders: ${f.openOrders.count} worth ${inr(f.openOrders.value)}.`);
  return lines.join('\n');
}

/** Turn the day's facts into 3–5 plain lines. */
export async function writeBriefing(
  facts: BriefingFacts,
  opts: { signal?: AbortSignal } = {},
): Promise<{ text: string; usage: TokenUsage; model: string }> {
  const userText = `Facts for today's briefing:\n${briefingFactsText(facts)}\n\nWrite the briefing now.`;

  if (activeProvider() === 'gemini') {
    const { result, model } = await withGeminiFallback((m) =>
      gemini().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        config: { systemInstruction: SYSTEM, abortSignal: opts.signal },
      }),
    );
    const text = (result.text ?? '').trim();
    if (!text) throw new Error('The model returned no text.');
    return { text: tidy(text), usage: usageFromGemini(result.usageMetadata), model };
  }

  const client = anthropic();
  const response = await client.messages.create(
    {
      model: AI_MODELS.classify,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    },
    { signal: opts.signal },
  );
  const usage = emptyUsage();
  addUsage(usage, response.usage);
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text).join('').trim();
  if (!text) throw new Error('The model returned no text.');
  return { text: tidy(text), usage, model: AI_MODELS.classify };
}

/** Normalise bullets and strip stray markdown so the card renders cleanly. */
function tidy(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•·]\s*/, '').replace(/\*\*/g, ''))
    .filter(Boolean)
    .slice(0, 6)
    .map((l) => `• ${l}`)
    .join('\n');
}
