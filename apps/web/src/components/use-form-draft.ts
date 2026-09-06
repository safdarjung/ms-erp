'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'msdraft:';

const safeStringify = (v: unknown): string => {
  try { return JSON.stringify(v); } catch { return ''; }
};

type Envelope<T> = { savedAt: number; data: T };
const isEnvelope = <T,>(v: unknown): v is Envelope<T> =>
  !!v && typeof v === 'object' && 'savedAt' in v && 'data' in v && typeof (v as Envelope<T>).savedAt === 'number';

/** Storage key for a form draft — exported so a destination page can clear it after a confirmed save. */
export const draftStorageKey = (key: string) => PREFIX + key;

/** Remove a stored draft by its form key (safe to call anywhere on the client). */
export function clearFormDraft(key: string) {
  try { window.localStorage.removeItem(draftStorageKey(key)); } catch { /* non-fatal */ }
}

/**
 * Autosave a form snapshot to localStorage so heavy edits survive a refresh,
 * crash or accidental navigation. Returns the draft found on mount (with when it
 * was saved, for a "continue?" banner), a `save()` to write the current snapshot
 * right now, and a `clear()` to drop it.
 *
 * It deliberately does NOT overwrite a stored draft until the user actually
 * edits something — so a draft from a previous session stays intact long enough
 * to be offered back, instead of being clobbered by the freshly-initialised form.
 *
 * The draft is NOT cleared on submit: a save can still fail server-side. The
 * destination page clears it once the save is confirmed (see `clearFormDraft`).
 */
export function useFormDraft<T>(key: string, value: T, enabled = true): {
  draft: T | null; savedAt: number | null; save: () => void; clear: () => void;
} {
  const storageKey = draftStorageKey(key);
  // Read after mount: the server can't see localStorage, so reading in the
  // initialiser would make the first client frame differ from the server's.
  const [found, setFound] = useState<Envelope<T> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      setFound(isEnvelope<T>(parsed) ? parsed : { savedAt: 0, data: parsed as T });
    } catch { /* unreadable draft — ignore */ }
  }, [storageKey, enabled]);
  const baseline = useRef<string | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const write = useCallback((v: T) => {
    const s = safeStringify({ savedAt: Date.now(), data: v });
    if (!s) return;
    try { window.localStorage.setItem(storageKey, s); } catch { /* quota / disabled — non-fatal */ }
  }, [storageKey]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const s = safeStringify(value);
    if (baseline.current === null) { baseline.current = s; return; } // record the initial form, don't write yet
    if (s === baseline.current) return;                              // still untouched — keep any prior draft intact
    write(value);
  }, [value, enabled, write]);

  const save = useCallback(() => { if (enabled) write(latest.current); }, [enabled, write]);
  const clear = useCallback(() => {
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [storageKey]);

  return { draft: found?.data ?? null, savedAt: found?.savedAt || null, save, clear };
}
