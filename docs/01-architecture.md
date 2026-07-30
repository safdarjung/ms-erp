# 01 · Architecture & Multi-tenancy

This is the technical foundation. Everything else (data model, modules, AI) sits on top of what's decided here.

---

## 1. Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (end to end) | One language, shared types client↔server |
| Web app | **Next.js 15** (App Router, React 19, Server Actions) | SSR, fast forms, one deployable |
| UI | **Tailwind CSS + shadcn/ui + TanStack Table/Query** | Fast to build, accessible, dense data grids |
| ORM / DB | **Drizzle ORM + PostgreSQL 16** | SQL-first, first-class **RLS**, great TS types, clean migrations |
| Auth | **Auth.js (NextAuth v5)** — DB sessions, Argon2 passwords | Standard, flexible, self-hosted |
| Files | **MinIO** (S3-compatible), presigned uploads | Self-hosted drawings/PDFs (PDF/DWG/STEP/images) |
| Realtime | **Socket.IO** service + Redis adapter | Chat, live machine/job status, notifications |
| Jobs/queue | **BullMQ + Redis** | PDF render, e-invoice calls, notifications, AI batch, report precompute |
| PDF | **Playwright (headless Chromium)** + HTML templates | Pixel-perfect **custom templates** for GST docs |
| AI | **Claude API (Anthropic)** via an internal AI gateway | NL analytics, smart quoting, doc drafting |
| Validation | **Zod** (shared schemas) | Runtime + compile-time safety |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | |
| Packaging | **pnpm + Turborepo** monorepo | Shared packages, fast builds |
| Deploy | **Docker Compose** (self-host) → k8s later | Matches "self-hosted Postgres" decision |

> **ORM note:** I recommend **Drizzle** specifically because our tenant isolation leans on Postgres **Row-Level Security**, and Drizzle makes it trivial to run each request inside a transaction that sets the tenant context and to define RLS policies in-repo. **Prisma** is a fine alternative if the team prefers its DX — say the word and I'll switch; the data model in `02` is ORM-agnostic.

## 2. Monorepo layout

```
ms-erp/
├─ apps/
│  ├─ web/                 # Next.js app (UI + server actions + API routes)
│  ├─ realtime/            # Socket.IO service (chat, presence, live status)
│  └─ worker/              # BullMQ workers (PDF, e-invoice, notifications, AI jobs)
├─ packages/
│  ├─ db/                  # Drizzle schema, migrations, seed, RLS policies, tenant client
│  ├─ auth/                # Auth.js config, RBAC (permissions, authorize())
│  ├─ ai/                  # Claude gateway, prompts, text-to-SQL, tools, guardrails
│  ├─ pdf/                 # HTML templates + Playwright renderer, template registry
│  ├─ gst/                 # HSN/SAC, tax calc, e-invoice/e-way-bill payloads, numbering
│  ├─ ui/                  # shadcn components, design system, bilingual (i18n)
│  ├─ core/                # domain types, Zod schemas, money/date utils, enums
│  └─ config/              # eslint/tsconfig/tailwind presets, env schema
└─ infra/                  # docker-compose, Dockerfiles, migrations runner, backups
```

## 3. Multi-tenancy — the most important decision

**Model: shared database, shared schema, `tenant_id` on every business row, enforced by PostgreSQL Row-Level Security (RLS).** MS Enterprises is the only live tenant now, but isolation is real from day one.

### 3.1 Tenant context per request
1. User authenticates → session carries `user.id` + `user.tenant_id` + roles.
2. Every DB interaction runs inside a transaction that first sets a Postgres session var:
   ```sql
   SET LOCAL app.current_tenant = '<tenant-uuid>';
   SET LOCAL app.current_user   = '<user-uuid>';
   ```
3. The app connects as DB role **`app_user`** — a *non-superuser* with **no `BYPASSRLS`**. So even a buggy query physically cannot read another tenant's rows.

### 3.2 RLS policy (applied to every tenant-scoped table)
```sql
ALTER TABLE sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sales_order
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
```
A Drizzle helper `withTenant(tenantId, fn)` opens the transaction, sets the GUCs, runs `fn`, commits. All repository calls go through it — there is no "raw" client path in app code.

### 3.3 Platform (super-admin) access
- Cross-tenant admin uses a **separate, explicit path** (`/platform`) with a super-admin DB role and *deliberate* tenant selection — never an ambient bypass. Super-admin actions are audit-logged with the acting tenant.

