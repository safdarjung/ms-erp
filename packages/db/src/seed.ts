import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, expandPermissions } from '@ms/core';
import * as s from './schema';
import { ADMIN_DB_URL } from './env';

type DB = PostgresJsDatabase<typeof s>;

// Company letterhead — drives the custom-template PDF (matches the real M.S.
// Enterprises bill). Stored in tenant.settings so it's config, not code.
const LETTERHEAD = {
  name: 'M.S. ENTERPRISES',
  factory: 'FACTORY: 5B-Sanjay Memorial Indl. Estate Phase-1, Near YMCA Chowk, N.I.T. FARIDABAD',
  office: 'OFFICE ADDRESS: NH 1C/69 NIT Faridabad',
  gstin: '06AKQPM8903J1ZN',
  stateCode: '06',
  bank: { name: 'PUNJAB NATIONAL BANK', acNo: '0483050019340', ifsc: 'PUNB0048320' },
  defaultTerms: [
    'Delivery time 10 working days.',
    '50% advance',
    '25% against delivery',
    '25% after trail.',
    'GST extra',
    'Plating and Polishing charges extra',
  ],
};

const DEMO_CUSTOMERS = [
  { code: 'CUST-001', name: 'Sharma Auto Components', regType: 'registered', gstin: '06AAAAA0000A1Z5', stateCode: '06', address: 'Sector 24, Faridabad, Haryana- 121005', contactPerson: 'R. Sharma', phone: '9812345678', creditTermsDays: 30 },
  { code: 'CUST-010', name: 'M/S Chatterji Rubber Mfg. Co.', regType: 'registered', gstin: '19AADFC2983M1ZZ', stateCode: '19', address: '129A, J. K. Paul Road, Kolkata- 700038', contactPerson: 'Chatterji', phone: '9830000000', creditTermsDays: 15 },
];

export async function seed(db: DB): Promise<void> {
  // 1. permission catalog
  await db.insert(s.permission).values(PERMISSIONS.map((key) => ({ key }))).onConflictDoNothing();

  // 2. tenant (+ always refresh settings/letterhead)
  let tenantId: string;
  const settings = { locale: 'en', defaultGstRate: 18, stateCode: '06', letterhead: LETTERHEAD };
  const [existing] = await db.select().from(s.tenant).where(eq(s.tenant.subdomain, 'msenterprises')).limit(1);
  if (existing) {
    tenantId = existing.id;
    await db.update(s.tenant).set({ settings }).where(eq(s.tenant.id, tenantId));
  } else {
    const ins = await db.insert(s.tenant).values({
      name: 'MS Enterprises', legalName: 'MS Enterprises', subdomain: 'msenterprises', settings,
    }).returning({ id: s.tenant.id });
    tenantId = ins[0]!.id;
  }

  // 3. roles + SYNC each role's permissions to current ROLE_PERMISSIONS (every run)
  const roleIds: Record<string, string> = {};
  for (const rn of ROLES) {
    let [r] = await db.select({ id: s.role.id }).from(s.role)
      .where(and(eq(s.role.tenantId, tenantId), eq(s.role.name, rn))).limit(1);
    if (!r) {
      const ins = await db.insert(s.role).values({ tenantId, name: rn, isSystem: true }).returning({ id: s.role.id });
      r = ins[0]!;
    }
    roleIds[rn] = r.id;
    await db.delete(s.rolePermission)
      .where(and(eq(s.rolePermission.tenantId, tenantId), eq(s.rolePermission.roleId, r.id)));
    const perms = expandPermissions(ROLE_PERMISSIONS[rn]);
    if (perms.length) {
      await db.insert(s.rolePermission).values(perms.map((permissionKey) => ({ tenantId, roleId: r!.id, permissionKey })));
    }
  }

  // 4. demo customers (idempotent upsert by code — gives us a Haryana + a West-Bengal buyer)
  for (const c of DEMO_CUSTOMERS) {
    const [ex] = await db.select({ id: s.customer.id }).from(s.customer)
      .where(and(eq(s.customer.tenantId, tenantId), eq(s.customer.code, c.code))).limit(1);
    if (ex) await db.update(s.customer).set(c).where(eq(s.customer.id, ex.id));
    else await db.insert(s.customer).values({ tenantId, ...c });
  }

  // 5. users + leads (first run only)
  const [ownerExists] = await db.select({ id: s.users.id }).from(s.users)
    .where(eq(s.users.email, 'owner@msenterprises.test')).limit(1);
  if (ownerExists) {
    console.log('  seed: users present; roles/permissions/letterhead/customers synced');
    return;
  }

  await db.insert(s.branch).values({
    tenantId, name: 'Faridabad (Head Office)', gstin: '06AKQPM8903J1ZN', stateCode: '06',
    address: '5B, Sanjay Memorial Indl. Estate Phase-1, near YMCA Chowk, NIT Faridabad, Haryana', isDefault: true,
  });

  const passwordHash = await bcrypt.hash('password123', 10);
  const ownerIns = await db.insert(s.users).values({
    tenantId, name: 'Owner (MS Enterprises)', email: 'owner@msenterprises.test', passwordHash,
  }).returning({ id: s.users.id });
  await db.insert(s.userRole).values({ tenantId, userId: ownerIns[0]!.id, roleId: roleIds['owner']! });

  const salesIns = await db.insert(s.users).values({
    tenantId, name: 'Sales Staff', email: 'sales@msenterprises.test', passwordHash,
  }).returning({ id: s.users.id });
  const salesUserId = salesIns[0]!.id;
  await db.insert(s.userRole).values({ tenantId, userId: salesUserId, roleId: roleIds['sales']! });

  await db.insert(s.lead).values([
    { tenantId, source: 'IndiaMART', customerName: 'Verma Dies', contact: 'S. Verma', phone: '9811111111', requirement: 'Progressive press tool + 5000 running parts', stage: 'negotiation', ownerUserId: salesUserId, valueEstimate: '420000' },
    { tenantId, source: 'Referral', customerName: 'NCR Sheet Metal', contact: 'A. Khan', phone: '9822222222', requirement: 'VMC job-work, brackets', stage: 'new', ownerUserId: salesUserId, valueEstimate: '80000' },
    { tenantId, source: 'WhatsApp', customerName: 'Faridabad Forgings', contact: 'P. Yadav', phone: '9833333333', requirement: 'Forging die refurbishment', stage: 'contacted', ownerUserId: salesUserId, valueEstimate: '150000' },
  ]);

  console.log(`  seed: tenant ${tenantId} ready — login owner@msenterprises.test / password123`);
}

if (process.argv[1]?.endsWith('seed.ts')) {
  const admin = postgres(ADMIN_DB_URL || 'postgresql://postgres:postgres@localhost:5433/mserp', { max: 1 });
  const db = drizzle(admin, { schema: s });
  seed(db).then(() => admin.end()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
