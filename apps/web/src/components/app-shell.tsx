'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { logoutAction } from '@/app/login/actions';
import { AssistantPanel, openAssistant } from '@/components/assistant/assistant-panel';

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    analytics: <><path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 4-6" /></>,
    leads: <><path d="M12 21a9 9 0 1 0-9-9" /><path d="M12 17a5 5 0 1 0-5-5" /><circle cx="12" cy="12" r="1" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    quotations: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>,
    orders: <><path d="M3.3 7l8.7 5 8.7-5" /><path d="M12 22V12" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>,
    invoices: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    users: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /><path d="M19 8h3M20.5 6.5v3" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden>
      {paths[name]}
    </svg>
  );
}

const TITLES: [string, string][] = [
  ['/dashboard', 'Dashboard'], ['/analytics', 'Analytics'], ['/leads', 'Leads'], ['/customers', 'Customers'],
  ['/quotations', 'Quotations'], ['/orders', 'Order book'], ['/invoices', 'Invoices'],
  ['/settings/users', 'Users'], ['/settings/password', 'Password'], ['/guide', 'Guide'],
];

export function AppShell({
  user,
  aiEnabled,
  canManageUsers,
  children,
}: {
  user: { name: string; email: string };
  aiEnabled: boolean;
  canManageUsers: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const title = TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'MS ERP';

  // Route change closes the mobile drawer.
  useEffect(() => setNavOpen(false), [pathname]);

  const nav: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
    {
      group: 'Overview',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
        { href: '/analytics', label: 'Analytics', icon: 'analytics' },
      ],
    },
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
        { href: '/orders', label: 'Order book', icon: 'orders' },
        { href: '/invoices', label: 'Invoices', icon: 'invoices' },
      ],
    },
    ...(canManageUsers
      ? [{ group: 'Admin', items: [{ href: '/settings/users', label: 'Users & roles', icon: 'users' }] }]
      : []),
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[228px_1fr]">
      {navOpen && (
        <div className="fixed inset-0 bg-ink/25 z-40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      <aside
        className={`fixed md:sticky top-0 left-0 z-50 md:z-auto h-dvh md:h-screen w-[248px] md:w-auto
          bg-surface border-r border-line flex flex-col shadow-2xl md:shadow-none
          transition-transform duration-200 ${navOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        aria-label="Navigation"
      >
        <div className="flex items-center gap-2 px-4 border-b border-line shrink-0" style={{ height: 52 }}>
          <span className="text-accent text-lg leading-none" aria-hidden>⚙</span>
          <span className="font-semibold tracking-tight flex-1">MS Enterprises</span>
          <button
            onClick={() => setNavOpen(false)}
            className="md:hidden text-muted hover:text-ink px-1"
            aria-label="Close menu"
          >✕</button>
        </div>

        <div className="p-2 shrink-0">
          <button
            onClick={() => { setNavOpen(false); openAssistant(); }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-accent/40 bg-accent-soft/50 text-accent text-sm font-medium hover:bg-accent-soft transition-colors"
          >
            <span className="flex items-center gap-2"><span aria-hidden>✦</span> Ask AI</span>
            <kbd className="kbd hidden md:inline-block">⌘K</kbd>
          </button>
        </div>

        <nav className="px-2 pb-2 flex flex-col gap-4 text-sm overflow-y-auto scroll-thin">
          {nav.map((g) => (
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
          <div className="flex items-center gap-3">
            <Link href="/guide" className="text-steel hover:underline">Guide</Link>
            <Link href="/settings/password" className="text-steel hover:underline">Change password</Link>
            <form action={logoutAction}>
              <button type="submit" className="text-steel hover:underline">Log out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-dvh">
        <header className="flex items-center gap-3 px-4 sm:px-6 justify-between border-b border-line bg-surface sticky top-0 z-30" style={{ height: 52 }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setNavOpen(true)}
              className="md:hidden text-ink -ml-1 p-1"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="font-mono text-xs text-muted uppercase tracking-wider truncate">{title} · Faridabad</div>
          </div>
          <button
            onClick={() => openAssistant()}
            className="flex items-center gap-2 text-xs font-medium text-accent border border-accent/40 bg-accent-soft/50 hover:bg-accent-soft rounded-lg px-3 py-1.5 transition-colors shrink-0"
            title="Ask AI (⌘K)"
          >
            <span aria-hidden>✦</span>
            <span>Ask AI</span>
            <kbd className="kbd hidden sm:inline-block">⌘K</kbd>
          </button>
        </header>
        <main className="p-4 sm:p-6 flex-1 min-w-0">{children}</main>
      </div>

      <AssistantPanel enabled={aiEnabled} />
    </div>
  );
}
