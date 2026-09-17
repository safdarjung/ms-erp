'use client';
import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type FormEvent, type KeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatINR } from '@ms/core';
import { formatDate } from '@/lib/format';
import type { ItemSuggestion } from '@/lib/price-history';

// "Type an item, get its last price." Wraps a description input with an ARIA
// combobox that lists past quotation / bill lines matching what was typed; one
// tap (or ↵) hands the pick back to the editor, which fills the row. The list is
// portalled to <body> with fixed positioning so the editor's horizontally
// scrolling table never clips it.

export type { ItemSuggestion };

const MIN_CHARS = 2;
const MAX_CHARS = 80;
const DEBOUNCE_MS = 200;
const CACHE_MAX = 20;
/** After a 401 / 403 stop asking for a while — the answer won't change mid-session. */
const BLOCK_MS = 5 * 60_000;

const cache = new Map<string, ItemSuggestion[]>();
let blockedUntil = 0;

const normalize = (q: string) => q.trim().replace(/\s+/g, ' ').slice(0, MAX_CHARS).toLowerCase();

/** Keep the last CACHE_MAX queries, most recently used last. */
function remember(key: string, items: ItemSuggestion[]) {
  cache.delete(key);
  cache.set(key, items);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Only keep rows shaped like a suggestion — a malformed reply must not break the editor. */
function sanitize(x: unknown): ItemSuggestion[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is ItemSuggestion => {
    if (!s || typeof s !== 'object') return false;
    const o = s as Record<string, unknown>;
    return typeof o.description === 'string' && typeof o.lastRate === 'number';
  });
}

/**
 * Past lines matching `q` (≥ 2 characters), debounced and cached. Never throws —
 * offline, aborted or refused simply means no suggestions. While a new query is
 * in flight the previous list stays, so the dropdown doesn't flicker per keystroke.
 */
export function useItemSuggestions(q: string): ItemSuggestion[] {
  const key = normalize(q);
  const [state, setState] = useState<{ key: string; items: ItemSuggestion[] }>({ key: '', items: [] });

  useEffect(() => {
    if (key.length < MIN_CHARS) { setState({ key, items: [] }); return; }
    const hit = cache.get(key);
    if (hit) { remember(key, hit); setState({ key, items: hit }); return; }
    if (Date.now() < blockedUntil) { setState({ key, items: [] }); return; }

    const ctrl = new AbortController();
    let cancelled = false;
    const timer = setTimeout(async () => {
      let items: ItemSuggestion[] = [];
      try {
        const res = await fetch(`/api/items/suggest?q=${encodeURIComponent(key)}`, {
          signal: ctrl.signal, credentials: 'same-origin', headers: { accept: 'application/json' },
        });
        if (res.status === 401 || res.status === 403) {
          blockedUntil = Date.now() + BLOCK_MS;
        } else if (res.ok) {
          const body = (await res.json()) as { items?: unknown } | null;
          items = sanitize(body?.items);
          remember(key, items);
        }
      } catch {
        // Aborted (a newer query took over) or offline — no suggestions either way.
      }
      if (!cancelled) setState({ key, items });
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [key]);

  return state.items;
}

/** Spread these onto the wrapped <input>; the editor keeps its own value/onChange/ids. */
export type SuggestInputProps = Partial<{
  ref: (el: HTMLInputElement | null) => void;
  role: 'combobox';
  autoComplete: 'off';
  'aria-autocomplete': 'list';
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-activedescendant': string;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onInput: (e: FormEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}>;

type Pos = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };
const GAP = 4;
const MARGIN = 8;
const MIN_WIDTH = 320;
const MAX_HEIGHT = 320;
const MIN_HEIGHT = 150;

/** Fixed-position box under the input (above it when the keyboard / bottom edge leaves no room). */
function placeUnder(r: DOMRect): Pos {
  const vw = window.innerWidth;
  const vv = window.visualViewport;
  const visTop = vv?.offsetTop ?? 0;
  const visBottom = visTop + (vv?.height ?? window.innerHeight);
  const width = Math.min(Math.max(r.width, MIN_WIDTH), vw - MARGIN * 2);
  const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, vw - MARGIN - width));
  const below = visBottom - r.bottom - GAP - MARGIN;
  const above = r.top - visTop - GAP - MARGIN;
  if (below >= MIN_HEIGHT || below >= above) {
    return { top: r.bottom + GAP, left, width, maxHeight: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, below)) };
  }
  return { bottom: window.innerHeight - r.top + GAP, left, width, maxHeight: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, above)) };
}

const isName = (s: string | null | undefined): s is string => !!s && s.trim() !== '' && s.trim() !== '—';

