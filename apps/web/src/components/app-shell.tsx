'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { logoutAction } from '@/app/login/actions';
import { AssistantPanel, openAssistant } from '@/components/assistant/assistant-panel';

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    leads: <><path d="M12 21a9 9 0 1 0-9-9" /><path d="M12 17a5 5 0 1 0-5-5" /><circle cx="12" cy="12" r="1" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    quotations: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>,
    invoices: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden>
      {paths[name]}
    </svg>
  );
}

const NAV: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
  { group: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'CRM',
    items: [
      { href: '/leads', label: 'Leads', icon: 'leads' },
      { href: '/customers', label: 'Customers', icon: 'customers' },
    ],
  },
  {
    group: 'Sales & GST',
    items: [
      { href: '/quotations', label: 'Quotations', icon: 'quotations' },
      { href: '/invoices', label: 'Invoices', icon: 'invoices' },
    ],
  },
];

const TITLES: [string, string][] = [
  ['/dashboard', 'Dashboard'], ['/leads', 'Leads'], ['/customers', 'Customers'],
  ['/quotations', 'Quotations'], ['/invoices', 'Invoices'],
];

export function AppShell({
  user,
  aiEnabled,
  children,
}: {
  user: { name: string; email: string };
  aiEnabled: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const title = TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'MS ERP';

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[228px_1fr]">
      <aside className="border-r border-line bg-surface flex flex-col md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2 px-4 border-b border-line shrink-0" style={{ height: 52 }}>
          <span className="text-accent text-lg leading-none" aria-hidden>⚙</span>
          <span className="font-semibold tracking-tight">MS Enterprises</span>
        </div>

        <div className="p-2 shrink-0">
          <button
            onClick={() => openAssistant()}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-accent/40 bg-accent-soft/50 text-accent text-sm font-medium hover:bg-accent-soft transition-colors"
          >
            <span className="flex items-center gap-2"><span aria-hidden>✦</span> Ask AI</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
        </div>

        <nav className="px-2 pb-2 flex flex-col gap-4 text-sm overflow-y-auto scroll-thin">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-3 pt-1 pb-1.5 text-[0.62rem] font-mono uppercase tracking-[0.14em] text-faint">{g.group}</div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((n) => {
                  const active = pathname === n.href || pathname.startsWith(n.href + '/');
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
                        active ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-surface-2'
                      }`}
                    >
                      <Icon name={n.icon} />
                      {n.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-line text-xs shrink-0">
          <div className="font-medium text-ink truncate">{user.name}</div>
          <div className="text-faint truncate mb-2">{user.email}</div>
          <form action={logoutAction}>
            <button type="submit" className="text-steel hover:underline">Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="flex items-center px-6 justify-between border-b border-line bg-surface sticky top-0 z-30" style={{ height: 52 }}>
          <div className="font-mono text-xs text-muted uppercase tracking-wider">{title} · Faridabad</div>
          <button
            onClick={() => openAssistant()}
            className="flex items-center gap-2 text-xs text-muted hover:text-accent transition-colors"
            title="Ask AI (⌘K)"
          >
            <span className="text-accent" aria-hidden>✦</span>
            <span className="hidden sm:inline">Ask AI</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
        </header>
        <main className="p-6 flex-1 min-w-0">{children}</main>
      </div>

      <AssistantPanel enabled={aiEnabled} />
    </div>
  );
}
