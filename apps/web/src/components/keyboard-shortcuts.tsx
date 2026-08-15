'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Global keyboard shortcuts for power users. Pure client, no deps. Ignored while
// typing in a field or when a modal/assistant is open, so it never fights input.
//   /        focus the page search
//   g then … jump: d dashboard · a analytics · l leads · c customers · q quotations · o orders · i invoices
//   n        new document on a list that has one (quotation/order/invoice)
//   ?        toggle this help
//   ⌘/Ctrl-K open the AI assistant (handled by the assistant panel itself)

const NAV: Record<string, { href: string; label: string }> = {
  d: { href: '/dashboard', label: 'Dashboard' },
  a: { href: '/analytics', label: 'Analytics' },
  l: { href: '/leads', label: 'Leads' },
  c: { href: '/customers', label: 'Customers' },
  q: { href: '/quotations', label: 'Quotations' },
  o: { href: '/orders', label: 'Orders' },
  i: { href: '/invoices', label: 'Invoices' },
};

const NEW_ROUTES: [string, string][] = [
  ['/quotations', '/quotations/new'],
  ['/orders', '/orders/new'],
  ['/invoices', '/invoices/new'],
];

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function modalOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"], [role="dialog"]');
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [help, setHelp] = useState(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const gModeRef = useRef(false);
  const helpRef = useRef(false);
  helpRef.current = help;

  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && helpRef.current) { setHelp(false); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || modalOpen()) return;

      if (gModeRef.current) {
        gModeRef.current = false;
        if (gTimer) clearTimeout(gTimer);
        const dest = NAV[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); router.push(dest.href); }
        return;
      }

      switch (e.key) {
        case '/': {
          const input = document.querySelector('input[type="search"], input[name="q"]') as HTMLInputElement | null;
          if (input) { e.preventDefault(); input.focus(); input.select(); }
          break;
        }
        case '?':
          e.preventDefault();
          setHelp((h) => !h);
          break;
        case 'g':
          gModeRef.current = true;
          gTimer = setTimeout(() => { gModeRef.current = false; }, 1500);
          break;
        case 'n': {
          const hit = NEW_ROUTES.find(([p]) => pathRef.current === p || pathRef.current.startsWith(p + '/'));
          if (hit) { e.preventDefault(); router.push(hit[1]); }
          break;
        }
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (gTimer) clearTimeout(gTimer); };
  }, [router]);

  if (!help) return null;

  const rows: [string, string][] = [
    ['/', 'Focus search'],
    ['g then d / l / c / q / o / i / a', 'Jump to a section'],
    ['n', 'New document (on quotations / orders / invoices)'],
    ['⌘ / Ctrl + K', 'Ask AI'],
    ['?', 'Show / hide this help'],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setHelp(false)}
    >
      <div className="card w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Keyboard shortcuts</h2>
          <button onClick={() => setHelp(false)} className="text-muted hover:text-ink px-1" aria-label="Close">✕</button>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map(([keys, desc]) => (
            <li key={desc} className="flex items-center justify-between gap-4">
              <span className="text-muted">{desc}</span>
              <kbd className="kbd whitespace-nowrap">{keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
