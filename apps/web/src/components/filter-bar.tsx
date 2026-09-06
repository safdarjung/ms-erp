import Link from 'next/link';

/**
 * A filter chip. `param` lets one chip live on a different query key than the
 * rest (e.g. stage chips on `?stage=` plus a "Due today" chip on `?due=`).
 */
export type Chip = { value: string; label: string; param?: string };

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * Server-rendered search + filter chips. Uses GET navigation — no client JS,
 * URLs stay shareable/bookmarkable. Chips scroll sideways on phones.
 */
export function FilterBar({
  basePath,
  q,
  placeholder = 'Search…',
  chipParam,
  chipValue,
  chips,
  params = {},
}: {
  basePath: string;
  q?: string;
  placeholder?: string;
  /** Default query key for chips without their own `param`. */
  chipParam?: string;
  /** Current value of `chipParam` in the URL. */
  chipValue?: string;
  chips?: Chip[];
  /** Current values of any extra chip params (e.g. `{ due }`). */
  params?: Record<string, string | undefined>;
}) {
  const chipKeys = Array.from(new Set([chipParam, ...(chips ?? []).map((c) => c.param)].filter(Boolean))) as string[];
  const current: Record<string, string | undefined> = { ...params, ...(chipParam ? { [chipParam]: chipValue } : {}) };
  const activeKey = chipKeys.find((k) => current[k]);
  const isActive = (c: Chip) => current[c.param ?? chipParam ?? ''] === c.value;
  const anyActive = chips?.some(isActive) ?? false;

  // Chips are exclusive: picking one clears the others but keeps the search text.
  const chipHref = (c?: Chip) => {
    const p = new URLSearchParams();
    if (q?.trim()) p.set('q', q.trim());
    if (c) p.set(c.param ?? chipParam!, c.value);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const clearHref = activeKey ? `${basePath}?${activeKey}=${encodeURIComponent(current[activeKey]!)}` : basePath;

  const chipCls = (active: boolean) =>
    `pill border min-h-[36px] py-1.5 px-3 whitespace-nowrap shrink-0 ${
      active ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-surface-2'
    }`;

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mb-4">
      <form action={basePath} className="flex gap-2 items-center w-full sm:w-auto">
        {activeKey && <input type="hidden" name={activeKey} value={current[activeKey]} />}
        <div className="relative flex-1 sm:flex-none sm:w-64">
          <SearchIcon />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder={placeholder}
            enterKeyHint="search"
            className="field !pl-9 sm:!py-1.5"
            aria-label="Search"
          />
        </div>
        <button type="submit" className="btn-ghost !py-1.5 text-xs hidden sm:inline-flex">Search</button>
        {q?.trim() && (
          <Link href={clearHref} className="text-xs text-steel hover:underline inline-flex items-center min-h-[44px] sm:min-h-0 px-2">
            Clear
          </Link>
        )}
      </form>
      {chips && chipKeys.length > 0 && (
        <div className="flex flex-nowrap overflow-x-auto scroll-thin gap-1.5 -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap sm:ml-auto">
          <Link href={chipHref()} className={chipCls(!anyActive)}>All</Link>
          {chips.map((c) => (
            <Link key={`${c.param ?? chipParam}:${c.value}`} href={chipHref(c)} className={chipCls(isActive(c))}>
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
