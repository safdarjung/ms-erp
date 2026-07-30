# 04 · Key Screen Wireframes

Low-fidelity layouts for the screens that carry the workflow. These convey **structure, key data, and where AI / realtime appear** — not final visual design. Bilingual (EN / हिन्दी) throughout; dense, keyboard-friendly data entry for the office; a stripped-down mobile view for the shop floor.

Legend: `[button]` · `‹select›` · `▸` expandable · `🟢🟡🔴` status · `✨` AI-assisted · `⚡` realtime.

---

## 0. App shell (every screen)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ☰  MS Enterprises  ‹Branch: Faridabad ▾›     🔎 Search…       🌐 EN|हि  🔔3  ⚙  👤 │
├──────────────┬────────────────────────────────────────────────────────────────┤
│ ▸ Dashboard  │                                                                  │
│ ▸ CRM        │                     ‹ page content ›                             │
│   Leads      │                                                                  │
│   Customers  │                                                                  │
│ ▸ Sales      │                                                                  │
│   Quotations │                                                                  │
│   Proforma   │                                                                  │
│   Orders     │                                                                  │
│ ▸ Production │                                                                  │
│   Job Cards  │                                                                  │
│   Dies       │                                                                  │
│   Machines   │                                                                  │
│   Quality    │                                                                  │
│ ▸ Materials  │                                                                  │
│ ▸ Finance    │                                                                  │
│   Invoices   │                                                                  │
│   Challans   │                                                                  │
│ ▸ People     │                                                                  │
│ ▸ Reports    │                                                                  │
│ ▸ Chat  💬   │                                                                  │
└──────────────┴────────────────────────────────────────────────────────────────┘
```
Nav is **role-filtered** (an operator sees only Job Cards + Machines). Branch switcher scopes GSTIN/state for tax logic.

---

## 1. Dashboard  (owner / admin)

```
┌─ Dashboard ───────────────────────────────────────────────────────────────────┐
│ ┌ Open Orders ┐ ┌ Pending Quotes ┐ ┌ Machine Util ┐ ┌ On-time % ┐ ┌ Receivables ┐│
│ │    28       │ │   12  (₹18.4L)  │ │    73% ⚡     │ │   88%     │ │  ₹9.6L      ││
│ └─────────────┘ └────────────────┘ └──────────────┘ └───────────┘ └─────────────┘│
│                                                                                  │
│ ┌ Sales trend (6 mo) ──────────────┐  ┌ Machine status  ⚡ ─────────────────────┐│
│ │      ▁▃▅▆▇█                        │  │ VMC-1 🟢 run   CNC-2 🟡 idle           ││
│ │                                    │  │ WEDM-1 🔴 down  SG-1 🟢 run  …          ││
│ └────────────────────────────────────┘  └────────────────────────────────────────┘│
│                                                                                  │
│ ┌ ⚠ Alerts ───────────────────────────────────────────────────────────────────┐ │
│ │ 🔴 Order #SO-231 at risk (op behind schedule)    ✨ delay-risk                │ │
│ │ 🟡 Challan DC-88 job-work nearing 1-yr (Sec 143)                              │ │
│ │ 🟡 Invoice INV-0142 payment due in 3 days                                     │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                              ┌ ✨ Ask your data ─┐ │
│                                                              │ "pichhle mahine ke │ │
│                                                              │  pending orders…"  │ │
│                                                              │ [ type / 🎤 ]      │ │
│                                                              └────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Lead pipeline  (kanban)

