# 00 · Vision & Scope

> **Working title:** MS Enterprises ERP (platform brand TBD — see Appendix A)
> **First tenant:** MS Enterprises, Faridabad (formerly *Friends Sole Engineering*) — a precision machining / die-making job-shop in the SMIE industrial area near YMCA Chowk.
> **Benchmark to beat:** the die-manufacturing ERP at `die.rektech.work` (vendor: rektech).

---

## 1. Vision

**A single, AI-native operating system for precision-machining and die-making job-shops — covering the whole journey from enquiry → quotation → order → shop-floor production → dispatch → GST invoice — that replaces the Excel + WhatsApp + disconnected-software mess with one fast, mobile-friendly platform.**

We are not building "another ERP." We are building the *best vertical ERP for Indian machining/die shops*, where AI is woven into the daily workflow (not bolted on as a gimmick), GST compliance is correct out of the box, and the shop floor is usable from a phone.

## 2. Context & strategy

- MS Enterprises is **tenant #1** and our design partner. The product is **architected multi-tenant from day one** (see `01-architecture.md`) so a second factory can be onboarded with configuration, not a rewrite.
- The reference product proves the market and defines the **feature floor**. Our job: **match every one of its modules, then exceed it** on AI, UX, mobile, GST/compliance depth, and reporting.
- Positioning line: *"Your entire job-shop — quotation to dispatch to GST invoice — in one place, with an AI assistant that already knows your data."*

## 3. Goals

