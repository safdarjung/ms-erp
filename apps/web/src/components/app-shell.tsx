'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { logoutAction } from '@/app/login/actions';
import { AssistantPanel, openAssistant } from '@/components/assistant/assistant-panel';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { ShortcutKbd } from '@/components/shortcut-kbd';
import { NAV, NAV_GROUPS, navTitleFor, type NavKey } from '@/lib/nav-labels';

// Re-exported so pages can name screens without importing the shell's internals.
export { NAV, NAV_LABELS, NAV_GROUPS } from '@/lib/nav-labels';

function Icon({ name, className = 'w-4 h-4' }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
    analytics: <><path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 4-6" /></>,
    leads: <><path d="M12 21a9 9 0 1 0-9-9" /><path d="M12 17a5 5 0 1 0-5-5" /><circle cx="12" cy="12" r="1" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    quotations: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>,
    orders: <><path d="M3.3 7l8.7 5 8.7-5" /><path d="M12 22V12" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>,
    invoices: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    users: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /><path d="M19 8h3M20.5 6.5v3" /></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" /></>,
    channels: <><path d="M4 4h16v4H4z" /><path d="M4 10h10v4H4z" /><path d="M4 16h7v4H4z" /></>,
    chat: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" /><path d="M12 17h.01" /></>,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${className} shrink-0`} aria-hidden>
      {paths[name]}
    </svg>
  );
}

type NavItem = { key: NavKey; icon: string; badge?: number };

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside `root` while a drawer/dialog is open. */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Plain-text button that opens the AI assistant with a question pre-filled. */
export function AskAiLink({ question, className, children }: { question: string; className?: string; children?: ReactNode }) {
  return (
    <button type="button" onClick={() => openAssistant(question)} className={className ?? 'text-accent hover:underline font-medium text-left'}>
      {children ?? question}
    </button>
  );
}

/** A one-line tip the person can hide for good (remembered on this device). */
export function DismissableTip({ id, children }: { id: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(`tip:${id}`) === '1'); } catch { setHidden(false); }
  }, [id]);
  if (hidden) return null;
  const hide = () => {
    try { localStorage.setItem(`tip:${id}`, '1'); } catch { /* private mode — just hide for now */ }
    setHidden(true);
  };
  return (
    <p className="text-sm text-muted mb-6 flex items-center flex-wrap gap-x-2">
      <span>{children}</span>
      <button type="button" onClick={hide} className="text-xs text-faint hover:text-ink underline min-h-[44px] sm:min-h-0 px-1">Hide this</button>
    </p>
  );
}

