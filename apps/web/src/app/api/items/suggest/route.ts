import type { Permission } from '@ms/core';
import { withTenant } from '@ms/db';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { suggestItems } from '@/lib/price-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Type an item, get its last price" — the line editor's autocomplete. Anyone
// who can write a quotation, order or bill may see what the shop charged before.
const CAN_SUGGEST: readonly Permission[] = ['quotation.create', 'order.create', 'invoice.create'];
const MIN_CHARS = 2;
const MAX_CHARS = 80;
const LIMIT = 8;
const NO_STORE = { 'cache-control': 'no-store' } as const;

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Your session has ended — please log in again.' }, 401);
  if (!CAN_SUGGEST.some((p) => can(user, p))) {
    return json({ error: 'Your login doesn’t include making documents — ask the owner.' }, 403);
  }

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, MAX_CHARS);
  if (q.length < MIN_CHARS) return json({ items: [] });

  try {
    const items = await withTenant(user.tenantId, user.userId, (tx) => suggestItems(tx, q, LIMIT));
    return json({ items });
  } catch (e) {
    console.error('items/suggest error:', e);
    return json({ error: 'Couldn’t look up past items right now.' }, 500);
  }
}
