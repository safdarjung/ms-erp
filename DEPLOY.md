# Deploying MS Enterprises ERP to Vercel

Vercel hosts the **Next.js app**; it does **not** host a database. Pair it with a
managed Postgres — **Neon** or **Supabase** both fit (same engine, pooled
connections, generous free tiers). Steps below use Neon; the Supabase variant is
at the end. Phase‑1 does **not** use Redis or MinIO, so nothing else is required yet.

> **Prod prep already done in the code:** `apps/web` build/start use plain `next`
> (env comes from Vercel, not a `.env` file); `packages/db` uses serverless‑safe
> Postgres pooling (`prepare:false`, small pool); `db:setup` tolerates managed
> Postgres that don't allow creating custom roles; long-running AI routes set
> `maxDuration = 60`.
>
> **This repo today:** the active database is already **Supabase (Mumbai)** with
> schema + RLS + seed applied — skip the database-creation/init steps and go
> straight to §3 (push) → §4 (import), using the Supabase URLs from your `.env`.

---

## 1 · Create a Postgres database (Neon)

1. Sign up at **neon.tech** → **New Project** (pick a region near India, e.g. Singapore).
2. From **Dashboard → Connection Details**, copy **two** URLs:
   - **Pooled** — host contains `-pooler` → used by the app at runtime.
   - **Direct** — no `-pooler` → used to run migrations.
   Both look like: `postgresql://<owner>:<pw>@<host>/<db>?sslmode=require`

## 2 · Initialise the database (run **once**, from your machine)

From the project root, point the **direct** URL at setup:

```bash
DATABASE_URL="<DIRECT url>" DATABASE_URL_ADMIN="<DIRECT url>" pnpm --filter @ms/db run setup
```

(The explicit `run` matters — bare `pnpm --filter X setup` collides with a pnpm builtin.)

This creates the tables + RLS policies and seeds the demo tenant
(`owner@msenterprises.test` / `password123`). It's idempotent — safe to re‑run,
and re‑run it after any future schema change (`pnpm --filter @ms/db generate` first).

## 3 · Push the code to GitHub

```bash
git init && git add -A && git commit -m "MS Enterprises ERP — Phase 1"
# create an empty repo at github.com/<you>/ms-erp, then:
git remote add origin https://github.com/<you>/ms-erp.git
git branch -M main && git push -u origin main
```

`.env` is git‑ignored, so your local secrets are **not** committed.

## 4 · Import into Vercel

1. **vercel.com → Add New → Project** → import your GitHub repo.
2. **Root Directory:** set to **`apps/web`**. (Vercel installs the pnpm workspace from the repo root automatically.)
3. **Framework Preset:** Next.js (auto‑detected). Leave Build/Install commands at their defaults.
4. **Environment Variables** — add for **Production** (and Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Neon **pooled** URL (ending `?sslmode=require`) |
   | `DATABASE_URL_ADMIN` | the **same pooled** URL |
   | `SESSION_SECRET` | a long random string — `openssl rand -hex 32` |
   | `GEMINI_API_KEY` | key from aistudio.google.com — enables the AI agent (assistant + actions), quotation drafting & terms polish |
   | `ANTHROPIC_API_KEY` | *(alternative/additional)* key from console.anthropic.com — if both are set, Claude wins unless `AI_PROVIDER=gemini` |

   Both AI keys blank = AI off; everything else works normally.

5. **Deploy.** Open the Vercel URL → log in with **owner@msenterprises.test / password123**.

Every future `git push` to `main` auto‑deploys.

---

## Notes

- **Single tenant now → simplest DB setup:** while MS Enterprises is the only
  tenant, running the app on the Neon **owner** role (both env vars above) is fine.
  When you onboard a **second factory**, switch `DATABASE_URL` to the least‑privilege
  `app_user` role (setup already provisions it) so Postgres **RLS** hard‑enforces
  isolation; keep `DATABASE_URL_ADMIN` on the owner role (used only for login/session lookup).
- **Migrations use the DIRECT url; the app uses the POOLED url.** Poolers run in
  transaction mode, which is great for the app but can break DDL — so always run
  `pnpm --filter @ms/db setup` against the **direct** connection.
- **Redis / MinIO** come in Phase 2 (job queue + file/drawing storage). Then use
  **Upstash Redis** and **Cloudflare R2** (or S3) — both work with Vercel.
- **No‑GitHub alternative:** `npm i -g vercel && vercel` from the repo root; set the
  Root Directory to `apps/web` when prompted and add the same env vars.
- **Custom domain:** add it under Vercel → Project → Domains once deployed.

---

## Variant · Supabase instead of Neon (free tier)

Supabase's free Postgres works the same way — the app code needs **no changes**
(`packages/db` already uses `prepare:false`, which its transaction pooler requires).

1. **supabase.com → New project** (region near India, e.g. Mumbai/Singapore). Note the DB password.
2. **Get both connection strings** — Dashboard → **Connect**:
   - **Transaction pooler** (port **6543**) → runtime `DATABASE_URL`
   - **Session pooler / Direct** (port **5432**) → used for migrations
   Append `?sslmode=require` to both.
3. **Initialise once** from your machine using the **5432** URL:
   ```bash
   DATABASE_URL="<5432 url>" DATABASE_URL_ADMIN="<5432 url>" pnpm --filter @ms/db run setup
   ```
   Supabase may not allow creating the `app_user` role — setup warns and continues;
   single-tenant operation on the provided `postgres` role is fine (see the Neon
   note above; the app's own RLS-by-GUC still applies once you move to `app_user`).
4. **Vercel env vars:** set **both** `DATABASE_URL` and `DATABASE_URL_ADMIN` to the
   **6543 transaction-pooler** URL (best for serverless; the 5432 session URL is only
   needed when running setup/migrations), plus `SESSION_SECRET` / `ANTHROPIC_API_KEY` as above.
5. Re-run step 3 against the 5432 URL after any future schema change.

> Don't confuse Supabase's built-in "Row Level Security" auth product with this
> app's RLS — the ERP ships its **own** policies keyed on `app.current_tenant`,
> applied by `pnpm --filter @ms/db setup`. No Supabase Auth setup is needed.
