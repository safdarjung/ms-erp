import 'server-only';
import { aiEnabled, extractLeadFromEmail } from '@ms/ai';
import { withTenant, inboundMessage, lead, auditLog, eq, or, sql, type Tx } from '@ms/db';
import { createLeadRecord } from '../documents';
import { recordAiUsage } from '../ai';
import type { Channel, InboundEmail, ExtractedLead, IngestOutcome, StoredAttachment } from './types';
import { parseMarketplaceEmail } from './parse-marketplace';
import { isBulk } from './spam';
import { normalizeEmail, normalizePhone } from './dedupe';
import { uploadAttachment, storageConfigured } from './storage';

// Inbound writes have no session user. RLS keys only on `app.current_tenant`, so
// a stable sentinel satisfies the GUC; audit rows are left userId=null (= system).
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Best-effort structured draft from a non-marketplace email (goes to review, never auto-created). */
function bestEffortDraft(email: InboundEmail): ExtractedLead {
  const name = (email.fromName ?? '').trim();
  const subject = (email.subject ?? '').trim();
  const text = (email.text ?? '').replace(/\s+/g, ' ').trim();
  const phoneM = text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
  return {
    customerName: (name || subject || email.fromEmail || 'Unknown enquiry').slice(0, 200),
    contact: name || null,
    phone: phoneM ? phoneM[0] : null,
    email: email.fromEmail ?? null,
    requirement: [subject, text.slice(0, 500)].filter(Boolean).join(' — ') || null,
    source: 'Email',
  };
}

// Below this the model's own confidence that a free-form mail is a real
// enquiry is treated as "not sure" — the mail still waits for a human, only
// with whatever fields could be read. Above NOT_ENQUIRY_MIN the model may say
// "this is a newsletter / notification" and the mail is parked as dismissed
// (recoverable from the inbox).
const AI_MIN_CONFIDENCE = 0.35;
const AI_NOT_ENQUIRY_MIN = 0.8;

type AiRead =
  | { kind: 'draft'; draft: ExtractedLead; confidence: number }
  | { kind: 'not_enquiry'; confidence: number }
  | null;

/**
 * Read a free-form (non-marketplace) email with the model, outside any DB
 * transaction. Best-effort: any failure means "no AI reading" and the
 * deterministic draft is used instead. The model only reads — the enquiry is
 * still created by a person on the review screen.
 */
async function aiRead(tenantId: string, email: InboundEmail, fallback: ExtractedLead): Promise<AiRead> {
  if (!aiEnabled()) return null;
  const text = (email.text && email.text.trim()) ? email.text : (email.html ? email.html.replace(/<[^>]+>/g, ' ') : '');
  if (!text.trim() && !email.subject) return null;
  try {
    const { draft, usage, model } = await extractLeadFromEmail({
      subject: email.subject, fromName: email.fromName, fromEmail: email.fromEmail, text,
    });
    recordAiUsage(tenantId, SYSTEM_USER_ID, 'extract', model, usage);
    if (!draft.isEnquiry && draft.confidence >= AI_NOT_ENQUIRY_MIN) return { kind: 'not_enquiry', confidence: draft.confidence };
    if (draft.confidence < AI_MIN_CONFIDENCE && !draft.phone && !draft.requirement) return null;
    // Prefer what the model read; keep the deterministic fallback for anything it left blank.
    return {
      kind: 'draft', confidence: draft.confidence,
      draft: {
        customerName: (draft.customerName || fallback.customerName).slice(0, 200),
        contact: draft.contact || fallback.contact || null,
        phone: draft.phone || fallback.phone || null,
        email: draft.email || fallback.email || null,
        requirement: (draft.requirement || fallback.requirement || null)?.slice(0, 2000) ?? null,
        source: 'Email',
        valueEstimate: draft.valueEstimate > 0 ? draft.valueEstimate : null,
      },
    };
  } catch (e) {
    console.error('ai lead extraction failed:', e);
    return null;
  }
}

/** Upload each attachment to Supabase Storage (best-effort); returns stored metadata. */
async function storeAttachments(tenantId: string, email: InboundEmail): Promise<StoredAttachment[]> {
  if (!email.attachments?.length) return [];
  const folder = (email.externalId || 'msg').replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'msg';
  const out: StoredAttachment[] = [];
  for (const a of email.attachments.slice(0, 10)) {
    const mimeType = a.mimeType || 'application/octet-stream';
    let bytes: Buffer;
    try { bytes = Buffer.from(a.dataBase64, 'base64'); } catch { continue; }
    try {
      const path = storageConfigured() ? await uploadAttachment(tenantId, folder, a.name, mimeType, bytes) : null;
      out.push({ name: a.name, mimeType, size: a.size ?? bytes.length, path, ...(path ? {} : { error: 'storage not configured' }) });
    } catch (e) {
      out.push({ name: a.name, mimeType, size: a.size ?? bytes.length, path: null, error: (e as Error).message.slice(0, 120) });
    }
  }
  return out;
}

/** Find an existing lead matching this draft by normalized email or phone (last-10). */
async function findDuplicateLead(tx: Tx, draft: ExtractedLead): Promise<string | null> {
  const email = normalizeEmail(draft.email);
  const phone = normalizePhone(draft.phone);
  const conds = [];
  if (email) conds.push(sql`lower(${lead.email}) = ${email}`);
  if (phone) conds.push(sql`right(regexp_replace(coalesce(${lead.phone}, ''), ${'[^0-9]'}, '', 'g'), 10) = ${phone}`);
  if (!conds.length) return null;
  const [row] = await tx.select({ id: lead.id }).from(lead).where(or(...conds)).limit(1);
  return row?.id ?? null;
}

