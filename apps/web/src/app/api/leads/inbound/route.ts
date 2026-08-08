import { timingSafeEqual } from 'node:crypto';
import { normalizeInbound } from '@/lib/ingest/providers';
import { extractToken, resolveChannelByToken } from '@/lib/ingest/channels';
import { ingestEmail } from '@/lib/ingest/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Inbound-email webhook. A mail-forwarding provider (Cloudflare Email Worker /
// Postmark inbound / a generic poster) parses a forwarded enquiry and POSTs it
// here. We authenticate with a shared secret, resolve the tenant from the
// capture-address token, and hand the message to the ingestion pipeline.
//
//   POST /api/leads/inbound?provider=postmark            (secret via x-webhook-secret)
//   POST /api/leads/inbound?provider=generic&t=<token>   (token override for testing)

function secretOk(req: Request): boolean {
  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (!expected) return false; // unconfigured = closed
  const url = new URL(req.url);
  const provided = req.headers.get('x-webhook-secret') ?? url.searchParams.get('key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!secretOk(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') ?? 'generic';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const email = normalizeInbound(provider, body);
    const token = extractToken(
      email.toAddress,
      (body as { token?: string })?.token ?? url.searchParams.get('t'),
    );
    if (!token) return Response.json({ ok: true, ignored: 'no routing token' });

    const channel = await resolveChannelByToken(token);
    if (!channel) return Response.json({ ok: true, ignored: 'unknown channel' });

    const outcome = await ingestEmail(channel, email);
    return Response.json({ ok: true, ...outcome });
  } catch (e) {
    console.error('inbound ingest failed:', e);
    return Response.json({ error: 'Ingest failed' }, { status: 500 });
  }
}