```
┌─ Leads ─────────────────────────────────────────  [+ New Lead]  ‹filter▾›  ─────┐
│  NEW (5)          CONTACTED (4)      NEGOTIATION (3)     WON (2)      LOST (1)    │
│ ┌───────────────┐┌───────────────┐┌───────────────┐┌───────────┐┌────────────┐  │
│ │ Sharma Auto   ││ Kisan Tools   ││ Verma Dies    ││ …         ││ …          │  │
│ │ Press tool    ││ VMC job-work  ││ Sole mould    ││           ││            │  │
│ │ ~₹2.5L        ││ ~₹80k         ││ ~₹4.2L        ││           ││            │  │
│ │ ⏰ f/up today  ││ ⏰ 2 Aug       ││ ⏰ overdue 🔴  ││           ││            │  │
│ └───────────────┘└───────────────┘└───────────────┘└───────────┘└────────────┘  │
│  drag cards between stages · click → detail + activity trail + [Convert→Customer]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Quotation editor  (with ✨ smart pricing)

```
┌─ Quotation  QT/26-27/0043  ‹Draft›──────────────────  [Save] [Preview PDF] [Send]┐
│ Customer ‹Verma Dies ▾›   RFQ ref [VD/778]   Date [29-07-26]  Validity [15 days] │
├──────────────────────────────────────────────────────────────────────────────────┤
│  # Description            Drawing   HSN/SAC  Qty  UOM  Rate     Taxable   Tooling? │
│  1 Progressive press tool VD-778-A  8207     1    NOS  2,80,000 2,80,000   ☑ (NRE) │
│  2 Component – running    VD-778-B  9988     5000 NOS  14.50    72,500     ☐       │
│  [+ add line]                                                                      │
│                                                                    Sub  3,52,500   │
│                                                            GST 18%   63,450         │
│                                                            Total  4,15,950         │
├─ ✨ Suggested price build-up ──────────────────────────────────────────────────┐  │
│ │ Material ₹96k · Machining 42h×₹450 ₹18.9k · Tooling ₹55k · OH 12% · Margin 22%│  │
│ │ ⚑ Running rate 20% below your last quote for this part (QT-0021 @ ₹18.1)      │  │
│ │ [ apply build-up ]   [ draft terms & scope ✨ ]                                │  │
│ └────────────────────────────────────────────────────────────────────────────────┘│
│  Terms ▸ (AI-drafted, editable)   Tooling ownership: transfers on final payment    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Order book

```
┌─ Orders ───────────────────────  ‹Status:All▾› ‹Category▾› ‹Owner▾›  [+ New] ────┐
│ SO#     Customer     Part / Tool     Cat        Own   Qty   Due     Progress     │
│ SO-231  Sharma Auto  Press tool #12  tool_build cust  1     10 Aug  ▓▓▓▓░░ 60% 🔴 │
│ SO-230  Kisan Tools  Bracket M8      job_work   cust  5000  05 Aug  ▓▓▓▓▓▓ 95% 🟢 │
│ SO-229  Verma Dies   Sole mould EVA  own_mfg    comp  1     20 Aug  ▓▓░░░░ 25% 🟡 │
│ …                                                                                 │
│  click → order detail: items, milestones (advance/trial/delivery), linked jobs,   │
│         challans & invoices, delivery schedule                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Job traveller / route card  ★ (the spine)

```
┌─ Job Card  JOB-0512  ‹In-process›──────────────────────  [Print traveller] ─────┐
│ Order SO-231 · Part: Press tool #12 (VD-778-A) · Die: DIE-204                    │
│ Qty 1 · Material: D2 (⬤ customer-supplied)  Heat# H-4471 · Due 10 Aug · Prio 🔴  │
├─ Operations ─────────────────────────────────────────────────────────────────────┤
│ Op  Operation        Machine  Oper.   Plan(s/c)  Actual   Qty  Rej  QC     Status │
│ 10  Saw/cut block     Bandsaw  Ravi    20/10      18/9     1    0   —      ✔ done  │
│ 20  Rough mill        VMC-1    Suresh  60/240     55/250   1    0   —      ✔ done  │
│ 30  Stress relieve    HT-ext   —       —          —        1    0   —      ✔ done  │
│ 40  CNC profile       VMC-1    Suresh  40/180     ⏳ live⚡  —    —   —      ▶ run   │
│ 50  Wire-EDM          WEDM-1   Amit    30/120     —        —    —   —      ○ queue │
│ 60  Harden 58HRC      HT-ext   —       —          —        —    —   —      ○ queue │
│ 70  Finish grind      SG-1     —       —          —        —    —   —      ○ queue │
│ 80  Fit & trial       Bench    —       —          —        —    —   pending ○ gate │
│ [+ op]   ⓘ sequence gates: harden must precede finish-grind; dispatch after FAI  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Material issues ▸   Inspections ▸   Attachments (drawings) ▸   Cost: plan vs act ▸ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Machine tracking board  (live ⚡)

