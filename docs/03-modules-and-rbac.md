# 03 · Modules & Role-Permission Map

Every module with its sub-features (**★ = beyond the reference product**), the navigation structure, and the role → permission matrix. Roles and permissions are **data**, so each tenant can customize them; the below are sensible defaults.

---

## 1. Modules & sub-features

### A. CRM & Sales
- **Lead Management** — kanban pipeline (New → Contacted → Negotiation → Won → Lost); sources; **follow-up activities + reminders**; value estimate; win/loss reasons; one-click **convert → customer**; ★ AI lead scoring (phase 2).
- **Customer Management** — profile, multiple billing/shipping addresses, **GSTIN + registration type**, credit terms/limit, contacts, **outstanding/ledger view**, full activity history.
- **Quotation** — line items; ★ **tooling/NRE cost vs per-piece running-rate split**; revisions; ★ **AI price build-up** + ★ **AI-drafted terms/scope**; approval; status pipeline; **PDF on your custom template**; convert → order / proforma; tooling-ownership clause.
- **Proforma Invoice** — advance-request document; separate numbering; bank details; custom template; clearly marked *not a tax invoice*.
- **Order Book** — sales orders; ★ **material-ownership + order-category branch** (job-work / own-manufacture / tool-build / repair); delivery schedule; ★ **milestone billing** (advance / on-trial / on-delivery); linked jobs, challans & invoices; status tracking.

### B. Production & Shop-floor
- **Die Management** — die master; ★ **owner flag** (customer/company); lifecycle event log; ★ **hit-life tracking** vs max life; **maintenance schedule + history**; location; linked drawings.
- **Die Process Tracking** (route card / job traveller) — ★ **reusable routing templates**; operation sequence with ★ **sequencing gates** (rough → stress-relieve → harden → finish-grind → assembly → trial → FAI → dispatch); machine + operator assignment; **planned vs actual** setup/cycle times; qty produced / rejected / reworked per op with reason codes; ★ **material issue with heat/batch traceability**; in-process QC sign-off.
- **CNC/VMC Machine Tracking** — machine master; ★ **event-based utilization log** (setup/run/idle/breakdown/PM); ★ **live status board (realtime)**; **downtime reason Pareto**; ★ **OEE-lite**; ★ **job-costing tie-back** (actual machine-hours × rate).
- **Production Planning & Scheduling** ★ — load per machine; due-date/priority view; ★ **delay-risk alerts** (AI).
- **Quality & Inspection** ★ — incoming / in-process / final / **FAI**; **dimensional records** (nominal/tolerance/actual); **NCR / rework** disposition (rework/scrap/use-as-is/return).

### C. Materials & Inventory
- **Material Purchase** — **indent → PO → GRN**; suppliers; receipt **against PO or customer challan**; QC inward; heat/batch capture.
- **Inventory / Store** ★ — raw material; **tooling crib** + issue/return/regrind transactions; consumables; **stock ledger**; ★ **customer-owned qty-only memo ledger** (kept separate from valued own stock); reorder levels.
- **Job-work Challans** ★ — delivery challans (Rule 55) with purpose enum; ★ **Sec-143 aging clock** (1yr inputs / 3yr capital goods / no-limit dies & moulds); ★ **ITC-04 data** when sub-contracting.

### D. Finance & Compliance
- **GST Tax Invoice** — all Rule-46 fields; ★ **auto CGST/SGST ↔ IGST** from buyer state (Haryana = 06); HSN/SAC with turnover-based digit length; ★ **job-work service invoice (SAC 9988) vs goods invoice** (HSN 8207/8480/8466/7326); ★ **e-invoice IRN + signed QR ready**; ★ **e-way bill**; amount in words; reverse-charge flag; **custom template**.
- **Receivables / Payments** ★ — receipts against invoices; outstanding ageing; ★ **payment-due reminders**.
- **Custom document template engine** ★ — per-tenant templates for quotation/proforma/invoice/challan; ★ **AI authoring assistant** (upload existing format → editable template); template gallery; versioned.

### E. People
- **Employee Management** — profile; **skill category** (drives minimum wage); statutory IDs (UAN/ESIC); wage structure (basic/DA/HRA/allowances); doubles as shop-floor operator.
- **Attendance** — shifts; ★ **biometric import**; ★ **regularization workflow** (reason + approver, audited); **OT auto-calc** (2× beyond 9h/day, 48h/wk); leave types; holiday calendar; optional job linkage for labour-hour costing.
- **Payroll** — components; ★ **OT at 2× ordinary rate**; ★ **EPF / ESI / gratuity / bonus**; LWP; salary advances; ★ **wage register + muster roll**; ★ **headcount-driven compliance flags** (Haryana 20-worker factory threshold; no Professional Tax).

### F. Platform (cross-cutting)
- **Dashboards & Reports / Analytics** — role dashboards; ★ **NL analytics chat (EN/Hindi)**; saved reports; exports (Excel/PDF).
- **Internal Chat & Notifications** — direct/group chat (realtime); notification rules (follow-ups, payment due, delay/aging alerts).
- **Document & Drawing storage** ★ — **versioned** attachments; CAD/PDF; drawing viewer.
- **AI Assistant** ★ — analytics, quoting help, document drafting (see `05`).
- **Settings & Admin** — company/branch (GSTINs), users & roles, ★ **versioned parameter masters** (GST rates, thresholds, wages), numbering, feature flags; ★ **audit log**.

