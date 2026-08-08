import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/rbac';

export const metadata = { title: 'Guide' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold tracking-tight mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Feature({ icon, title, href, children }: { icon: string; title: string; href: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden className="text-lg">{icon}</span>
        <span className="font-medium text-sm">{title}</span>
        <Link href={href} className="ml-auto text-xs text-steel hover:underline">Open →</Link>
      </div>
      <p className="text-xs text-muted leading-relaxed">{children}</p>
    </div>
  );
}

export default async function GuidePage() {
  await requireUser();

  const flow = [
    { n: 1, t: 'Enquiry comes in', d: 'Log it as a Lead — who asked, what they need, follow-up date. Move it through the pipeline (New → Contacted → Negotiation → Won).', href: '/leads' },
    { n: 2, t: 'Win the lead → Customer', d: 'One click turns a won lead into a Customer (with GSTIN, address, credit terms) you can bill.', href: '/customers' },
    { n: 3, t: 'Send a Quotation', d: 'Draft line items (the AI can propose items & rates from your history). GST is auto-calculated. Print on your letterhead.', href: '/quotations' },
    { n: 4, t: 'Confirm → Sales Order', d: 'Convert the quote to an order in the Order Book — track category, material (yours or customer’s), delivery date and status.', href: '/orders' },
    { n: 5, t: 'Raise the GST Invoice', d: 'One click makes the tax invoice (CGST/SGST or IGST auto-picked by the buyer’s state). Print or Save PDF.', href: '/invoices' },
    { n: 6, t: 'Record Payments', d: 'Log receipts against the invoice. The app tracks outstanding, due dates and overdue amounts for you.', href: '/invoices' },
  ];

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Help</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Quick guide</h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        MS Enterprises ERP runs your whole front office — enquiries, quotations, orders, GST invoices and payments —
        with an AI assistant that can answer questions <b>and</b> do the work for you. Here’s the tour.
      </p>

      <Section title="The core flow — enquiry to payment">
        <div className="space-y-2.5">
          {flow.map((s) => (
            <div key={s.n} className="card p-4 flex gap-3.5 items-start">
              <div className="shrink-0 w-7 h-7 rounded-full bg-accent text-white grid place-items-center font-mono text-sm font-semibold">{s.n}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.t}</span>
                  <Link href={s.href} className="text-xs text-steel hover:underline">Open →</Link>
                </div>
                <p className="text-xs text-muted mt-0.5 leading-relaxed">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-faint mt-3">Every number stays gap-free and every GST figure is computed in code — never guessed.</p>
      </Section>

      <Section title="Everything you can do">
        <div className="grid sm:grid-cols-2 gap-3">
          <Feature icon="📊" title="Dashboard" href="/dashboard">Your day at a glance — money invoiced, receivables, open orders & quotes, and alerts for overdue payments and due follow-ups.</Feature>
          <Feature icon="📈" title="Analytics" href="/analytics">Sales by week/month/year, revenue & collection trends, top customers, receivables aging, quotation win-rate, and a GST summary for filing.</Feature>
          <Feature icon="🎯" title="Leads" href="/leads">Capture enquiries, track the pipeline, log calls/meetings, set follow-up reminders, and convert winners to customers.</Feature>
          <Feature icon="🏢" title="Customers" href="/customers">Full customer profile with a ledger — every quote, order and invoice, plus outstanding balance and credit terms.</Feature>
          <Feature icon="📄" title="Quotations" href="/quotations">Build quotes fast (AI can draft items & rates), edit anytime, and convert to an order or invoice. Print on your letterhead.</Feature>
          <Feature icon="📦" title="Order Book" href="/orders">Track confirmed jobs — job-work vs own-manufacture, whose material, delivery dates and status — then invoice them.</Feature>
          <Feature icon="🧾" title="GST Invoices" href="/invoices">Correct CGST/SGST↔IGST every time, amount-in-words, PDF on your bill format. Cancel with a click if needed.</Feature>
          <Feature icon="💰" title="Payments" href="/invoices">Record receipts (bank/UPI/cash/cheque); the app derives paid / partially-paid / overdue and aging automatically.</Feature>
        </div>
      </Section>

      <Section title="✦ The AI assistant — your fastest shortcut">
        <div className="card p-5 border-accent/40 bg-gradient-to-br from-accent-soft/50 to-surface">
          <p className="text-sm text-ink mb-3">
            Press <kbd className="kbd">⌘K</kbd> (or tap <b>Ask AI</b>) anywhere. It speaks <b>English & हिन्दी</b>, and does two things:
          </p>
          <ul className="text-sm text-muted space-y-2 mb-3">
            <li><b className="text-ink">Answers</b> — “Top 5 customers this year”, “who owes us money?”, “इस महीने कितनी बिक्री हुई?” — with live tables & charts.</li>
            <li><b className="text-ink">Acts</b> — “new quotation for Sharma for a 200mm die at ₹50,000”, “record ₹40,000 UPI payment on INV-1”, “add a lead from IndiaMART”. It shows a <b>confirmation card you can edit</b>, and only runs after you tap <b>Confirm</b>.</li>
            <li><b className="text-ink">Voice 🎤</b> — tap the mic in the assistant and speak (English or Hindi) instead of typing.</li>
          </ul>
          <p className="text-xs text-faint">It never touches GST math or document numbers — those stay exact. You’re always in control: nothing is saved until you confirm.</p>
        </div>
      </Section>

      <Section title="Handy tips">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Tip icon="📱" title="Install on your phone">In Chrome, open the menu → <b>Install app</b>. It becomes a real app on your home screen and keeps you logged in.</Tip>
          <Tip icon="⌨️" title="Keyboard">Hit <kbd className="kbd">⌘K</kbd> / <kbd className="kbd">Ctrl K</kbd> to open the assistant from any screen.</Tip>
          <Tip icon="🖨️" title="Print / Save PDF">Every quotation & invoice has a Preview and a Print / Save PDF button — on your company letterhead.</Tip>
          <Tip icon="👥" title="Add your staff">Owners can add staff with roles (sales, accounts…) under <Link href="/settings/users" className="text-steel hover:underline">Users &amp; roles</Link>. Each person sees only what their role allows.</Tip>
        </div>
      </Section>

      <div className="card p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-sm text-muted">Ready to go — start with your first quotation or ask the assistant.</span>
        <div className="flex gap-2">
          <Link href="/quotations/new" className="btn-ghost text-sm">+ New quotation</Link>
          <Link href="/dashboard" className="btn-primary text-sm">Go to dashboard →</Link>
        </div>
      </div>
    </div>
  );
}

function Tip({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1"><span aria-hidden>{icon}</span><span className="font-medium text-sm">{title}</span></div>
      <p className="text-xs text-muted leading-relaxed">{children}</p>
    </div>
  );
}
