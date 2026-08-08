import 'server-only';
import { adminDb, leadChannel, and, eq, sql } from '@ms/db';
import type { Channel, ChannelConfig } from './types';

// Resolve the tenant/channel for an inbound webhook. There is no tenant context
// yet, so this reads across tenants via the privileged `adminDb` (which bypasses
// RLS by design). Every subsequent write happens inside `withTenant`.

/** Pull the routing token from a capture address `leads+<token>@…` or an explicit field. */
export function extractToken(toAddress?: string | null, explicit?: string | null): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  const m = (toAddress ?? '').match(/\+([A-Za-z0-9]{8,})@/);
  return m && m[1] ? m[1] : null;
}

export async function resolveChannelByToken(token: string): Promise<Channel | null> {
  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error('DATABASE_URL_ADMIN is required to resolve inbound lead channels');
  }
  const [row] = await adminDb
    .select()
    .from(leadChannel)
    .where(and(sql`${leadChannel.config} ->> 'inboundToken' = ${token}`, eq(leadChannel.enabled, true)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    config: (row.config ?? {}) as ChannelConfig,
  };
}
