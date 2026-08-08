// Shared shapes for the inbound lead-capture pipeline. Kept free of `server-only`
// so route handlers, the pipeline and (later) tests can all import the types.

/** An attachment as it arrives in the webhook payload (base64 content). */
export type IncomingAttachment = {
  name: string;
  mimeType?: string | null;
  size?: number | null;
  /** base64-encoded file content. */
  dataBase64: string;
};

/** An attachment after it's been stored in Supabase Storage. */
export type StoredAttachment = {
  name: string;
  mimeType: string;
  size: number;
  /** Object path within the bucket, e.g. `<tenantId>/<inboundId>/<file>`; null if storage was unavailable. */
  path: string | null;
  error?: string;
};

/** A normalized inbound email, provider-agnostic (see providers.ts). */
export type InboundEmail = {
  /** Idempotency key — the RFC Message-ID (or a hash fallback). */
  externalId: string;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  receivedAt?: Date;
  /** The capture address the mail was delivered to (carries the tenant token). */
  toAddress?: string | null;
  /** Provider-supplied spam score, if any (higher = spammier). */
  spamScore?: number | null;
  /** File attachments (base64) to be stored on ingest. */
  attachments?: IncomingAttachment[];
};

/** Fields extracted from a message, ready to become a `lead`. */
export type ExtractedLead = {
  customerName: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  requirement?: string | null;
  source: string; // 'IndiaMART' | 'TradeIndia' | 'Email'
  valueEstimate?: number | null;
};

/** Per-tenant channel config stored in `lead_channel.config` (jsonb). */
export type ChannelConfig = {
  /** Random token embedded in the capture address (leads+<token>@…) → routes to this tenant. */
  inboundToken?: string;
  /** Lead owner assigned to auto-created leads (a real sales user), else unassigned. */
  defaultOwnerUserId?: string | null;
  /** Only accept mail whose sender matches one of these (domain or address). Empty = accept all. */
  senderAllowlist?: string[];
  /** Auto-create a lead from a confidently-parsed marketplace email (default true). */
  autoCreate?: boolean;
};

/** A resolved lead_channel row (config typed). */
export type Channel = {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: ChannelConfig;
};

export type IngestOutcome = {
  status: 'converted' | 'pending' | 'duplicate' | 'spam' | 'ignored' | 'failed';
  inboundId?: string;
  leadId?: string;
};
