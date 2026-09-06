import Link from 'next/link';
import type { ReactNode } from 'react';

// List pages render CARDS on phones (< sm) and a TABLE from sm up. These are
// tiny server-safe layout helpers so every list looks and behaves the same.
//
//   <MobileList>{rows.map((r) => <ListCard … />)}</MobileList>
//   <DesktopTable><table>…</table></DesktopTable>

/** Wrapper shown only below `sm`. */
export function MobileList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sm:hidden flex flex-col gap-2 ${className}`}>{children}</div>;
}

/** `card overflow-x-auto` wrapper shown from `sm` up. */
export function DesktopTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`hidden sm:block card overflow-x-auto ${className}`}>{children}</div>;
}

/**
 * One list row as a phone card:
 *   line 1  title (link) ………………… status pill
 *   line 2  customer / company (bold)
 *   line 3  date · detail ………………… amount (tabular)
 *   actions full-width ghost buttons
 */
export function ListCard({
  title, href, pill, line2, line3, amount, actions, className = '',
}: {
  title: ReactNode;
  href?: string;
  pill?: ReactNode;
  line2?: ReactNode;
  line3?: ReactNode;
  amount?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const heading = href
    ? <Link href={href} className="font-medium text-ink hover:text-accent hover:underline min-w-0 truncate">{title}</Link>
    : <span className="font-medium text-ink min-w-0 truncate">{title}</span>;
  return (
    <div className={`card p-3 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        {heading}
        {pill && <div className="shrink-0">{pill}</div>}
      </div>
      {line2 && <div className="text-sm font-semibold text-ink mt-0.5 break-words">{line2}</div>}
      {(line3 || amount) && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted mt-1">
          <span className="min-w-0 truncate">{line3}</span>
          {amount && <span className="tabular-nums font-mono text-ink whitespace-nowrap">{amount}</span>}
        </div>
      )}
      {actions && (
        <div className="mt-2.5 flex flex-col gap-2 [&>a]:w-full [&>button]:w-full [&>form]:w-full [&>form>button]:w-full [&>a]:justify-center [&>button]:justify-center">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Empty-state for a list: one sentence, one real button, one AI example.
 * Renders inside the table's `<td>` or in the MobileList — pass `inTable` for a
 * `<tr>` wrapper.
 */
export function EmptyState({
  message, action, hint, colSpan,
}: {
  message: ReactNode;
  action?: ReactNode;
  hint?: ReactNode;
  colSpan?: number;
}) {
  const body = (
    <div className="px-4 py-10 text-center text-muted text-sm flex flex-col items-center gap-3">
      <p>{message}</p>
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
      {hint && <p className="text-xs text-muted max-w-md">{hint}</p>}
    </div>
  );
  if (colSpan) return <tr><td colSpan={colSpan}>{body}</td></tr>;
  return <div className="card">{body}</div>;
}
