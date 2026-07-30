import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import { ADMIN_DB_URL } from './env';
import { seed } from './seed';

// Tenant-scoped tables (policy on tenant_id). `tenant` itself is scoped on `id`.
// `permission` is a global catalog (no RLS).
const TENANT_TABLES = [
  'branch', 'users', 'role', 'role_permission', 'user_role',
  'session', 'audit_log', 'customer', 'lead', 'lead_activity',
  'doc_sequence', 'quotation', 'quotation_item', 'sales_order',
  'order_item', 'tax_invoice', 'tax_invoice_item',
];

async function main() {
  if (!ADMIN_DB_URL) throw new Error('DATABASE_URL_ADMIN is required for setup');
  const admin = postgres(ADMIN_DB_URL, { max: 1 });
  const db = drizzle(admin, { schema });

  console.log('→ ensure app_user role');
  try {
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;`);
  } catch (e) {
    console.warn('  (could not create app_user role — continuing; the app can run on the admin role for a single tenant):', (e as Error).message);
  }

  console.log('→ run migrations');
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
  await migrate(db, { migrationsFolder });

  console.log('→ grants + row-level security');
  try {
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO app_user;`);
    await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`);
    await admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;`);
    await admin.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;`);
  } catch (e) {
    console.warn('  (skipped app_user grants — role not present):', (e as Error).message);
  }

  await admin.unsafe(`ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;`);
  await admin.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON tenant;`);
  await admin.unsafe(`CREATE POLICY tenant_isolation ON tenant
    USING (id = current_setting('app.current_tenant', true)::uuid);`);

  for (const t of TENANT_TABLES) {
    await admin.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    await admin.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
    await admin.unsafe(`CREATE POLICY tenant_isolation ON ${t}
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);`);
  }

  console.log('→ seed demo data');
  await seed(db);

  await admin.end();
  console.log('✔ setup complete — RLS enforced for app_user');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
