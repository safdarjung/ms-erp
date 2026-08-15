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

/** "Showing 1–50 of 214" with Prev/Next. Renders the count line even on one page. */
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
    <div className="flex items-center justify-between gap-3 mt-3 text-xs text-muted">
      <span>
        {total === 0
          ? 'No results'
          : <>Showing <b className="text-ink font-medium tabular-nums">{from}–{to}</b> of <span className="tabular-nums">{total}</span></>}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {page > 1
            ? <Link href={href(basePath, params, { page: String(page - 1) })} className="btn-ghost !py-1 !px-2.5 !text-xs" rel="prev" aria-label="Previous page">← Prev</Link>
            : <span className="btn-ghost !py-1 !px-2.5 !text-xs opacity-40 pointer-events-none">← Prev</span>}
          <span className="px-2 tabular-nums">Page {page} / {totalPages}</span>
          {page < totalPages
            ? <Link href={href(basePath, params, { page: String(page + 1) })} className="btn-ghost !py-1 !px-2.5 !text-xs" rel="next" aria-label="Next page">Next →</Link>
            : <span className="btn-ghost !py-1 !px-2.5 !text-xs opacity-40 pointer-events-none">Next →</span>}
        </div>
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
  const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '↕';
  return (
    <Link
      href={href(basePath, params, { sort: `${col}:${nextDir}`, page: undefined })}
      className={`inline-flex items-center gap-1 hover:text-ink transition-colors ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-ink' : ''}`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span className={`text-[0.85em] ${active ? 'text-accent' : 'text-faint'}`} aria-hidden>{arrow}</span>
    </Link>
  );
}