```
┌─ Machines ──────────────────  ‹Shift: II▾›  Today   [board] [logs] [downtime] ──┐
│ ┌ VMC-1 🟢 RUN ─────┐ ┌ VMC-2 🟡 IDLE ────┐ ┌ CNC-2 🟢 RUN ────┐ ┌ WEDM-1 🔴 DOWN┐│
│ │ JOB-0512 op40     │ │ (no job)          │ │ JOB-0498 op20     │ │ tool break   ││
│ │ util 78%          │ │ util 41%          │ │ util 82%          │ │ 47 min ⏱      ││
│ │ ▓▓▓▓▓▓▓░░          │ │ ▓▓▓▓░░░░░          │ │ ▓▓▓▓▓▓▓▓░          │ │ ▓░░░░░░░░     ││
│ └───────────────────┘ └───────────────────┘ └───────────────────┘ └──────────────┘│
│ ┌ Downtime today (Pareto) ─────────────────────────────────────────────────────┐ │
│ │ Tool change ▓▓▓▓▓ · Setup ▓▓▓ · No material ▓▓ · Breakdown ▓                  │ │
│ └────────────────────────────────────────────────────────────────────────────────┘│
│  click a machine → state log (setup/run/idle/down + reason), OEE-lite, job history│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Die management

```
┌─ Die  DIE-204  «Press tool #12»  ‹Active›────────────────  [Maintenance] [History]┐
│ Type: press_tool · Owner: ⬤ customer (Sharma Auto) · Location: Rack B-3           │
│ Stations 4 · Press 60T · Hardness 58HRC                                           │
│ ┌ Hit life ────────────────────────────┐  ┌ Next maintenance ─────────────────┐   │
│ │ 1,24,000 / 5,00,000  ▓▓▓░░░░░ 25%     │  │ due after 1,50,000 hits (~6 wks)  │   │
│ └────────────────────────────────────────┘  └────────────────────────────────────┘   │
│ History ▸ created 12-Jun · trial 20-Jun · run +40k · repair 02-Jul · run +84k…    │
│ ⓘ Sec 143: dies/moulds have no return time-limit — safe to hold indefinitely.     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. GST Tax Invoice  (auto CGST/SGST ↔ IGST, e-invoice-ready)

```
┌─ Tax Invoice  MSE/26-27/0142  ‹Draft›──────────  Template ‹MSE Classic ▾›  ──────┐
│ Bill to ‹Kisan Tools (06AAB…)›   Place of supply [Haryana-06]  → CGST+SGST 🟢     │
│ Type: ⬤ Job-work service (SAC 9988)    Order SO-230 · Challan DC-91 ref           │
├──────────────────────────────────────────────────────────────────────────────────┤
│  # Description         SAC/HSN  Qty  UOM  Rate   Taxable   CGST9%   SGST9%         │
│  1 Machining – Bracket 9988     5000 NOS  14.50  72,500    6,525    6,525          │
│                                            Taxable   72,500                        │
│                                            CGST 9%    6,525                        │
│                                            SGST 9%    6,525                        │
│                                            Round off   –                           │
│                                            TOTAL     85,550                        │
│  Amount in words: Eighty five thousand five hundred fifty only                    │
│ ┌ e-Invoice ──────────────────┐   Reverse charge ‹No›                             │
│ │ IRN ▢  QR ▢  [Generate IRN]  │   [Save] [Preview PDF] [Generate e-Way]           │
│ └──────────────────────────────┘   (numbers computed by GST engine, not AI)       │
└──────────────────────────────────────────────────────────────────────────────────┘
```
> If buyer GSTIN ≠ `06…`, the form flips to a single **IGST** line automatically.

