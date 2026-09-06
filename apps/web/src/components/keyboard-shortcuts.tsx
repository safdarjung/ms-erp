'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ShortcutKbd } from '@/components/shortcut-kbd';
import { NAV, type NavKey } from '@/lib/nav-labels';

// Keyboard shortcuts for people at a desk. Pure client, no deps. Ignored while
// typing in a field or when a drawer/dialog is open, so it never fights input.
//   /        jump to the search box
//   g then … go to a page (see JUMP)
//   n        new quotation / order / bill on that list
//   ?        show or hide this help
//   ⌘/Ctrl-K open the AI assistant (handled by the assistant panel itself)

const JUMP: { key: string; nav: NavKey }[] = [
  { key: 'd', nav: 'dashboard' },
  { key: 'l', nav: 'leads' },
  { key: 'c', nav: 'customers' },
  { key: 'q', nav: 'quotations' },
  { key: 'o', nav: 'orders' },
  { key: 'i', nav: 'invoices' },
  { key: 'a', nav: 'analytics' },
];

const NEW_ROUTES: [string, string][] = [
  ['/quotations', '/quotations/new'],
  ['/orders', '/orders/new'],
  ['/invoices', '/invoices/new'],
];

const G_TIMEOUT_MS = 1500;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * True only when a dialog is actually on screen. The assistant drawer stays in
 * the DOM with role="dialog" while closed (display:none), so a bare selector
 * would report "a modal is open" forever and silence every shortcut.
 */
function modalOpen(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"]');
  for (const el of dialogs) {
    if (el.offsetParent !== null || el.getClientRects().length > 0) return true;
  }
  return false;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    function onKey(e: KeyboardEvent) {
      if (helpRef.current) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setHelp(false); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || modalOpen()) return;

      if (gModeRef.current) {
        gModeRef.current = false;
        if (gTimer) clearTimeout(gTimer);
        const dest = JUMP.find((j) => j.key === e.key.toLowerCase());
        if (dest) { e.preventDefault(); router.push(NAV[dest.nav].href); }
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
          setHelp(true);
          break;
        case 'g':
          gModeRef.current = true;
          gTimer = setTimeout(() => { gModeRef.current = false; }, G_TIMEOUT_MS);
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

  // Help dialog: focus goes in on open, Tab stays inside, and returns on close.
  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab);
    return () => { document.removeEventListener('keydown', onTab); previous?.focus?.(); };
  }, [help]);

  if (!help) return null;

  const rows: [React.ReactNode, string][] = [
    [<kbd key="s" className="kbd">/</kbd>, 'Jump to the search box'],
    [<kbd key="n" className="kbd">n</kbd>, 'Start a new quotation, order or bill (on that page)'],
    [<ShortcutKbd key="k" />, 'Ask AI'],
    [<kbd key="h" className="kbd">?</kbd>, 'Show or hide this list'],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 p-4"
      onClick={() => setHelp(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="card w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="shortcuts-title" className="font-semibold">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setHelp(false)}
            className="min-w-[44px] min-h-[44px] -mr-2 inline-flex items-center justify-center text-muted hover:text-ink rounded"
            aria-label="Close"
          ><span aria-hidden>✕</span></button>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map(([keys, desc]) => (
            <li key={desc} className="flex items-center justify-between gap-4">
              <span className="text-muted">{desc}</span>
              <span className="whitespace-nowrap">{keys}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-4 mb-1.5">Go to a page: press <kbd className="kbd">g</kbd>, then</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {JUMP.map((j) => (
            <li key={j.key} className="flex items-center justify-between gap-2">
              <span className="text-muted">{NAV[j.nav].label}</span>
              <kbd className="kbd">{j.key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
