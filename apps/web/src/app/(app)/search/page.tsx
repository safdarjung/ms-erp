import Link from 'next/link';
import { formatINR } from '@ms/core';
import {
  globalSearch, totalHits, SEARCH_MIN_CHARS, SEARCH_MAX_CHARS,
  type SearchGroup, type SearchKind, type SearchRow,
} from '@/lib/search';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';

export const metadata = { title: 'Search' };

const PLACEHOLDER = 'Customer, phone, bill or quotation number…';

/** Singular, plain names for the "Best match" callout. */
const KIND_NAME: Record<SearchKind, string> = {
  customer: 'Customer', lead: 'Enquiry', quotation: 'Quotation', order: 'Order', invoice: 'Bill',
};

/** What each group can be found by — shown while the box is empty. */
const HINTS: Record<SearchKind, string> = {
  customer: 'A customer by name, contact person, phone, email or GSTIN',
  lead: 'An enquiry by company, person, phone or what they asked for',
  quotation: 'A quotation by its number or the customer’s name',
  order: 'An order by its number, the customer’s name or their PO number',
  invoice: 'A bill by its number or the customer’s name',
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Hints({ kinds }: { kinds: SearchKind[] }) {
  if (kinds.length === 0) return <p className="text-sm text-muted">Your role has no records to search.</p>;
  return (
    <div className="card p-4 text-sm">
      <p className="font-medium text-ink mb-2">What you can search</p>
      <ul className="list-disc pl-5 space-y-1 text-muted">
        {kinds.map((k) => <li key={k}>{HINTS[k]}</li>)}
      </ul>
      <p className="text-xs text-faint mt-3">Part of a number is enough — typing 0012 finds INV/26-27/0012.</p>
    </div>
  );
}

/** Amount (mono, tabular) over the date — the right-hand column of a row. */
function MoneyAndDate({ row, className = '' }: { row: SearchRow; className?: string }) {
  if (row.amount === null && !row.date) return null;
  return (
    <span className={`text-right shrink-0 ${className}`}>
      {row.amount !== null && <span className="block font-mono tabular-nums text-sm text-ink">{formatINR(row.amount)}</span>}
      {row.date && <span className="block text-xs text-muted whitespace-nowrap">{formatDate(row.date)}</span>}
    </span>
  );
}

function ResultRow({ row }: { row: SearchRow }) {
  return (
    <li>
      <Link href={row.href} className="flex items-center gap-3 px-4 py-2 min-h-[44px] hover:bg-surface-2/60 transition-colors">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-ink truncate">{row.title}</span>
            {row.status && <StatusPill status={row.status} label={row.statusLabel ?? undefined} />}
          </span>
          {row.subtitle && <span className="block text-xs text-muted truncate">{row.subtitle}</span>}
        </span>
        <MoneyAndDate row={row} />
        <span className="text-faint shrink-0" aria-hidden>›</span>
      </Link>
    </li>
  );
}

function ResultGroup({ group, q }: { group: SearchGroup; q: string }) {
  const headingId = `search-${group.kind}`;
  return (
    <section className="card mb-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line text-sm font-semibold">
        <span>{group.label}</span>
        <span className="text-xs font-normal text-muted tabular-nums">{group.rows.length}{group.maybeMore ? '+' : ''}</span>
      </h2>
      <ul className="divide-y divide-line">
        {group.rows.map((r) => <ResultRow key={r.id} row={r} />)}
      </ul>
      {group.maybeMore && (
        <div className="border-t border-line px-4">
          <Link href={`${group.listHref}?q=${encodeURIComponent(q)}`} className="inline-flex items-center min-h-[44px] text-sm text-steel hover:underline">
            See all in {group.label} →
          </Link>
        </div>
      )}
    </section>
  );
}

/** Shown instead of the group list when the whole search found exactly one record. */
function BestMatch({ group, row }: { group: SearchGroup; row: SearchRow }) {
  const name = KIND_NAME[group.kind];
  return (
    <div className="card p-4 mb-4 border-accent/40 bg-accent-soft/40">
      <p className="text-xs font-medium text-accent mb-1">Best match · {name}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-semibold text-ink truncate">{row.title}</span>
            {row.status && <StatusPill status={row.status} label={row.statusLabel ?? undefined} />}
          </div>
          {row.subtitle && <p className="text-sm text-muted truncate">{row.subtitle}</p>}
          <MoneyAndDate row={row} className="!text-left block mt-0.5" />
        </div>
        <Link href={row.href} className="btn-primary w-full sm:w-auto shrink-0">Open {name.toLowerCase()} →</Link>
      </div>
    </div>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: raw } = await searchParams;
  const results = await globalSearch(raw ?? '');
  const { q } = results;
  const hits = totalHits(results);
  const groups = results.groups.filter((g) => g.rows.length > 0);
  const tooShort = q.length > 0 && q.length < SEARCH_MIN_CHARS;
  const nothing = !tooShort && q !== '' && hits === 0;
  const single = hits === 1 ? groups[0] : undefined;
  const best = single?.rows[0];

  return (
    <div className="max-w-3xl">
      <p className="text-xs text-muted">Find anything</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Search</h1>

      <form method="get" action="/search" role="search" className="flex gap-2 items-center mb-5">
        <div className="relative flex-1">
          <SearchIcon />
          <input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            placeholder={PLACEHOLDER}
            enterKeyHint="search"
            autoComplete="off"
            maxLength={SEARCH_MAX_CHARS}
            className="field !pl-9"
            aria-label="Search everything"
          />
        </div>
        <button type="submit" className="btn-primary shrink-0">Search</button>
      </form>

      {q === '' && <Hints kinds={results.groups.map((g) => g.kind)} />}
      {tooShort && <p className="text-sm text-muted">Type at least {SEARCH_MIN_CHARS} letters or digits.</p>}
      {nothing && (
        <div className="card p-5 text-sm text-muted">
          Nothing matches <b className="text-ink">“{q}”</b>. Try a phone number, part of a name, or the number on the document.
        </div>
      )}
      {single && best
        ? <BestMatch group={single} row={best} />
        : groups.map((g) => <ResultGroup key={g.kind} group={g} q={q} />)}
    </div>
  );
}
