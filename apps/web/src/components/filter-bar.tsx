import Link from 'next/link';

export type Chip = { value: string; label: string };

/**
 * Server-rendered search + filter chips. Uses GET navigation — no client JS,
 * URLs stay shareable/bookmarkable.
 */
export function FilterBar({
  basePath,
  q,
  placeholder,
  chipParam,
  chipValue,
  chips,
}: {
  basePath: string;
  q?: string;
  placeholder: string;
  chipParam?: string;
  chipValue?: string;
  chips?: Chip[];
}) {
  const chipHref = (v: string) => {
    const p = new URLSearchParams();
    if (q?.trim()) p.set('q', q.trim());
    if (v) p.set(chipParam!, v);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <form action={basePath} className="flex gap-2">
        {chipParam && chipValue && <input type="hidden" name={chipParam} value={chipValue} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder={placeholder}
          className="field !w-64 !py-1.5"
          aria-label="Search"
        />
        <button type="submit" className="btn-ghost !py-1.5 text-xs">Search</button>
        {q?.trim() && (
          <Link href={chipValue && chipParam ? `${basePath}?${chipParam}=${chipValue}` : basePath} className="text-xs text-steel self-center hover:underline">
            Clear
          </Link>
        )}
      </form>
      {chips && chipParam && (
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          <Link
            href={chipHref('')}
            className={`pill border ${!chipValue ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-surface-2'}`}
          >
            All
          </Link>
          {chips.map((c) => (
            <Link
              key={c.value}
              href={chipHref(c.value)}
              className={`pill border capitalize ${chipValue === c.value ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-surface-2'}`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
