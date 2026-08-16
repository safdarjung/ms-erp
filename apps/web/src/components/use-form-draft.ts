'use client';
import { useEffect, useRef, useState } from 'react';

const PREFIX = 'msdraft:';

const safeStringify = (v: unknown): string => {
  try { return JSON.stringify(v); } catch { return ''; }
};

/**
 * Autosave a form snapshot to localStorage so heavy edits survive a refresh,
 * crash or accidental navigation. Returns the draft found on mount (for a
 * "restore?" prompt) and a `clear()` to drop it after a successful save.
 *
 * It deliberately does NOT overwrite a stored draft until the user actually
 * edits something — so a draft from a previous session stays intact long enough
 * to be offered back, instead of being clobbered by the freshly-initialised form.
 */
export function useFormDraft<T>(key: string, value: T, enabled = true): { draft: T | null; clear: () => void } {
  const storageKey = PREFIX + key;
  const [draft] = useState<T | null>(() => {
    if (!enabled || typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  });
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const s = safeStringify(value);
    if (baseline.current === null) { baseline.current = s; return; } // record the initial form, don't write yet
    if (s === baseline.current) return;                              // still untouched — keep any prior draft intact
    try { window.localStorage.setItem(storageKey, s); } catch { /* quota / disabled — non-fatal */ }
  }, [storageKey, value, enabled]);

  const clear = () => {
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  };
  return { draft, clear };
}
