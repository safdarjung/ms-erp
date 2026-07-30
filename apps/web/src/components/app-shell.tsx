'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { logoutAction } from '@/app/login/actions';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/leads', label: 'Leads' },
  { href: '/customers', label: 'Customers' },
  { href: '/quotations', label: 'Quotations' },
  { href: '/invoices', label: 'Invoices' },
];

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[220px_1fr]">
      <aside className="border-r border-line bg-surface flex flex-col">
        <div className="flex items-center gap-2 px-4 border-b border-line" style={{ height: 52 }}>
          <span className="text-accent text-lg leading-none" aria-hidden>⚙</span>
          <span className="font-semibold tracking-tight">MS Enterprises</span>
        </div>
        <nav className="p-2 flex flex-col gap-1 text-sm">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-2 rounded transition-colors ${
                  active ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-surface-2'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3 border-t border-line text-xs">
          <div className="font-medium text-ink truncate">{user.name}</div>
          <div className="text-faint truncate mb-2">{user.email}</div>
          <form action={logoutAction}>
            <button type="submit" className="text-steel hover:underline">Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="flex items-center px-6 justify-between border-b border-line bg-surface" style={{ height: 52 }}>
          <div className="font-mono text-xs text-muted uppercase tracking-wider">Faridabad · Phase 1</div>
          <div className="font-mono text-[0.68rem] text-faint">v0</div>
        </header>
        <main className="p-6 flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
