import 'server-only';
import { z } from 'zod';
import { formatINR } from '@ms/core';
import { withTenant, customer, lead, quotation, taxInvoice, tenant, eq } from '@ms/db';
import type {
  DraftMessageInput, DraftMessageResult, MessageDraft, PriceHistoryInput, PriceHistoryResult, MessagePurpose,
} from '@ms/ai';
import { MESSAGE_PURPOSES } from '@ms/ai';
import type { CurrentUser } from './auth';
import { priceHistory, summarizeRates } from './price-history';
import { shareUrl } from './share';
import { DEFAULT_WHATSAPP_NUMBER, mailtoLink, whatsappLink } from './outreach';

// The assistant's INSTANT tools (no confirmation card): read past rates, and
// prepare a message the user sends themselves. Both are read-only on the ERP —
// nothing here writes, and nothing here sends.

const NOT_FOUND = 'Couldn’t find that — check the name and try again.';
const uuidField = z.string().uuid(NOT_FOUND);

// ── price_history ───────────────────────────────────────────────────────────

const priceInput = z.object({
  q: z.string().trim().min(1).max(120),
  customerId: uuidField.optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

export async function priceHistoryForAssistant(user: CurrentUser, input: PriceHistoryInput): Promise<PriceHistoryResult> {
  const parsed = priceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Bad input.' };
  const { q, customerId, limit } = parsed.data;
  const allowed = ['quotation.view', 'invoice.view'].some((p) => user.permissions.has(p));
  if (!allowed) return { ok: false, error: 'Your login can’t see past rates — ask the owner for access.' };
  try {
    const rows = await withTenant(user.tenantId, user.userId, (tx) => priceHistory(tx, { q, customerId, limit: limit ?? 12 }));
    return {
      ok: true,
      lines: rows.map((r) => ({
        date: r.docDate, customer: r.customerName, document: r.docNumber, description: r.description,
        qty: r.qty, uom: r.uom, rate: r.rate, gstRate: r.gstRate, part: r.groupLabel,
      })),
      stats: summarizeRates(rows),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read past rates.' };
  }
}

// ── draft_message ───────────────────────────────────────────────────────────

const messageInput = z.object({
  purpose: z.enum(MESSAGE_PURPOSES).default('other'),
  customerId: uuidField.optional(),
  leadId: uuidField.optional(),
  phone: z.string().trim().max(20).optional(),
  text: z.string().trim().min(1, 'Write the message first').max(2000, 'That message is too long (max 2000 characters)'),
  subject: z.string().trim().max(150).optional(),
  documentType: z.enum(['quotation', 'invoice']).optional(),
  documentId: uuidField.optional(),
});

const PDF_TOKEN = /\{\{\s*pdf_link\s*\}\}/gi;

const DEFAULT_SUBJECT: Record<MessagePurpose, string> = {
  quotation_followup: 'Regarding our quotation',
  payment_reminder: 'Payment reminder',
  delivery_update: 'Delivery update',
  thank_you: 'Thank you',
  enquiry_reply: 'Regarding your enquiry',
  other: 'Message from M.S. Enterprises',
};

export async function draftMessageForAssistant(
  user: CurrentUser,
  input: DraftMessageInput,
  baseUrl: string,
): Promise<DraftMessageResult> {
  const parsed = messageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Bad input.' };
  const d = parsed.data;
  if (d.text.replace(PDF_TOKEN, '').includes('{{')) {
    return { ok: false, error: 'The message still has a placeholder in it — fill in the real words (only {{pdf_link}} is allowed).' };
  }

  try {
    return await withTenant(user.tenantId, user.userId, async (tx): Promise<DraftMessageResult> => {
      // The document first: it can also tell us who the recipient is.
      let pdfLink: string | undefined;
      let documentLabel: string | undefined;
      let docCustomerId: string | undefined;
      if (d.documentId) {
        const type = d.documentType ?? 'quotation';
        if (!user.permissions.has(type === 'invoice' ? 'invoice.view' : 'quotation.view')) {
          return { ok: false, error: `Your login can’t see ${type === 'invoice' ? 'bills' : 'quotations'} — ask the owner for access.` };
        }
        if (type === 'invoice') {
          const [inv] = await tx.select({ id: taxInvoice.id, number: taxInvoice.number, customerId: taxInvoice.customerId, status: taxInvoice.status, grandTotal: taxInvoice.grandTotal })
            .from(taxInvoice).where(eq(taxInvoice.id, d.documentId)).limit(1);
          if (!inv) return { ok: false, error: 'Couldn’t find that bill — check the number and try again.' };
          if (inv.status === 'cancelled') return { ok: false, error: `${inv.number} is cancelled — it can’t be shared.` };
          pdfLink = shareUrl(baseUrl, 'invoice', inv.id, user.tenantId);
          documentLabel = `Bill ${inv.number} · ${formatINR(inv.grandTotal)}`;
          docCustomerId = inv.customerId;
        } else {
          const [q] = await tx.select({ id: quotation.id, number: quotation.number, customerId: quotation.customerId, grandTotal: quotation.grandTotal })
            .from(quotation).where(eq(quotation.id, d.documentId)).limit(1);
          if (!q) return { ok: false, error: 'Couldn’t find that quotation — check the number and try again.' };
          pdfLink = shareUrl(baseUrl, 'quotation', q.id, user.tenantId);
          documentLabel = `Quotation ${q.number} · ${formatINR(q.grandTotal)}`;
          docCustomerId = q.customerId;
        }
      }

      // Then the person.
      let recipient: MessageDraft['recipient'] | undefined;
      const customerId = d.customerId ?? (d.leadId ? undefined : docCustomerId);
      if (customerId) {
        if (!user.permissions.has('customer.view')) return { ok: false, error: 'Your login can’t see customers — ask the owner for access.' };
        const [c] = await tx.select({ name: customer.name, contact: customer.contactPerson, phone: customer.phone, email: customer.email })
          .from(customer).where(eq(customer.id, customerId)).limit(1);
        if (!c) return { ok: false, error: 'Couldn’t find that customer — check the name and try again.' };
        recipient = { kind: 'customer', name: c.contact ? `${c.name} (${c.contact})` : c.name, phone: c.phone ?? undefined, email: c.email ?? undefined };
      } else if (d.leadId) {
        if (!user.permissions.has('lead.view')) return { ok: false, error: 'Your login can’t see enquiries — ask the owner for access.' };
        const [l] = await tx.select({ name: lead.customerName, contact: lead.contact, phone: lead.phone, email: lead.email })
          .from(lead).where(eq(lead.id, d.leadId)).limit(1);
        if (!l) return { ok: false, error: 'Couldn’t find that enquiry — check the name and try again.' };
        recipient = { kind: 'lead', name: l.contact ? `${l.name} (${l.contact})` : l.name, phone: l.phone ?? undefined, email: l.email ?? undefined };
      } else if (d.phone) {
        recipient = { kind: 'phone', name: d.phone, phone: d.phone };
      } else {
        return { ok: false, error: 'Say who the message is for — a customer, an enquiry, or a phone number.' };
      }

      // Insert the PDF link (or drop the placeholder cleanly when there is none).
      let text = d.text.replace(/\\n/g, '\n');
      if (PDF_TOKEN.test(text)) {
        text = pdfLink ? text.replace(PDF_TOKEN, pdfLink) : text.replace(PDF_TOKEN, '').replace(/[ \t]{2,}/g, ' ').trim();
      } else if (pdfLink) {
        text = `${text}\n\n${documentLabel ? `${documentLabel.split(' · ')[0]}: ` : ''}${pdfLink}`;
      }
      // Sign-off falls back to the business name so the customer knows who wrote.
      const [t] = await tx.select({ name: tenant.name, settings: tenant.settings }).from(tenant).limit(1);
      const settings = (t?.settings ?? {}) as { outreach?: { whatsappNumber?: string } };
      const companyNumber = settings.outreach?.whatsappNumber || DEFAULT_WHATSAPP_NUMBER;
      if (!/team\s+m\.?s\.?\s*enterprises|—\s*m\.?s\.?\s*enterprises/i.test(text)) {
        text = `${text}\n— Team ${t?.name ?? 'M.S. Enterprises'} · ${companyNumber}`;
      }

      const subject = d.subject || DEFAULT_SUBJECT[d.purpose] + (documentLabel ? ` — ${documentLabel.split(' · ')[0]}` : '');
      const message: MessageDraft = {
        purpose: d.purpose,
        recipient,
        text,
        subject,
        whatsappUrl: whatsappLink(recipient.phone, text) ?? undefined,
        mailtoUrl: mailtoLink(recipient.email, subject, text) ?? undefined,
        pdfLink,
        documentLabel,
      };
      return { ok: true, message };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not prepare the message.' };
  }
}
