import { createHmac, timingSafeEqual } from 'node:crypto';

// Pure token maths for public share links (no framework imports, so node's
// test runner can load it directly). See lib/share.ts for the app-facing API.

export type ShareKind = 'quotation' | 'invoice';

/** URL path segment per kind — short, because these ride inside WhatsApp messages. */
export const KIND_SEG: Record<ShareKind, string> = { quotation: 'q', invoice: 'b' };
export const SEG_KIND: Record<string, ShareKind> = { q: 'quotation', b: 'invoice' };

export const SHARE_TTL_DAYS = 60;
const SIG_BYTES = 16;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64u = (b: Buffer) => b.toString('base64url');
const uuidBytes = (uuid: string) => Buffer.from(uuid.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Derive the signing key from the app secret (never the raw secret itself). */
export function shareKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('share-links').digest();
}

function sign(key: Buffer, kind: ShareKind, id: string, tenantId: string, exp: number): Buffer {
  return createHmac('sha256', key).update(`${kind}:${id}:${tenantId}:${exp}`).digest().subarray(0, SIG_BYTES);
}

/** Token = base64url(tenant 16 bytes ‖ expiry 4 bytes ‖ signature 16 bytes). */
export function makeShareToken(key: Buffer, kind: ShareKind, id: string, tenantId: string, expSeconds: number): string {
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(expSeconds);
  return b64u(Buffer.concat([uuidBytes(tenantId), expBuf, sign(key, kind, id.toLowerCase(), tenantId, expSeconds)]));
}

export type VerifiedShare = { kind: ShareKind; id: string; tenantId: string; expiresAt: Date };

/** Verify a share link's parts. Returns null for anything tampered, malformed or expired. */
export function verifyShareToken(key: Buffer, seg: string, id: string, token: string, nowMs = Date.now()): VerifiedShare | null {
  const kind = SEG_KIND[seg];
  if (!kind || !UUID_RE.test(id)) return null;
  let raw: Buffer;
  try { raw = Buffer.from(token, 'base64url'); } catch { return null; }
  if (raw.length !== 16 + 4 + SIG_BYTES) return null;
  const tenantId = bytesUuid(raw.subarray(0, 16));
  const exp = raw.readUInt32BE(16);
  const given = raw.subarray(20);
  const expected = sign(key, kind, id.toLowerCase(), tenantId, exp);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (exp * 1000 < nowMs) return null;
  return { kind, id: id.toLowerCase(), tenantId, expiresAt: new Date(exp * 1000) };
}
