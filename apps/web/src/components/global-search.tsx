'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type KeyboardEvent } from 'react';

// Header search. From `sm` up it is a small box that grows on focus and goes
// to /search?q=… on Enter; below `sm` it is a 44px icon button that opens the
// search page (the box there has the keyboard). No deps, no state beyond the
// text — the real search runs on the server.

function MagnifierIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = q.trim();
    router.push(t ? `/search?q=${encodeURIComponent(t)}` : '/search');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') e.currentTarget.blur();
  };

  return (
    <>
      <form role="search" onSubmit={onSubmit} className="relative hidden sm:block">
        <MagnifierIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" />
        <input
          type="search"
          data-global-search
          aria-label="Search"
          placeholder="Search…  /"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="search"
          autoComplete="off"
          className="field !w-56 focus:!w-[22rem] !pl-8 !py-1.5 text-sm transition-[width] duration-150 motion-reduce:transition-none"
        />
      </form>
      <button
        type="button"
        onClick={() => router.push('/search')}
        className="sm:hidden min-w-[44px] min-h-[44px] grid place-items-center text-ink rounded-lg hover:bg-surface-2"
        aria-label="Search"
      >
        <MagnifierIcon className="w-5 h-5" />
      </button>
    </>
  );
}