export function AppShell({
  user,
  aiEnabled,
  canManageUsers,
  canViewInbox,
  canManageChannels,
  canManageOutreach,
  inboxCount,
  children,
}: {
  user: { name: string; email: string };
  aiEnabled: boolean;
  canManageUsers: boolean;
  canViewInbox: boolean;
  canManageChannels: boolean;
  canManageOutreach: boolean;
  inboxCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = navTitleFor(pathname);

  // Route change closes the mobile drawer.
  useEffect(() => setNavOpen(false), [pathname]);

  // Drawer: focus its close button on open, Escape closes, Tab stays inside,
  // and focus goes back to the hamburger on close.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setNavOpen(false); return; }
      trapTab(e, asideRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [navOpen]);

  const settingsItems: NavItem[] = [
    ...(canManageUsers ? [{ key: 'users' as const, icon: 'users' }] : []),
    ...(canManageChannels ? [{ key: 'channels' as const, icon: 'channels' }] : []),
    ...(canManageOutreach ? [{ key: 'outreach' as const, icon: 'chat' }] : []),
  ];

  const nav: { group: string; items: NavItem[] }[] = [
    { group: NAV_GROUPS.home, items: [{ key: 'dashboard', icon: 'dashboard' }, { key: 'analytics', icon: 'analytics' }] },
    {
      group: NAV_GROUPS.crm,
      items: [
        { key: 'leads', icon: 'leads' },
        ...(canViewInbox ? [{ key: 'inbox' as const, icon: 'inbox', badge: inboxCount }] : []),
        { key: 'customers', icon: 'customers' },
      ],
    },
    { group: NAV_GROUPS.sales, items: [{ key: 'quotations', icon: 'quotations' }, { key: 'orders', icon: 'orders' }, { key: 'invoices', icon: 'invoices' }] },
    ...(settingsItems.length ? [{ group: NAV_GROUPS.settings, items: settingsItems }] : []),
  ];

  // Highlight only the most specific matching item (so /leads doesn't also light
  // up when you're on /leads/inbox).
  const activeHref = nav.flatMap((g) => g.items)
    .map((n) => NAV[n.key].href)
    .filter((href) => pathname === href || pathname.startsWith(href + '/'))
    .sort((a, b) => b.length - a.length)[0];

  // Phone tab bar: the four screens people open most, plus Ask AI. Same gating
  // as the sidebar (these four are visible to every role).
  const tabs: { key: NavKey; icon: string; label: string }[] = [
    { key: 'dashboard', icon: 'dashboard', label: 'Home' },
    { key: 'leads', icon: 'leads', label: 'Enquiries' },
    { key: 'quotations', icon: 'quotations', label: 'Quotations' },
    { key: 'invoices', icon: 'invoices', label: 'Bills' },
  ];

  const bottomLink = 'flex items-center gap-2.5 px-3 min-h-[40px] rounded-lg text-sm text-ink hover:bg-surface-2 w-full text-left';

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[228px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:bg-accent focus:text-white focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to content
      </a>

      {navOpen && (
        <div className="fixed inset-0 bg-ink/25 z-40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      <aside
        ref={asideRef}
        role={navOpen ? 'dialog' : undefined}
        aria-modal={navOpen ? 'true' : undefined}
        className={`fixed md:sticky top-0 left-0 z-50 md:z-auto h-dvh md:h-screen w-[280px] max-w-[85vw] md:max-w-none md:w-auto
          bg-surface border-r border-line flex flex-col shadow-2xl md:shadow-none
          transition-transform duration-200 ${navOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        aria-label="Menu"
      >
        <div className="flex items-center gap-2 pl-4 pr-1 border-b border-line shrink-0" style={{ height: 52 }}>
          <span className="text-accent text-lg leading-none" aria-hidden>⚙</span>
          <span className="font-semibold tracking-tight flex-1">MS Enterprises</span>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setNavOpen(false)}
            className="md:hidden min-w-[44px] min-h-[44px] grid place-items-center text-muted hover:text-ink rounded-lg"
            aria-label="Close menu"
          ><span aria-hidden>✕</span></button>
        </div>

        <div className="p-2 shrink-0">
          <button
            type="button"
            onClick={() => { setNavOpen(false); openAssistant(); }}
            className="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-accent/40 bg-accent-soft/50 text-accent text-sm font-medium hover:bg-accent-soft transition-colors"
          >
            <span className="flex items-center gap-2"><Icon name="sparkle" /> Ask AI</span>
            <ShortcutKbd className="hidden md:inline-block" />
          </button>
        </div>

        <nav className="px-2 pb-2 flex flex-col gap-4 text-sm overflow-y-auto scroll-thin" aria-label="Pages">
          {nav.map((g) => (
            <div key={g.group}>
              <div className="px-3 pt-1 pb-1.5 text-xs text-muted font-medium">{g.group}</div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((n) => {
                  const { href, label } = NAV[n.key];
                  const active = href === activeHref;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2.5 px-3 min-h-[40px] py-2 rounded-lg transition-colors ${
                        active ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-surface-2'
                      }`}
                    >
                      <Icon name={n.icon} />
                      <span className="flex-1">{label}</span>
                      {n.badge ? (
                        <span
                          className="min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-accent text-white text-[0.65rem] font-semibold text-center leading-none"
                          aria-label={`${n.badge} enquiries need review`}
                          title={`${n.badge} enquiries need review`}
                        >
                          {n.badge > 99 ? '99+' : n.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto p-2 border-t border-line text-xs shrink-0">
          <div className="px-3 pt-1 pb-2">
            <div className="font-medium text-ink truncate">{user.name}</div>
            <div className="text-muted truncate">{user.email}</div>
          </div>
          <Link href={NAV.guide.href} className={bottomLink}><Icon name="help" /> {NAV.guide.label}</Link>
          <Link href={NAV.password.href} className={bottomLink}><Icon name="lock" /> {NAV.password.label}</Link>
          <div className="border-t border-line my-1" role="separator" />
          <form action={logoutAction}>
            <button type="submit" className={bottomLink}><Icon name="logout" /> Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-dvh">
        <header className="flex items-center gap-2 pl-1 pr-3 sm:px-6 justify-between border-b border-line bg-surface sticky top-0 z-30" style={{ height: 52 }}>
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="md:hidden min-w-[44px] min-h-[44px] grid place-items-center text-ink rounded-lg"
              aria-label="Open menu"
              aria-expanded={navOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <p className="text-sm font-medium text-ink truncate sm:pl-0 pl-1">{title}</p>
          </div>
          <button
            type="button"
            onClick={() => openAssistant()}
            className="min-h-[40px] flex items-center gap-2 text-xs font-medium text-accent border border-accent/40 bg-accent-soft/50 hover:bg-accent-soft rounded-lg px-3 py-1.5 transition-colors shrink-0"
          >
            <Icon name="sparkle" className="w-3.5 h-3.5" />
            <span>Ask AI</span>
            <ShortcutKbd className="hidden sm:inline-block" />
          </button>
        </header>
        <main id="main" className="px-4 pt-4 pb-20 sm:px-6 sm:pt-6 md:pb-6 flex-1 min-w-0" tabIndex={-1}>{children}</main>
      </div>

      <nav
        aria-label="Quick navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-14">
          {tabs.map((t) => {
            const { href } = NAV[t.key];
            const active = href === activeHref;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 text-xs min-w-0 px-0.5 ${active ? 'text-accent font-medium' : 'text-muted'}`}
              >
                <Icon name={t.icon} className="w-5 h-5" />
                <span className="truncate max-w-full">{t.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => openAssistant()}
            className="flex flex-col items-center justify-center gap-0.5 text-xs text-accent font-medium"
          >
            <Icon name="sparkle" className="w-5 h-5" />
            <span>Ask AI</span>
          </button>
        </div>
      </nav>

      <AssistantPanel enabled={aiEnabled} />
      <KeyboardShortcuts />
    </div>
  );
}
