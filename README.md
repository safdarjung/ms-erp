# MS Enterprises ERP

AI-native ERP for a precision **die & machining job-shop**. Multi-tenant (Postgres RLS), TypeScript end-to-end.

> **Design docs:** see [`docs/`](./docs) (`00`–`06`) and the published blueprint. This is the Phase-1 implementation.

## Stack
Next.js 15 · TypeScript · PostgreSQL + Row-Level Security · Drizzle ORM · MinIO · Redis · Claude (AI) · Docker Compose.

## Quick start
```bash
pnpm install            # install workspace deps
pnpm infra:up           # start Postgres + Redis + MinIO (Docker)
pnpm db:setup           # create app role + RLS, run migrations, seed a demo tenant
pnpm dev                # run the web app → http://localhost:3000
```

Demo login (seeded): **owner@msenterprises.test** / **password123**

## Layout
```
apps/web         Next.js app (UI + server actions)
packages/db      Drizzle schema, migrations, RLS, tenant client, seed
packages/core    shared types, zod, enums, utils
docs/            product & technical blueprint (00–06)
```

## Multi-tenancy
Every business row carries `tenant_id`; Postgres **RLS** enforces isolation. The app connects as a non-superuser (`app_user`) and every request runs inside a transaction that sets `app.current_tenant` — a query physically cannot read another tenant's data.