1. **Feature parity+** with the reference across all 14 modules, plus high-value additions (production scheduling, quality/inspection, job-work GST challans, e-invoice, audit trail).
2. **AI in the workflow** — natural-language reports & analytics, smart quotation/pricing, and custom-template document generation (quotation / proforma / GST bill).
3. **Correct India GST** — legally complete tax invoices, proforma, quotations; e-invoice (IRN/QR) and e-way-bill ready; job-work delivery challans & ITC-04 hooks; HSN/SAC & CGST/SGST/IGST logic.
4. **Multi-tenant & secure** — hard tenant isolation via Postgres Row-Level Security; role-based access; full audit log.
5. **Fast & mobile-friendly** — quick keyboard-first data entry for the office; a phone-friendly view for operators on the shop floor.
6. **Bilingual** — English + Hindi UI (the users and the reference product's audience are Hindi-first).

## 4. Non-goals (initial release — revisit later)

- **Full double-entry financial accounting** (Tally-grade ledgers, balance sheet). We do invoicing + basic receivables/payments and **export to Tally**; we do not replace the accountant's books in v1. *(Confirm at review.)*
- **CAD/CAM authoring.** We **store, version and view** drawings (PDF/DWG/STEP/images); we don't author them.
- **Automated statutory e-filing** (GSTR/PF/ESI returns). We produce the **registers, JSON and reports** needed to file; filing itself is phase 2+.
- **OCR document capture** and **predictive machine maintenance** are **designed as hooks** (data + interfaces ready) but are **not** built in the core release.

## 5. Personas & roles

| Role | Who | Primary jobs |
|---|---|---|
| **Super Admin** (platform) | inevo.ai / us | Manage tenants, global config, billing, feature flags |
| **Company Admin / Owner** | MS Enterprises owner | Full access within the tenant; company/branch setup; approvals |
| **Sales / CRM** | Sales staff | Leads, customers, quotations, proforma, order intake |
| **Production Manager / Planner** | Production head | Order book, die management, process routing, scheduling, dispatch |
| **Machine Operator** | Shop-floor worker | Update job/operation status & machine logs (mobile) |
| **Store / Purchase** | Stores in-charge | Material purchase, suppliers, GRN, inventory, job-work challans |
| **Accounts** | Accountant | Proforma & GST invoices, receipts, receivables, e-invoice |
| **HR** | HR/admin | Employees, attendance, payroll |
| **Viewer / Auditor** | Owner, external CA | Read-only dashboards, reports, audit log |

Roles are **customizable per tenant** (see RBAC in `03-modules-and-rbac.md`); the above are sensible defaults.

## 6. Scope — modules

Grouped into functional areas. **★ = beyond the reference product** (our differentiators).

**A. CRM & Sales**
- Lead Management (pipeline, sources, follow-ups, conversion)
- Customer Management (contacts, GSTIN, addresses, credit terms, ledger view)
- Quotation Management (line items, machining/BOM basis, revisions, approvals)
- Proforma Invoice
- Order Book (sales orders, delivery schedule, status)

**B. Production & Shop-floor**
- Die Management (die master, ownership, lifecycle, history, maintenance) 
- Die Process Tracking (route card / job traveller: operation → machine → operator → time → QC)
- CNC/VMC Machine Tracking (machine master, utilization, run/setup/downtime logs, OEE ★)
- Production Planning & Scheduling ★ (load per machine, due-date/delay-risk)
- Quality & Inspection ★ (in-process & final QC, dimensional records, NCR/rework)

**C. Materials & Inventory**
- Material Purchase (indent → PO → supplier → GRN)
- Inventory / Store ★ (raw material, tooling/inserts, consumables, stock ledger)
- Job-work Challans ★ (GST delivery challans in/out, ITC-04 data)

**D. Finance & Compliance**
- GST Tax Invoice (e-invoice/IRN + QR ready ★, e-way bill hooks ★)
- Proforma & Quotation documents
- Receivables / Payments (light) ★
- **Custom document template engine** ★ (per-tenant templates for quotation / proforma / invoice)

**E. People**
- Employee Management
- Attendance (shifts, OT, biometric/manual import)
- Payroll (components, PF/ESI/PT, wage register)

**F. Platform (cross-cutting)**
- Dashboards & Reports / Analytics (+ **AI NL analytics** ★)
- Internal Chat & Notifications
- Document / Drawing storage & versioning ★
- **AI Assistant** ★ (analytics, quoting help, doc drafting)
- Audit Log ★, Settings, Company/Branch, Users & Roles

## 7. Key differentiators vs the reference

| Dimension | Reference (typical) | **This platform** |
|---|---|---|
| AI | None / minimal | NL analytics, smart quoting, custom-template doc generation, assistant |
| GST | Basic invoice | Legally-complete invoice + **e-invoice/IRN + QR + e-way bill + job-work challans/ITC-04** |
| Shop floor | Desktop forms | **Mobile-friendly operator view**, live job/machine status |
| Documents | Fixed format | **Per-tenant custom templates** (quotation/proforma/invoice) |
| Reporting | Static lists | Rich dashboards + **ask-in-plain-language** analytics |
| Architecture | Single build | **Multi-tenant SaaS-ready**, hard RLS isolation, audit trail |
| Production | Tracking only | Tracking **+ scheduling + delay-risk + quality** |
| Language | Hindi/English | English **+ Hindi** with clean bilingual UX |

## 8. Success criteria

- MS Enterprises runs the **entire flow in-app**: enquiry → quotation → order → die/process → machine tracking → dispatch → GST invoice — no parallel Excel/WhatsApp.
- **Faster quotes** (smart quoting) and **fewer manual errors** (validation + templates).
- **Real-time visibility**: owner can see, on a phone, what every machine and order is doing right now.
- A **second factory** can be onboarded with configuration only (proves SaaS-readiness).
- Owner can **ask the data questions in Hindi/English** and get correct answers.

## 9. Assumptions to confirm at review

These shape the data model; I've chosen sensible defaults and flagged each. Please confirm/correct:

1. **What does MS Enterprises actually produce?** Dies/tools, precision machined components (job-work), or both? (Weights the Die vs Component emphasis.)
2. **GST profile:** turnover band (is **e-invoice** applicable — currently >₹5 cr AATO?), number of GSTINs / branches, main state (Haryana → intra = CGST+SGST).
3. **Finance depth:** keep **Tally** for accounting and just export, or do you want fuller in-app finance later?
4. **Inventory:** do you need real **stock ledger** (raw material/tooling), or only purchase records for v1?
5. **People scale:** ~how many workers (payroll scope), shift patterns, biometric device brand (for attendance import)?
6. **Languages:** confirm **English + Hindi** UI.
7. **Migration:** existing data to import (customers, dies, employees, open orders)? In what form (Excel)?

## 10. Document map

| Doc | Contents |
|---|---|
| `00-vision-and-scope.md` | *(this)* vision, scope, personas, differentiators |
| `01-architecture.md` | stack, multi-tenancy/RLS, infra, security, deployment |
| `02-data-model.md` | full ERD + table-by-table schema |
| `03-modules-and-rbac.md` | module features + role/permission matrix |
| `04-wireframes.md` | key screen wireframes |
| `05-ai-integration.md` | NL analytics, smart quoting, custom-template docs |
| `06-roadmap.md` | phased delivery plan & milestones |

---

### Appendix A — product name ideas (optional, for the SaaS play)
If you productize beyond MS Enterprises, a neutral brand helps. Candidates: **DieFlow**, **ShopOS**, **MachShop**, **Kaarigar** (कारीगर = craftsman), **Dhaatu** (धातु = metal), **ForgeDesk**. Decision deferred — not blocking.
