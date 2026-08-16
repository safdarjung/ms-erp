// zodOutputFormat is typed against the zod v4 core (bundled inside zod ≥3.25
// as the `zod/v4` subpath) — use it here; the rest of the repo stays on v3.
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Type, type Schema } from '@google/genai';
import { activeProvider, anthropic } from './client';
import { gemini, usageFromGemini, withGeminiFallback } from './gemini';
import { AI_MODELS, addUsage, emptyUsage, type TokenUsage } from './models';

// Smart quotation drafting (docs/05 §3): the model proposes line items, unit
// rates, terms and anomaly flags as a validated object. All totals/GST math
// stays deterministic in @ms/core — the AI never computes the legal numbers.

export const quoteDraftSchema = z.object({
  items: z.array(z.object({
    description: z.string().describe('Line item description as it should appear on the quotation, e.g. "Blanking die"'),
    groupLabel: z.string().describe('The part / part-number this line belongs to, e.g. "30017AW1002". Use the SAME value for every die of the same part so they group under it, and keep a part\'s lines together. Empty string for a standalone line with no part.'),
    hsn: z.string().describe('HSN/SAC code, empty string if unsure'),
    qty: z.number().describe('Quantity'),
    uom: z.string().describe('Unit of measure, e.g. NOS, SET, KG, HRS'),
    rate: z.number().describe('Proposed unit rate in INR (ex-GST)'),
    gstRate: z.number().describe('GST percentage, usually 18'),
    isToolingCharge: z.boolean().describe('True for one-time tooling / NRE charges'),
    basis: z.string().describe('One short line on how the rate was arrived at'),
  })).describe('Proposed quotation line items (1–40)'),
  termsSuggestion: z.array(z.string()).describe('Suggested terms & conditions lines (delivery, payment, validity, taxes)'),
  assumptions: z.array(z.string()).describe('Assumptions made (material grade, cycle time basis, scrap %, etc.)'),
  flags: z.array(z.string()).describe('Anomalies the reviewer should check, e.g. "well below last quoted rate for a similar part"'),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;

// Same shape as quoteDraftSchema, in Gemini's response-schema dialect.
const GEMINI_DRAFT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: 'Proposed quotation line items (1–15)',
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          groupLabel: { type: Type.STRING, description: 'The part / part-number this line belongs to (e.g. "30017AW1002"). Same value for every die of the same part; keep a part\'s lines together. Empty string if the line has no part.' },
          hsn: { type: Type.STRING, description: 'HSN/SAC code, empty string if unsure' },
          qty: { type: Type.NUMBER },
          uom: { type: Type.STRING, description: 'NOS, SET, KG, HRS…' },
          rate: { type: Type.NUMBER, description: 'Unit rate in INR (ex-GST)' },
          gstRate: { type: Type.NUMBER, description: 'GST percentage, usually 18' },
          isToolingCharge: { type: Type.BOOLEAN },
          basis: { type: Type.STRING, description: 'How the rate was arrived at' },
        },
        required: ['description', 'groupLabel', 'hsn', 'qty', 'uom', 'rate', 'gstRate', 'isToolingCharge', 'basis'],
      },
    },
    termsSuggestion: { type: Type.ARRAY, items: { type: Type.STRING } },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    flags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['items', 'termsSuggestion', 'assumptions', 'flags'],
};

export type QuoteHistoryItem = {
  description: string; hsn: string | null; qty: string; uom: string;
  rate: string; gstRate: string; isToolingCharge: boolean; docDate: string;
};