---

## 2. Navigation (role-filtered)

```
Dashboard
CRM        → Leads · Customers
Sales      → Quotations · Proforma · Orders
Production → Job Cards · Dies · Machines · Planning · Quality
Materials  → Suppliers · Purchase (Indent/PO/GRN) · Inventory · Tooling · Challans
Finance    → Invoices · Receivables · Templates
People     → Employees · Attendance · Payroll
Reports    → Dashboards · Analytics (✨ ask-your-data) · Saved reports
Chat
Settings   → Company/Branch · Users & Roles · Masters/Parameters · Audit log
```
The menu is filtered by permission — e.g. a **Machine Operator** sees only **Job Cards + Machines** (and the mobile view).

---

## 3. Roles (defaults)

| Code | Role | Scope |
|---|---|---|
| **SA** | Super Admin (platform) | Cross-tenant; manages tenants, global masters, billing — *inevo.ai* |
| **OW** | Owner / Company Admin | Everything within the tenant |
| **SL** | Sales / CRM | Leads, customers, quotations, orders |
| **PM** | Production Manager / Planner | Orders, jobs, dies, machines, planning, quality |
| **OP** | Machine Operator | Own assigned jobs & machine logs (mobile) |
| **ST** | Store / Purchase | Suppliers, purchase, inventory, tooling, challans |
| **AC** | Accounts | Invoices, proforma, receivables, e-invoice |
| **HR** | HR / Admin | Employees, attendance, payroll |
| **VW** | Viewer / Auditor | Read-only dashboards, reports, audit log |

---

## 4. Permission matrix

**F** = Full (create/edit/delete + approve) · **W** = create/edit · **V** = view · **O** = own records only · **—** = none.

| Resource / Module | OW | SL | PM | OP | ST | AC | HR | VW |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Leads | F | F | — | — | — | — | — | V |
| Customers | F | W | V | — | V | V | — | V |
| Quotations | F | F | V | — | — | V | — | V |
| Orders | F | W | F | V | V | V | — | V |
| Proforma / Invoices | F | V | — | — | — | F | — | V |
| Delivery challans | F | — | W | — | W | W | — | V |
| Receivables / Payments | F | — | — | — | — | F | — | V |
| Document templates | F | V | — | — | — | W | — | — |
| Job cards / route | F | — | F | **O** | V | — | — | V |
| Machines & logs | F | — | F | **O** | — | — | — | V |
| Dies | F | — | F | V | V | — | — | V |
| Quality / inspection | F | — | F | W | — | — | — | V |
| Suppliers / Purchase / GRN | F | — | V | — | F | V | — | V |
| Inventory / Tooling | F | — | V | V | F | — | — | V |
| Employees | F | — | — | — | — | — | F | V |
| Attendance | F | — | V | O | — | — | F | V |
| Payroll | F | — | — | — | — | V | F | — |
| Reports / Analytics (✨) | F | V | V | — | V | V | V | V |
| Chat | F | F | F | F | F | F | F | V |
| Settings · Users · Roles | F | — | — | — | — | — | — | — |
| Masters / Parameters | F | — | V | — | V | V | V | V |
| Audit log | F | — | — | — | — | — | — | V |

*Notes:* **OP** access is **own-record only** — an operator sees/updates just their assigned jobs and machine logs. **Payroll** is deliberately narrow (OW + HR write, AC view). **Settings/Users/Roles** and **Audit** are owner-only by default. The whole matrix is editable per tenant, and finer record-level rules (e.g. "sales rep sees only their customers") are expressed as additional query scopes / RLS predicates.

---

## 5. Enforcement (recap from `01`)
- **RLS** guarantees you only ever see your **tenant's** rows.
- **`authorize(user, 'invoice.create')`** gates every action + hides UI.
- Both run on every server action / API route: `authenticate → authorize → validate → withTenant(tx) → service → audit`.

---

## 6. Reference parity & additions

We benchmarked against the live reference product and **cover all 14 of its marketed modules plus its hidden ones** (Products catalog, Roles/Permissions, Status Management, Activity Log, Settings, Document Flow, Daily Reports, Dashboard). Net additions this brings into scope:

- **Employee Targets** — sales *and* production targets vs achievement (they track sales only).
- **Daily work logs** (text / voice / file) per employee, linked to jobs.
- **Leave requests & balances** with an approval workflow (they only let an admin mark "Leave").
- **Credit / debit notes** for GST returns & corrections (they have none — a compliance gap).
- **Die BOM / components & inserts** (they treat a die as one flat record).
- **Machine preventive-maintenance** schedule + log (they have none).
- **Inbound lead integrations** (IndiaMART · Meta · WhatsApp · webhook) + **quotation revisions**.
- **Configurable per-tenant status taxonomies** — with automation on explicit flags, not status names.
- **Notifications** (in-app + email/WhatsApp) — they have none at all.
- **Real analytics** (NL + dashboards + AR aging + job-costing/margin + machine OEE) — theirs is CSV export.

Everything above folds into the module + RBAC structure already defined; no new roles required.