### 3.4 Tenant routing
- v1: tenant is derived from the **authenticated user** (each user belongs to one tenant).
- Later (SaaS): optional **subdomain** (`msenterprises.oururl.com`) or path (`/t/msenterprises`) with a tenant resolver middleware. No schema change needed.

### 3.5 Per-tenant configuration
A `tenant_settings` store (branding/logo, GSTINs, document templates, numbering formats, financial-year start, enabled modules/feature-flags, locale). Everything visual or legal that differs between factories lives here — not in code.

## 4. Auth & RBAC

- **Authentication:** Auth.js v5, email+password (Argon2id), Postgres-backed sessions; short-lived JWT minted for the realtime service. MFA (TOTP) is a later toggle.
- **Authorization (RBAC):** permissions are `resource.action` strings (e.g., `quotation.approve`, `invoice.create`, `payroll.view`). Roles bundle permissions; a user has one or more roles **within their tenant**. Roles/permissions are data → tenants can customize.
- **Two enforcement layers (defense in depth):**
  1. **RLS** guarantees you only ever *see* your tenant's rows.
  2. **`authorize(user, 'invoice.create')`** gates *actions/features*, called at the top of every server action + API route, and used to hide UI.
- **Field/record-level rules** (e.g., operator sees only assigned jobs) are expressed as additional RLS predicates or query scopes.

## 5. Data layer conventions

