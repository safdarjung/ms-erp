import 'server-only';
import {
  KIND_SEG, SHARE_TTL_DAYS, makeShareToken, shareKey, verifyShareToken, type ShareKind, type VerifiedShare,
} from './share-token';

// Public, login-free links to a quotation / bill PDF — so a customer opening a
// WhatsApp or email link sees the document without an account. A link is a
// signed token (HMAC over kind + record id + tenant + expiry) so it can't be
// guessed or altered, and it expires. Nothing is stored; revoking = rotating
// SESSION_SECRET. Only the document's rendered PDF is exposed, never the app.

export type { ShareKind, VerifiedShare };
export { SHARE_TTL_DAYS };

let _key: Buffer | null = null;
function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  _key ??= shareKey(s);
  return _key;
}

export function shareToken(kind: ShareKind, id: string, tenantId: string, ttlDays = SHARE_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  return makeShareToken(key(), kind, id, tenantId, exp);
}

/** Relative share path, e.g. `/s/q/<uuid>/<token>`. */
export function sharePath(kind: ShareKind, id: string, tenantId: string): string {
  return `/s/${KIND_SEG[kind]}/${id}/${shareToken(kind, id, tenantId)}`;
}

/** Absolute share URL for messages. */
export function shareUrl(baseUrl: string, kind: ShareKind, id: string, tenantId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${sharePath(kind, id, tenantId)}`;
}

/** Verify a share link's parts. Returns null for anything tampered, malformed or expired. */
export function verifyShare(seg: string, id: string, token: string): VerifiedShare | null {
  return verifyShareToken(key(), seg, id, token);
}

/**
 * The app's public origin for absolute links: APP_URL when configured, else
 * the production Vercel host, else what the request came in on.
 */
export function appBaseUrl(req?: Request): string {
  const env = process.env.APP_URL?.trim();
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  if (req) {
    const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}
