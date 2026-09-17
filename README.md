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

## AI features (optional — set `ANTHROPIC_API_KEY` in `.env`)

- **⌘K assistant (ask & act)** — ask your data in English or हिन्दी ("top 5 customers by sales", "इस महीने कितनी बिक्री हुई?"), and **operate the whole ERP by chat**: record and update leads, log follow-ups, convert leads, manage customers, draft quotations with priced line items, move quotation/invoice statuses, convert quotations to invoices, raise invoices, and open any screen or print-ready PDF. Every write is staged as a confirmation card (validated + permission-checked server-side, stored in `ai_action` as an audit trail) and runs only after you click **Confirm** — GST math and document numbering stay deterministic in code, never from the model.
- **Smart quotation drafting** — describe the job; the AI proposes line items, rates (anchored on your quote history), terms, assumptions and anomaly flags. You review and edit everything; totals & GST stay deterministic in code.
- **Terms polish** — one-click drafting/tightening of terms & notes on quotations and invoices.
- **Pricing memory** — while typing an item on a quotation/bill/order, past lines pop up with the last rate, HSN and unit (one tap fills the row); the assistant's `price_history` tool anchors new quotes on real history ("last time ₹30,000 for Sharma Auto").
- **Messages you send, drafted for you** — "send a payment reminder / follow-up / delivery update on WhatsApp": the assistant writes it, the card shows WhatsApp / email / copy buttons, and a public **share link** to the quotation or bill PDF (signed, expires in 60 days, no login needed) is inserted. The app never sends anything itself.
- **Today's briefing** — the home screen carries a 3–5 line plain-words summary (money overdue, follow-ups, quotations waiting, orders due, how the month is going), written once a day per business from the same numbers the dashboard shows.
- **Email enquiries read by AI** — free-form enquiry emails that the IndiaMART/TradeIndia parsers don't recognise are read by the model into a draft (name, phone, requirement) for the review screen; newsletters and notifications are parked, recoverably.
- **AI activity & usage** (`/settings/ai`, owner) — every proposal the AI made and whether it was saved, tokens per day, by feature and by person.

Model routing, cost metering (`ai_usage` table), prompt caching and guardrails are described in [`docs/05-ai-integration.md`](./docs/05-ai-integration.md). Without a key, AI surfaces show a setup hint and everything else works normally.

Also: global search (top bar or `/`), customer statement-of-account and payment-receipt PDFs, dark mode (Auto/Light/Dark in the sidebar).

## Layout
```
apps/web         Next.js app (UI + server actions + AI routes)
packages/ai      Claude gateway: model routing, SQL guard, structured drafting
packages/db      Drizzle schema, migrations, RLS, tenant client, seed
packages/core    shared types, zod, enums, utils
docs/            product & technical blueprint (00–06)
```

**Database:** local Docker Postgres by default; swap `DATABASE_URL` for managed Postgres (Neon / **Supabase** free tier) with zero code changes — see [`DEPLOY.md`](./DEPLOY.md).

## Multi-tenancy
Every business row carries `tenant_id`; Postgres **RLS** enforces isolation. The app connects as a non-superuser (`app_user`) and every request runs inside a transaction that sets `app.current_tenant` — a query physically cannot read another tenant's data.