- **Every business table** has: `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `created_by`, `updated_by`, soft-delete `deleted_at` where useful.
- **Money:** `numeric(14,2)` for amounts; tax computed per line then rounded per-invoice per GST rules (see `packages/gst`). Never floats.
- **Enums** as Postgres enums or lookup tables (status flows) — documented in `02-data-model.md`.
- **Document numbering:** a `doc_sequence` table keyed by (tenant, doc_type, financial_year) issues gap-free, formatted numbers (`INV/25-26/0001`) transactionally — legally required for GST invoices.
- **Migrations:** Drizzle Kit, versioned in `packages/db/migrations`, run by the `infra` migrator on deploy. RLS policies live in migrations too.
- **Audit:** an `audit_log` table (tenant, user, entity, action, before/after JSON, ip, ts) written via a repository wrapper for sensitive entities.

## 6. File & drawing storage

- **MinIO** (S3 API); objects keyed `tenant/<id>/<entity>/<uuid>-<filename>`.
- **Presigned** PUT/GET so bytes never route through the app server.
- Handles **die drawings & CAD** (PDF, DWG, DXF, STEP/STP, IGES, images) with **versioning** (each upload = new version, old kept) and thumbnails where renderable.
- Access is checked (RBAC + tenant) before a presigned URL is issued; URLs are short-lived. Optional AV scan hook (ClamAV) on upload.

## 7. Realtime service

- Standalone **Socket.IO** app (`apps/realtime`), authenticated by the JWT from the web session, **Redis adapter** for horizontal scale.
- Channels (all tenant-scoped): `chat:<room>`, `machine:<id>` (live status), `job:<id>` (operation progress), `notify:<user>` (toasts/alerts), `presence`.
- Web app publishes domain events (order status change, machine start/stop, new message) → realtime service fans out. Falls back to polling if sockets unavailable.

## 8. Background jobs

**BullMQ + Redis** queues, run by `apps/worker`:
- `pdf` — render quotation/proforma/invoice/challan documents.
- `einvoice` / `eway` — call GSP/IRP APIs, store IRN/QR, handle retries.
- `notify` — email/WhatsApp/in-app notifications, reminders (quote follow-up, payment due).
- `ai` — batch/long AI tasks (report generation, embeddings, summaries).
- `reports` — nightly precompute of heavy dashboards/analytics rollups.
- `import` — bulk data import (migration, biometric attendance files).
All jobs are tenant-tagged, idempotent, retried with backoff, and observable.

## 9. PDF & the custom-template engine  ⭐ (a headline feature)

The requirement: **quotation, proforma invoice, and GST bill generated from *custom templates*** that match MS Enterprises' letterhead/format.

Design:
- A **template registry**: each document type (`quotation`, `proforma`, `tax_invoice`, `delivery_challan`, `job_challan`) has one or more templates. Templates are **HTML + a safe templating layer** (Handlebars-style) with a **typed data contract** (the invoice/quote JSON), rendered to PDF by **Playwright**.
- **Per-tenant overrides** stored in `tenant_settings` / a `document_template` table → MS Enterprises gets *their* exact layout, logo, terms, fonts, signature block, without touching code.
- A **template gallery** of clean defaults ships in-box; tenants pick + tweak (header/footer, colors, columns shown, terms text, bank details, T&C).
- The **legal/number fields are deterministic** (computed in `packages/gst`); the template only *presents* them. AI may *draft* free-text bits (terms, cover notes) — see `05-ai-integration.md` — but never the tax math.
- Output stored in MinIO, versioned, attached to the source record, and shareable via signed link / WhatsApp / email.

## 10. AI infrastructure (overview — details in `05`)

- All model calls go through an internal **AI gateway** (`packages/ai`): centralizes the Claude client, prompt templates + versions, structured-output (tool-use) schemas, **per-tenant cost metering & rate limits**, redaction of secrets, and logging of prompts/responses for audit.
- **NL analytics** uses a **guarded text-to-SQL / tool-calling** approach: the model can only call a read-only, **tenant-scoped** query interface over an allow-listed set of views — it never runs arbitrary SQL against raw tables, and RLS still applies. (Full guardrails in `05`.)
- Model selection, prompt-caching, and pricing are pinned in `05-ai-integration.md`.

## 11. API & server-action design

- Prefer **Server Actions** for mutations from the app; **Route Handlers** (`/api/*`) for webhooks (IRP, payment, biometric), integrations, and the AI/analytics endpoints.
- Every entry point: `authenticate → authorize → validate (Zod) → withTenant(tx) → domain service → audit`.
- Consistent error envelope; mutation **idempotency keys** for money/document actions; optimistic UI via TanStack Query.

## 12. Security

- RLS + `FORCE ROW LEVEL SECURITY`; app connects as least-privilege role.
- Argon2id passwords; signed, httpOnly session cookies; CSRF protection on actions.
- Secrets via env (validated by a Zod env schema); no secrets in the repo.
- Encryption in transit (TLS) and at rest (disk/MinIO SSE); PII columns encryptable.
- Rate limiting on auth + AI endpoints; audit log for sensitive actions; per-tenant data export & delete (SaaS hygiene).
- **Backups:** nightly `pg_dump` + WAL archiving; MinIO bucket replication; documented restore drill.

## 13. Environments & deployment

**Docker Compose services** (self-hosted):
```
postgres · redis · minio · web · realtime · worker · migrator · (caddy/nginx TLS) · (clamav optional)
```
- `dev` (local compose) → `staging` → `prod`. Migrations run by `migrator` before `web` starts.
- CI: typecheck + lint + unit + e2e on PR; build & push images; deploy compose/k8s.
- Health checks, structured logs (pino), metrics (OpenTelemetry → Prometheus/Grafana later), error tracking (Sentry).

## 14. Non-functional targets (v1)

- **Perf:** list views < 300 ms P95 (indexed, paginated, tenant-scoped); PDF render < 3 s async.
- **Scale (design headroom):** 50+ tenants, 100+ concurrent users/tenant, millions of rows — RLS + proper indexes handle this comfortably; realtime scales via Redis adapter.
- **Availability:** single-node compose to start; components are stateless (except PG/Redis/MinIO) so scaling out is a config change.
- **Mobile:** responsive; operator + approvals flows verified on phones.

## 15. Key decisions & alternatives (for your review)

| Decision | Chosen | Alternative | Note |
|---|---|---|---|
| Tenancy | Shared DB + RLS | DB-per-tenant | RLS is simpler to operate at this scale; DB-per-tenant possible later for a big client |
| ORM | Drizzle | Prisma | Switchable; Drizzle chosen for RLS ergonomics |
| Realtime | Socket.IO | SSE + PG NOTIFY / Soketi | Socket.IO for presence + bidirectional |
| PDF | Playwright HTML→PDF | React-PDF / LaTeX | HTML templates = easiest "custom template" story |
| e-invoice | via GSP API | direct IRP | GSP (e.g., ClearTax/Masters India) is the pragmatic route |
| Accounting | Invoicing + Tally export | Full ledger in-app | Confirm scope (see `00` §4) |

> Flag anything here you'd like changed **before** I build the data model on top of it.