---

## 9. Attendance  (daily grid)

```
┌─ Attendance  [29 Jul 2026]  ‹Shift:All▾›─────────────  [Import biometric] [Payroll]┐
│ Emp        Skill      In     Out    Hrs   OT   Status      Regularize             │
│ Ravi K.    skilled    08:58  18:30  8.6   0.5  🟢 Present                          │
│ Suresh M.  h.skilled  09:05  20:10  9.9   1.9  🟢 Present  (OT 2×)                 │
│ Amit S.    semi       —      —      —     —    🔴 Absent   [regularize ▾]          │
│ Vijay P.   unskilled  09:00  13:30  4.5   —    🟡 Half-day                         │
│ …                                                                                 │
│  OT auto-computed vs 9h/day & 48h/week · edits require reason + approver (audited) │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. AI assistant  (NL analytics result)

```
┌─ ✨ Ask your data ──────────────────────────────────────────────────────────────┐
│ You:  top 5 customers by sales this quarter                                      │
│ ──────────────────────────────────────────────────────────────────────────────  │
│ Claude:  Here are your top 5 customers, Apr–Jun 26 (by invoiced value):          │
│   ┌──────────────┬──────────┐    ▐ Sharma  ████████ 6.2L                          │
│   │ Sharma Auto  │ ₹6.2L    │    ▐ Verma   ██████   4.8L                          │
│   │ Verma Dies   │ ₹4.8L    │    ▐ Kisan   ████     3.1L                          │
│   │ Kisan Tools  │ ₹3.1L    │    ▐ …                                              │
│   └──────────────┴──────────┘                                                     │
│   Sharma is up 34% vs last quarter. [Save as report]  [Export]                    │
│ ──────────────────────────────────────────────────────────────────────────────  │
│ [ ask a follow-up…  (EN / हिन्दी) ]                                          🎤 ➤ │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Runs read-only, tenant-scoped, over safe analytics views (`05` §2). Numbers from the DB; never invented.

---

## 11. Mobile — shop-floor operator view  📱

```
┌────────────────────┐   Operator logs in → only their assigned jobs.
│ 👤 Suresh · Shift II│   One-tap start/stop keeps machine_log + job_operation
├────────────────────┤   accurate without office data entry.
│ MY JOBS            │
│ ▸ JOB-0512 op40 🟢 │   ┌─ JOB-0512 · op40 CNC profile ─┐
│   VMC-1 · running   │   │ [ ⏸ Pause ]  [ ✔ Complete ]   │
│ ▸ JOB-0498 op20    │   │ Qty made [ __ ]                │
│   queued            │   │ Downtime? ‹reason ▾›           │
├────────────────────┤   │ 🔴 Report breakdown            │
│ [ Start next op ]  │   └────────────────────────────────┘
└────────────────────┘
```

---

## Design-system notes
- **Component kit:** Tailwind + shadcn/ui; dense data grids (TanStack Table) with inline edit, keyboard nav, and bulk actions — office users live in these.
- **Bilingual:** every label in EN + हिन्दी; numbers in Indian grouping (₹1,24,000).
- **Status color** consistent everywhere (🟢 ok / 🟡 attention / 🔴 problem).
- **AI is always a side-panel or inline suggestion (✨)**, never a blocking modal — draft-and-approve, never auto-commit.
- **Realtime (⚡)** on machine board, job status, chat, notifications.
- **Print/PDF** views use the tenant's **custom templates** (`05` §4), not the on-screen layout.