/** "₹30,000 · HSN 84807100 · NOS · 18% · Sharma Auto · 12 Aug 2026" */
function metaLine(s: ItemSuggestion): string {
  return [
    formatINR(s.lastRate),
    s.hsn ? `HSN ${s.hsn}` : null,
    isName(s.uom) ? s.uom : null,
    `${s.gstRate}%`,
    isName(s.lastCustomer) ? s.lastCustomer : null,
    s.lastDate ? formatDate(s.lastDate) : null,
  ].filter((x): x is string => !!x).join(' · ');
}

/** "used 4× · ₹28,000–₹32,000" (range only when the rate actually varied). */
function usageLine(s: ItemSuggestion): string | null {
  if (!(s.times > 1)) return null;
  const range = s.minRate !== s.maxRate ? ` · ${formatINR(s.minRate)}–${formatINR(s.maxRate)}` : '';
  return `used ${s.times}×${range}`;
}

/**
 * ARIA combobox around a description input. `children` renders the input and
 * spreads the given props onto it, so the editor keeps full control of the
 * element (ids, data-* attributes, value, onChange). Opens only after the user
 * has typed ≥ 2 characters and there is something to show; ↑ ↓ move, ↵ picks,
 * Esc / Tab / clicking away close.
 */
export function ItemSuggestBox({ value, enabled = true, onPick, children }: {
  value: string;
  enabled?: boolean;
  onPick: (s: ItemSuggestion) => void;
  children: (props: SuggestInputProps) => ReactNode;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // "armed" = the user has typed since the list was last closed. Programmatic
  // value changes (a pick, the assistant filling a row) never open it.
  const [armed, setArmed] = useState(false);
  // -1 = nothing highlighted: Enter then leaves the user's own typing alone.
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const items = useItemSuggestions(enabled && armed ? value : '');
  const open = enabled && armed && items.length > 0;
  const optId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => { setActive(-1); }, [items]);

  // Track the input while open — the table scrolls sideways, the page scrolls,
  // and a phone keyboard resizes the visual viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = inputRef.current;
      if (el) setPos(placeUnder(el.getBoundingClientRect()));
    };
    update();
    const vv = window.visualViewport;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [open]);

  // Close on a press anywhere outside the input and the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setArmed(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const pick = (s: ItemSuggestion) => { setArmed(false); onPick(s); };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => (i + 1) % items.length); break;
      case 'ArrowUp': e.preventDefault(); setActive((i) => (i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length)); break;
      case 'Enter': {
        // Only a highlighted suggestion is taken — a freshly typed new item is never replaced.
        const s = active >= 0 ? items[Math.min(active, items.length - 1)] : undefined;
        if (s) { e.preventDefault(); pick(s); }
        break;
      }
      // Only the list should close — not a dialog the editor may be sitting in.
      case 'Escape': e.preventDefault(); e.stopPropagation(); setArmed(false); break;
      case 'Tab': setArmed(false); break;
      default: break;
    }
  };

  const inputProps: SuggestInputProps = enabled ? {
    ref: (el) => { inputRef.current = el; },
    role: 'combobox',
    autoComplete: 'off',
    'aria-autocomplete': 'list',
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open && active >= 0 ? optId(active) : undefined,
    onKeyDown,
    onInput: () => setArmed(true),
    onBlur: () => setArmed(false),
  } : {};

  const list = open && pos ? createPortal(
    <div
      ref={listRef} id={listId} role="listbox" aria-label="Past items"
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
      className="z-[80] flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-sm shadow-lg"
    >
      <div className="min-h-0 overflow-y-auto scroll-thin">
        {items.map((s, i) => {
          const usage = usageLine(s);
          return (
            <div
              key={`${i}:${s.description}`} id={optId(i)} role="option" aria-selected={i === active}
              // mousedown (not click) + preventDefault: the input keeps focus, so
              // its blur can't close the list before the pick lands.
              onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
              className={`min-h-11 cursor-pointer border-b border-line px-3 py-2 last:border-0 ${i === active ? 'bg-accent-soft' : ''}`}
            >
              <div className="font-medium text-ink line-clamp-2 break-words">{s.description}</div>
              <div className="text-xs text-muted break-words">{metaLine(s)}</div>
              {usage && <div className="text-xs text-faint">{usage}</div>}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-line bg-surface-2 px-3 py-1.5 text-[11px] text-faint">
        ↓ then ↵ (or tap) to use · rates are from past quotations and bills
      </div>
    </div>,
    document.body,
  ) : null;

  return <>{children(inputProps)}{list}</>;
}
