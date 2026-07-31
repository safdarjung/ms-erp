import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { APP_DB_URL, ADMIN_DB_URL } from './env';

// Serverless-friendly Postgres options. `prepare:false` is required for
// transaction-pooled managed Postgres (Neon/Supabase poolers); small pools
// suit Vercel's per-invocation functions. SSL is driven by `?sslmode=require`
// on the connection string. postgres.js connects lazily, so construction is safe.
const serverless = !!process.env.VERCEL;
const pgOpts = {
  max: Number(process.env.PG_POOL_MAX ?? (serverless ? 1 : 10)),
  idle_timeout: 20,
  connect_timeout: 15,
  prepare: false,
} as const;

// App connection — least-privilege `app_user` role, RLS enforced.
const appClient = postgres(APP_DB_URL, pgOpts);
export const appDb: PostgresJsDatabase<typeof schema> = drizzle(appClient, { schema });

// Privileged connection — used ONLY for auth resolution (login + session lookup),
// migrations and seeding. Business data always goes through `withTenant` below.
// TODO(prod): replace the auth path with a dedicated least-privilege auth role
// or subdomain-scoped login so the app never holds superuser credentials.
const adminClient = ADMIN_DB_URL ? postgres(ADMIN_DB_URL, { ...pgOpts, max: Math.min(pgOpts.max, 3) }) : appClient;
export const adminDb: PostgresJsDatabase<typeof schema> = drizzle(adminClient, { schema });

export type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/**
 * Run `fn` inside a tenant-scoped transaction. Sets the `app.current_tenant`
 * GUC so Postgres RLS restricts every query in `fn` to this tenant — a query
 * physically cannot read or write another tenant's rows.
 */
export async function withTenant<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Same as `withTenant`, but the transaction is opened `READ ONLY` — Postgres
 * rejects any write regardless of what SQL runs inside. Used for AI analytics
 * queries as defense-in-depth on top of the SQL guard.
 */
export async function withTenantReadOnly<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
      await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
      return fn(tx);
    },
    { accessMode: 'read only' },
  );
}
