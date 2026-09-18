'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Light / Dark / Auto switch. **Light is the default** — the app never changes
 * its own appearance because a phone happens to be in dark mode; dark is only
 * ever shown when someone picks Dark (or picks Auto to follow the device).
 * The choice is remembered in localStorage['ms-theme'] and restored before
 * first paint by the inline script in app/layout.tsx.
 * The choice is `data-theme` on <html>; globals.css keys every colour off it.
 * No dependencies. Not mounted here — the app shell places it.
 */

/** What the person chose. 'system' = follow the phone / PC setting. */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ms-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
/** What the server (and the first client render) assumes, to avoid hydration mismatches. */
const SERVER_SNAPSHOT = 'light:light';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // 'system' is stored only when the person actively chooses Auto; anything
    // else (including nothing stored yet) means Light.
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Keep the browser chrome / Android status bar the same colour as the page. */
function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!bg) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

/** Put the choice on <html>; removing the attribute means "follow the phone". */
function applyPreference(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncThemeColorMeta();
}

// --- external store: localStorage choice + the OS preference -----------------
const listeners = new Set<() => void>();
const notifyAll = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = window.matchMedia(DARK_QUERY);
  // OS flipped (sunset, scheduled dark mode): CSS already re-themed the page;
  // we only refresh what this hook reports and the status-bar colour.
  const onSystemChange = () => {
    if (readPreference() === 'system') syncThemeColorMeta();
    listener();
  };
  // Choice made in another tab of the app.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    applyPreference(readPreference());
    listener();
  };
  mq.addEventListener('change', onSystemChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorage);
  };
}
const getSnapshot = () => `${readPreference()}:${systemTheme()}`;
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** The person's choice, what is actually showing, and a setter that applies + remembers it. */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [preference, system] = snapshot.split(':') as [ThemePreference, ResolvedTheme];

  // A remembered Light/Dark was applied before paint by layout.tsx's script;
  // the <meta theme-color> tags still need to catch up once we are on the client.
  useEffect(() => {
    syncThemeColorMeta();
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      // Auto is stored too — absence of a value must keep meaning Light.
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / storage blocked: the choice still applies to this page view */
    }
    applyPreference(next);
    notifyAll();
  }, []);

  return { preference, resolved: preference === 'system' ? system : preference, setPreference };
}

const OPTIONS: { value: ThemePreference; label: string; icon: string; hint: string }[] = [
  { value: 'light', label: 'Light', icon: '☀', hint: 'Always light' },
  { value: 'dark', label: 'Dark', icon: '☾', hint: 'Always dark' },
  { value: 'system', label: 'Auto', icon: '◐', hint: 'Follow the phone / PC setting' },
];

/** Compact three-way segmented control; every segment is a 44px thumb target. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div role="group" aria-label="Colour theme" className={`inline-flex w-full rounded-lg border border-line-strong bg-surface-2 p-0.5 ${className}`}>
      {OPTIONS.map((o) => {
        const active = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setPreference(o.value)}
            aria-pressed={active}
            title={o.value === 'system' ? `${o.hint} (now ${resolved})` : o.hint}
            className={`flex-1 min-w-[44px] min-h-[44px] inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors ${
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <span aria-hidden>{o.icon}</span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
