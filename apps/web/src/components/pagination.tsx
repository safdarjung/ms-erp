import Link from 'next/link';

// Server-rendered, URL-based pagination + sortable headers. No client JS — page
// and sort live in the query string so every view stays shareable/bookmarkable.

export type ListParams = Record<string, string | undefined>;

function href(basePath: string, params: ListParams, override: ListParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...override })) {
    if (v != null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `${basePath}?${s}` : basePath;
}

const PAGE_BTN = 'btn-ghost min-h-[40px] !py-1.5 !px-3 !text-xs w-full sm:w-auto';

/** "Showing 1–50 of 214" with Previous/Next. Renders the count line even on one page. */
export function Pagination({
  basePath, params, page, pageSize, total,
}: {
  basePath: string;
  params: ListParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3 text-xs text-muted">
      {/* Empty is already said properly by the list's own empty state — don't say it twice. */}
      <span>
        {total > 0 && <>Showing <b className="text-ink font-medium tabular-nums">{from}–{to}</b> of <span className="tabular-nums">{total}</span></>}
      </span>
      {totalPages > 1 && (
        <nav className="grid grid-cols-[1fr_auto_1fr] sm:flex items-center gap-2" aria-label="Pages">
          {page > 1
            ? <Link href={href(basePath, params, { page: String(page - 1) })} className={PAGE_BTN} rel="prev" aria-label="Previous page">← Previous</Link>
            : <span className={`${PAGE_BTN} opacity-40 pointer-events-none`} aria-hidden>← Previous</span>}
          <span className="px-2 tabular-nums text-center">Page {page} / {totalPages}</span>
          {page < totalPages
            ? <Link href={href(basePath, params, { page: String(page + 1) })} className={PAGE_BTN} rel="next" aria-label="Next page">Next →</Link>
            : <span className={`${PAGE_BTN} opacity-40 pointer-events-none`} aria-hidden>Next →</span>}
        </nav>
      )}
    </div>
  );
}

/**
 * A clickable column header that toggles sort direction via the URL `sort` param
 * ("col:asc" | "col:dir"). Clicking resets to page 1. `col` MUST be a key the
 * query's server-side whitelist accepts, or the sort is ignored.
 */
export function SortLink({
  basePath, params, col, label, align,
}: {
  basePath: string;
  params: ListParams;
  col: string;
  label: string;
  align?: 'right';
}) {
  const [cur, dir] = (params.sort ?? '').split(':');
  const active = cur === col;
  const nextDir = active && dir !== 'asc' ? 'asc' : 'desc';
  return (
    <Link
      href={href(basePath, params, { sort: `${col}:${nextDir}`, page: undefined })}
      className={`inline-flex items-center gap-1 hover:text-ink transition-colors ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-ink' : ''}`}
      title="Tap to sort"
      aria-label={`Sort by ${label}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {active && <span className="text-[0.85em] text-accent" aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span>}
    </Link>
  );
}