/**
 * Ingest one normalized email for a channel. Idempotent (unique tenant+kind+
 * externalId): a re-delivered message is a no-op. Marketplace-templated mail is
 * auto-created as a lead; everything else lands in the Lead Inbox as `pending`.
 */
export async function ingestEmail(channel: Channel, email: InboundEmail): Promise<IngestOutcome> {
  const tenantId = channel.tenantId;
  // Upload attachments first (outside the DB tx) so no connection is held during network I/O.
  const attachments = await storeAttachments(tenantId, email);
  // Same for the model: decide up front whether this is a marketplace mail
  // (deterministic parser) or bulk mail, and only ask the model about the rest.
  const mkEarly = parseMarketplaceEmail(email);
  const bulkEarly = mkEarly ? null : isBulk(email, channel.config);
  const ai = !mkEarly && bulkEarly && !bulkEarly.bulk ? await aiRead(tenantId, email, bestEffortDraft(email)) : null;
  return withTenant(tenantId, SYSTEM_USER_ID, async (tx) => {
    // 1. idempotent insert
    const inserted = await tx.insert(inboundMessage).values({
      tenantId,
      channelId: channel.id,
      channelKind: channel.kind,
      externalId: email.externalId,
      fromName: email.fromName ?? null,
      fromEmail: email.fromEmail ?? null,
      subject: email.subject ?? null,
      bodyText: email.text ?? null,
      bodyHtml: email.html ?? null,
      rawHeaders: email.headers ?? null,
      receivedAt: email.receivedAt ?? new Date(),
      status: 'pending',
      attachments: attachments.length ? attachments : null,
    }).onConflictDoNothing().returning({ id: inboundMessage.id });

    const inboundId = inserted[0]?.id;
    if (!inboundId) return { status: 'duplicate' }; // already ingested

    try {
      // 2. marketplace template parse (bypasses the spam gate — these ARE leads)
      const mk = mkEarly;
      let draft: ExtractedLead;
      let parseMethod: 'template' | 'ai' | 'none';
      let confidence: string | null = null;
      if (mk) {
        draft = mk.lead;
        parseMethod = 'template';
      } else {
        // 3. non-marketplace → deterministic bulk/newsletter gate
        const bulk = bulkEarly ?? isBulk(email, channel.config);
        if (bulk.bulk) {
          await tx.update(inboundMessage)
            .set({ status: 'spam', dedupeReason: bulk.reason ?? null, updatedAt: new Date() })
            .where(eq(inboundMessage.id, inboundId));
          return { status: 'spam', inboundId };
        }
        // 3b. the model read it and is sure it is not an enquiry → parked, recoverable
        if (ai?.kind === 'not_enquiry') {
          await tx.update(inboundMessage)
            .set({ status: 'ignored', parseMethod: 'ai', confidence: ai.confidence.toFixed(3),
              dedupeReason: 'AI read it as a newsletter, notification or other non-enquiry mail', updatedAt: new Date() })
            .where(eq(inboundMessage.id, inboundId));
          return { status: 'ignored', inboundId };
        }
        if (ai?.kind === 'draft') {
          draft = ai.draft;
          parseMethod = 'ai';
          confidence = ai.confidence.toFixed(3);
        } else {
          draft = bestEffortDraft(email);
          parseMethod = 'none';
        }
      }

      // 4. dedupe vs existing leads
      const dupeLeadId = await findDuplicateLead(tx, draft);
      if (dupeLeadId) {
        await tx.update(inboundMessage).set({
          status: 'duplicate', parsed: draft, parseMethod, confidence, leadId: dupeLeadId,
          dedupeReason: 'matched an existing lead by phone/email', updatedAt: new Date(),
        }).where(eq(inboundMessage.id, inboundId));
        return { status: 'duplicate', inboundId, leadId: dupeLeadId };
      }

      // 5. auto-create only for confident marketplace parses; else hold for review
      const autoCreate = channel.config.autoCreate !== false && parseMethod === 'template';
      if (autoCreate) {
        const created = await createLeadRecord(tx, tenantId, {
          ...draft,
          ownerUserId: channel.config.defaultOwnerUserId ?? null,
          stage: 'new',
          inboundMessageId: inboundId,
        });
        await tx.update(inboundMessage)
          .set({ status: 'converted', parsed: draft, parseMethod, leadId: created.id, updatedAt: new Date() })
          .where(eq(inboundMessage.id, inboundId));
        await tx.insert(auditLog).values({
          tenantId, userId: null, entityType: 'lead', entityId: created.id,
          action: 'create_from_inbound', after: draft as Record<string, unknown>,
        });
        return { status: 'converted', inboundId, leadId: created.id };
      }

      await tx.update(inboundMessage)
        .set({ status: 'pending', parsed: draft, parseMethod, confidence, updatedAt: new Date() })
        .where(eq(inboundMessage.id, inboundId));
      return { status: 'pending', inboundId };
    } catch (e) {
      // JS-level failure (parsing etc.) — keep the message visible as failed.
      try {
        await tx.update(inboundMessage)
          .set({ status: 'failed', error: (e as Error).message.slice(0, 500), updatedAt: new Date() })
          .where(eq(inboundMessage.id, inboundId));
      } catch { /* DB-aborted tx will roll back the insert; provider may retry */ }
      return { status: 'failed', inboundId };
    }
  });
}
