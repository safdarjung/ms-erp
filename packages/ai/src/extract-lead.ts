// zodOutputFormat is typed against the zod v4 core (bundled inside zod ≥3.25
// as the `zod/v4` subpath) — use it here; the rest of the repo stays on v3.
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Type, type Schema } from '@google/genai';
import { activeProvider, anthropic } from './client';
import { gemini, usageFromGemini, withGeminiFallback } from './gemini';
import { AI_MODELS, addUsage, emptyUsage, type TokenUsage } from './models';

// Free-form enquiry emails (not the labelled IndiaMART / TradeIndia layouts,
// which a deterministic parser handles) → a structured lead draft for the
// review screen. The model only READS; a person still creates the enquiry.

export const extractedLeadSchema = z.object({
  isEnquiry: z.boolean().describe('True only if this email is a genuine business enquiry / request for quotation / order for tooling, dies, moulds or machining work. False for newsletters, invoices, OTPs, delivery notifications, job applications, vendor pitches and anything automated.'),
  confidence: z.number().describe('0 to 1 — how sure you are about isEnquiry and the fields'),
  customerName: z.string().describe('Company name if stated, else the person\'s name. Empty string if unknown.'),
  contact: z.string().describe('Contact person\'s name, empty if unknown'),
  phone: z.string().describe('Phone / mobile number exactly as written (digits, +91 allowed), empty if none'),
  email: z.string().describe('Sender or stated email address, empty if none'),
  requirement: z.string().describe('What they need in 1–2 lines: part/component, operations (die, mould, VMC/CNC machining), quantity, material, drawing availability, deadline. Empty if unclear.'),
  valueEstimate: z.number().describe('Approximate order value in INR if the email states a budget or amount, else 0'),
  language: z.string().describe('Main language of the email: en, hi, hinglish, or other'),
});
export type ExtractedLeadDraft = z.infer<typeof extractedLeadSchema>;

const GEMINI_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    isEnquiry: { type: Type.BOOLEAN, description: 'True only for a genuine business enquiry / RFQ / order for tooling, dies, moulds or machining. False for newsletters, invoices, OTPs, notifications, job applications, vendor pitches, automated mail.' },
    confidence: { type: Type.NUMBER, description: '0–1 confidence' },
    customerName: { type: Type.STRING, description: 'Company name if stated, else the person\'s name; empty if unknown' },
    contact: { type: Type.STRING, description: 'Contact person, empty if unknown' },
    phone: { type: Type.STRING, description: 'Phone exactly as written; empty if none' },
    email: { type: Type.STRING, description: 'Email address; empty if none' },
    requirement: { type: Type.STRING, description: '1–2 lines: part, operations, quantity, material, drawing, deadline' },
    valueEstimate: { type: Type.NUMBER, description: 'Approx. INR value if stated, else 0' },
    language: { type: Type.STRING, description: 'en | hi | hinglish | other' },
  },
  required: ['isEnquiry', 'confidence', 'customerName', 'contact', 'phone', 'email', 'requirement', 'valueEstimate', 'language'],
};

const SYSTEM = `
You read incoming emails for MS Enterprises, an Indian precision die & machining job-shop (press tools, dies, moulds, jigs & fixtures, VMC/CNC machining, job work), and pull out the details of a sales enquiry.

Rules:
- Copy names, phone numbers and email addresses EXACTLY as written — never invent, complete or "fix" a digit.
- customerName is the company when one is stated; otherwise the person. Never use the sender's email domain as a name unless nothing else exists.
- requirement is a short factual summary of what they want; include quantity, material, part name and deadline when stated; leave out pleasantries.
- Signatures often carry the phone and company name — read them.
- isEnquiry is false for newsletters, promotional mail, invoices/statements sent TO the shop, OTPs, delivery/shipping notifications, job applications, and vendor sales pitches. Be strict: when in doubt, set isEnquiry true with LOW confidence rather than dropping a real enquiry.
`.trim();

const MAX_BODY_CHARS = 6000;

function clamp(d: ExtractedLeadDraft): ExtractedLeadDraft {
  const s = (v: string, n: number) => (v ?? '').trim().slice(0, n);
  return {
    isEnquiry: !!d.isEnquiry,
    confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)),
    customerName: s(d.customerName, 200),
    contact: s(d.contact, 200),
    phone: s(d.phone, 20),
    email: s(d.email, 255),
    requirement: s(d.requirement, 2000),
    valueEstimate: Math.max(0, Number(d.valueEstimate) || 0),
    language: s(d.language, 12) || 'en',
  };
}

export async function extractLeadFromEmail(input: {
  subject?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  text: string;
  signal?: AbortSignal;
}): Promise<{ draft: ExtractedLeadDraft; usage: TokenUsage; model: string }> {
  const body = (input.text ?? '').replace(/\r/g, '').trim().slice(0, MAX_BODY_CHARS);
  const userText = [
    `From: ${input.fromName ?? ''} <${input.fromEmail ?? ''}>`,
    `Subject: ${input.subject ?? ''}`,
    '',
    body || '(empty body)',
  ].join('\n');

  if (activeProvider() === 'gemini') {
    const { result, model } = await withGeminiFallback((m) =>
      gemini().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_SCHEMA,
          abortSignal: input.signal,
        },
      }),
    );
    let json: unknown;
    try { json = JSON.parse(result.text ?? ''); } catch { throw new Error('The model returned invalid JSON.'); }
    const parsed = extractedLeadSchema.safeParse(json);
    if (!parsed.success) throw new Error('The model returned an invalid extraction.');
    return { draft: clamp(parsed.data), usage: usageFromGemini(result.usageMetadata), model };
  }

  const client = anthropic();
  const response = await client.messages.parse(
    {
      model: AI_MODELS.classify,
      max_tokens: 1200,
      output_config: { format: zodOutputFormat(extractedLeadSchema) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    },
    { signal: input.signal },
  );
  const usage = emptyUsage();
  addUsage(usage, response.usage);
  const draft = response.parsed_output;
  if (!draft) throw new Error('The model returned an invalid extraction.');
  return { draft: clamp(draft), usage, model: AI_MODELS.classify };
}