const SYSTEM = `
You are the senior estimator at MS Enterprises, an Indian precision die & machining job-shop (press tools, dies, moulds, jigs & fixtures, VMC/CNC machining, EDM, grinding, job work).

You draft quotation line items from an enquiry. A human reviews and edits everything — propose your best professional draft.

Rules:
- Break the work into clear, quotable line items (the part(s), and a separate one-time tooling/NRE line where applicable, marked isToolingCharge).
- GROUPING BY PART (important): when the enquiry lists several parts, each with multiple dies/tools and a price per die — e.g. "part 30017AW1002: blanking die 30000, bending die 16000; part 41928: blanking & punching die 55000, bending die 20000" — make EACH die its own line with its own rate, set that line's groupLabel to the part number/name ("30017AW1002", "41928", …), and keep all the lines of one part together. The quotation then shows each part as a heading with its dies and a subtotal. If there is only one part or none, leave groupLabel empty.
- Propose realistic INR unit rates (ex-GST). Anchor on the shop's recent quoted rates for similar work when history is provided; otherwise use sound estimating judgment for the Indian tooling market and say so in assumptions.
- HSN/SAC: use what history shows for similar items; common codes here — 8207 (interchangeable tools/dies), 8480 (moulds), 7325/7326 (steel articles), SAC 9988 (job work / machining services). Empty string if genuinely unsure.
- GST is normally 18 for this shop's work; job work for registered manufacturers can be 12 — flag it if you choose 12.
- Descriptions: professional and specific (material, size/spec, operations) but concise — one line each.
- assumptions: every guess you made (material grade, cycle-time basis, finish, quantity interpretation).
- flags: anything the reviewer must double-check — big deviations from history, unclear scope, missing info.
- termsSuggestion: 4–7 short lines (delivery period, payment terms, validity, taxes extra as applicable, packing/freight, inspection) tuned to this job. Do not invent bank details.
- You never compute totals or tax amounts — the app does that deterministically from qty × rate.
`.trim();

/** Belt-and-braces clamp — structured outputs can't enforce ranges. */
function clampDraft(draft: QuoteDraft): QuoteDraft {
  draft.items = draft.items.slice(0, 40).map((it) => ({
    ...it,
    qty: Math.max(0.001, Number(it.qty) || 1),
    rate: Math.max(0, Number(it.rate) || 0),
    gstRate: [0, 5, 12, 18, 28].includes(it.gstRate) ? it.gstRate : 18,
    uom: (it.uom || 'NOS').toUpperCase().slice(0, 10),
    hsn: (it.hsn || '').slice(0, 10),
    groupLabel: (it.groupLabel || '').slice(0, 120),
  }));
  return draft;
}

export async function draftQuotation(input: {
  requirement: string;
  customerName?: string;
  customerState?: string;
  history: QuoteHistoryItem[];
  defaultTerms?: string[];
  signal?: AbortSignal;
}): Promise<{ draft: QuoteDraft; usage: TokenUsage; model: string }> {
  const user = [
    `Enquiry / job description:\n${input.requirement.trim()}`,
    input.customerName ? `Customer: ${input.customerName}${input.customerState ? ` (state code ${input.customerState})` : ''}` : null,
    input.history.length
      ? `Recent quoted items from this shop (newest first, rates are ex-GST INR):\n${JSON.stringify(input.history.slice(0, 30))}`
      : 'No quotation history available yet — rely on estimating judgment and record assumptions.',
    input.defaultTerms?.length ? `The shop's standard terms (adapt, keep the spirit):\n${input.defaultTerms.join('\n')}` : null,
    'Draft the quotation now.',
  ].filter(Boolean).join('\n\n');

  if (activeProvider() === 'gemini') {
    const { result, model } = await withGeminiFallback((m) =>
      gemini().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: user }] }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_DRAFT_SCHEMA,
          abortSignal: input.signal,
        },
      }),
    );
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.text ?? '');
    } catch {
      throw new Error('The model returned an invalid draft — please try again.');
    }
    const parsed = quoteDraftSchema.safeParse(parsedJson);
    if (!parsed.success) throw new Error('The model returned an invalid draft — please try again.');
    return { draft: clampDraft(parsed.data), usage: usageFromGemini(result.usageMetadata), model };
  }

  const client = anthropic();
  const response = await client.messages.parse(
    {
      model: AI_MODELS.pricing,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(quoteDraftSchema) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    },
    { signal: input.signal },
  );

  const usage = emptyUsage();
  addUsage(usage, response.usage);

  const draft = response.parsed_output;
  if (!draft) throw new Error('The model returned an invalid draft — please try again.');
  return { draft: clampDraft(draft), usage, model: AI_MODELS.pricing };
}
