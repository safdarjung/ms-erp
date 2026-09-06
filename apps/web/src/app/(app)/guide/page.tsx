import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser, can } from '@/lib/rbac';
import { NAV, NAV_GROUPS, type NavKey } from '@/lib/nav-labels';
import { ShortcutKbd } from '@/components/shortcut-kbd';
import { AskAiLink } from '@/components/app-shell';

export const metadata = { title: 'Help & guide' };

const AI_EXAMPLES = [
  'Sharma Auto ke liye 200mm die ka quotation banao, ₹50,000',
  'Bharat Pumps ke bill pe ₹40,000 UPI se aaya — record karo',
  'Kaun kaun paisa dena baaki hai?',
];

const FLOW: { text: ReactNode; nav: NavKey }[] = [
  { text: <>Enquiry aayi → add it under <b>{NAV.leads.label}</b></>, nav: 'leads' },
  { text: <>Send a quotation</>, nav: 'quotations' },
  { text: <>Customer says yes → tap <b>Make order</b></>, nav: 'orders' },
  { text: <>Job done → tap <b>Make bill</b></>, nav: 'invoices' },
  { text: <>Payment aaya → tap <b>Payment received</b> on the bill</>, nav: 'invoices' },
  { text: <>Chase what is due from <b>{NAV.dashboard.label}</b></>, nav: 'dashboard' },
];

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold tracking-tight mb-3 flex items-center gap-2.5">
        <span className="shrink-0 w-7 h-7 rounded-full bg-accent text-white grid place-items-center font-mono text-sm" aria-hidden>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function OpenLink({ nav }: { nav: NavKey }) {
  return <Link href={NAV[nav].href} className="text-xs text-steel hover:underline whitespace-nowrap">Open {NAV[nav].label} →</Link>;
}

export default async function GuidePage() {
  const user = await requireUser();
  const canAddStaff = can(user, 'user.manage');

  return (
    <div className="max-w-3xl">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{NAV.guide.label}</h1>
      <p className="text-sm text-muted mb-8">Four things to know. Two minutes.</p>

      <Section n={1} title="Fastest way: Ask AI">
        <div className="card p-5 border-accent/40 bg-gradient-to-br from-accent-soft/50 to-surface">
          <p className="text-sm text-ink mb-3">
            Tap <b>Ask AI</b> (or press <ShortcutKbd />) on any screen and say what you want, in English or Hindi.
            It shows you what it will do — nothing is saved until you tap <b>Yes</b>.
          </p>
          <p className="text-xs text-muted mb-2">Try one:</p>
          <ul className="flex flex-col gap-1.5">
            {AI_EXAMPLES.map((q) => (
              <li key={q}>
                <AskAiLink question={q} className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-line bg-surface/70 hover:border-accent/50 hover:bg-accent-soft/40 transition-colors">
                  &ldquo;{q}&rdquo;
                </AskAiLink>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-3">You can also attach a photo of a PO or price list, or tap the mic and speak.</p>
        </div>
      </Section>

      <Section n={2} title="How work flows">
        <ol className="card divide-y divide-line">
          {FLOW.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex items-center gap-3 min-w-0">
                <span className="text-muted font-mono text-xs w-4 shrink-0">{i + 1}</span>
                <span className="text-ink">{s.text}</span>
              </span>
              <OpenLink nav={s.nav} />
            </li>
          ))}
        </ol>
      </Section>

      <Section n={3} title="Install on your phone">
        <div className="card p-4 text-sm text-ink">
          <p>In Chrome on your phone, open the <b>⋮</b> menu → <b>Add to Home screen</b> (or <b>Install app</b>).</p>
          <p className="text-xs text-muted mt-1.5">It opens like any other app and keeps you signed in.</p>
        </div>
      </Section>

      <Section n={4} title="Add staff">
        <div className="card p-4 text-sm text-ink">
          {canAddStaff ? (
            <p>
              Go to <Link href={NAV.users.href} className="text-steel hover:underline">{NAV.users.label}</Link> and tap <b>Add a staff member</b>.
              Pick a role — Sales, Accounts or Viewer — and each person sees only what their role allows.
            </p>
          ) : (
            <p>Ask the owner to add you under <b>{NAV.users.label}</b>. Each person sees only what their role allows.</p>
          )}
        </div>
      </Section>

      <div className="card p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-sm text-muted">Ready? Start with a quotation, or ask AI.</span>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {can(user, 'quotation.create') && <Link href="/quotations/new" className="btn-ghost text-sm">+ New quotation</Link>}
          <Link href={NAV.dashboard.href} className="btn-primary text-sm">Go to {NAV.dashboard.label} →</Link>
        </div>
      </div>
    </div>
  );
}
