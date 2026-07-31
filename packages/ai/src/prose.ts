import { activeProvider, anthropic } from './client';
import { gemini, usageFromGemini, withGeminiFallback } from './gemini';
import { AI_MODELS, addUsage, emptyUsage, type TokenUsage } from './models';

// Bounded prose help (docs/05 §4b): drafts/polishes ONLY free-text fields
// (terms, notes, descriptions) — never numbers, which stay deterministic.

const SYSTEM = `
You polish and draft short business prose for documents of MS Enterprises, an Indian precision die & machining job-shop (quotations, proforma & GST invoices).

Rules:
- Output ONLY the final text — no preamble, no explanations, no markdown fences or headings.
- Match the user's language: English in → English out; Hindi/Hinglish in → the same register out.
- Terms & conditions: short numbered lines (1., 2., …), each one crisp clause — delivery, payment, validity, taxes, packing/freight, inspection/warranty as relevant. Keep any concrete facts (days, percentages, amounts) from the input EXACTLY as given; never invent numbers, bank details or legal claims.
- Notes/descriptions: clear, professional, concise. Indian business English is fine.
- If asked to draft from nothing, produce a sensible standard version for this trade.
`.trim();

export async function polishProse(input: {
  kind: 'terms' | 'notes';
  docType: 'quotation' | 'invoice';
  text: string;
  instruction?: string;
  context?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: TokenUsage; model: string }> {
  const task = input.text.trim()
    ? `Improve the ${input.kind} below for a ${input.docType}. ${input.instruction ?? 'Make them tighter, clearer and complete — keep every concrete fact unchanged.'}\n\n---\n${input.text.trim()}`
    : `Draft standard ${input.kind} for a ${input.docType} of this job-shop. ${input.instruction ?? ''}`;
  const userText = input.context ? `${task}\n\nDocument context: ${input.context}` : task;

  if (activeProvider() === 'gemini') {
    const { result, model } = await withGeminiFallback((m) =>
      gemini().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        config: { systemInstruction: SYSTEM, abortSignal: input.signal },
      }),
    );
    const text = (result.text ?? '').trim();
    if (!text) throw new Error('The model returned no text — please try again.');
    return { text, usage: usageFromGemini(result.usageMetadata), model };
  }

  const client = anthropic();
  const response = await client.messages.create(
    {
      model: AI_MODELS.prose,
      max_tokens: 1500,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    },
    { signal: input.signal },
  );

  const usage = emptyUsage();
  addUsage(usage, response.usage);

  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text).join('').trim();
  if (!text) throw new Error('The model returned no text — please try again.');
  return { text, usage, model: AI_MODELS.prose };
}
