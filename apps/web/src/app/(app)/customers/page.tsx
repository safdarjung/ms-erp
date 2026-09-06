import Link from 'next/link';
import { GST_STATE_NAMES } from '@ms/core';
import { listCustomers } from '@/lib/queries';
import { normalizeWaNumber } from '@/lib/outreach';
import { requireUser, can } from '@/lib/rbac';
import { NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ExportLink } from '@/components/export-link';
import { StatusPill } from '@/components/status-pill';
import { WhatsappButton } from '@/components/whatsapp-button';
import { MobileList, DesktopTable, ListCard, EmptyState } from '@/components/list-cards';
import { AskAiLink } from '@/components/app-shell';
import { CustomerForm } from './customer-form';

export const metadata = { title: 'Customers' };

const NEW_HREF = '/customers?new=1#new-customer';
const AI_EXAMPLE = 'Sharma Auto naam ka customer banao, phone 98xxxxxxxx';

function termsLabel(days: number): string {
  return days > 0 ? `Due in ${days} days` : 'Due immediately';
}

function stateName(code: string | null): string {
  if (!code) return '—';
  return GST_STATE_NAMES[code] ?? code;
}

/** Plain wa.me link (no pre-filled text) for a customer's phone. */
function waHref(phone: string | null): string | null {
  const n = normalizeWaNumber(phone);
  return n ? `https://wa.me/${n}` : null;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; archived?: string; new?: string }>;
}) {
  const { q, page, sort, archived, new: isNew } = await searchParams;
  const user = await requireUser();
  const showArchived = archived === '1';
  const { rows, total, page: current, pageSize } = await listCustomers({ q, page: Number(page), sort, archived: showArchived });
  const canCreate = can(user, 'customer.create');
  const openNew = canCreate && isNew === '1';
  const params = { q, sort, archived };
  const exportHref = `/export/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const filtered = Boolean(q || showArchived);

  const newButton = canCreate && <Link href={NEW_HREF} className="btn-primary w-full sm:w-auto">+ New customer</Link>;
  const empty = (colSpan?: number) => (
    <EmptyState
      colSpan={colSpan}
      message={filtered ? <>Nothing matches this filter. <Link href="/customers" className="text-steel hover:underline">Clear →</Link></> : 'No customers yet.'}
      action={!filtered && newButton}
      hint={!filtered && <>or ask AI: <AskAiLink question={AI_EXAMPLE}>&ldquo;{AI_EXAMPLE}&rdquo;</AskAiLink></>}
    />
  );

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted">{NAV_GROUPS.crm}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <div className="flex flex-wrap items-center gap-2">
          {newButton}
          <ExportLink href={exportHref} />
        </div>
      </div>

      {canCreate && (
        <details id="new-customer" className="reveal card mb-5 scroll-mt-16" open={openNew}>
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-[44px]">
            <span className="chev" aria-hidden>›</span> New customer
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4"><CustomerForm /></div>
        </details>
      )}

      <FilterBar
        basePath="/customers"
        q={q}
        placeholder="Search name, phone, GSTIN…"
        chipParam="archived"
        chipValue={archived}
        chips={[{ value: '1', label: 'Show hidden (archived)' }]}
      />

      <MobileList>
        {rows.map((c) => {
          const wa = waHref(c.phone);
          return (
            <ListCard
              key={c.id}
              title={c.name}
              href={`/customers/${c.id}`}
              pill={c.status === 'archived' ? <StatusPill status="archived" label="Archived" /> : undefined}
              line2={c.contactPerson ?? undefined}
              line3={c.phone ?? 'No phone saved'}
              amount={termsLabel(c.creditTermsDays)}
              actions={c.phone ? (
                <>
                  <a href={`tel:${c.phone}`} className="btn-ghost text-sm">Call {c.phone}</a>
                  {wa && <div className="[&>a]:w-full [&>a]:justify-center [&>a]:min-h-[44px] [&>a]:text-sm"><WhatsappButton href={wa} /></div>}
                </>
              ) : undefined}
            />
          );
        })}
        {rows.length === 0 && empty()}
      </MobileList>

      <DesktopTable>
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/customers" params={params} col="name" label="Name" /></th>
              <th>Contact</th>
              <th>Phone</th>
              <th>State</th>
              <th>GSTIN</th>
              <th className="text-right"><SortLink basePath="/customers" params={params} col="credit" label="Payment terms" align="right" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const wa = waHref(c.phone);
              return (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                  <td className="font-medium text-ink">
                    <Link href={`/customers/${c.id}`} className="hover:text-accent hover:underline">{c.name}</Link>
                    {c.status === 'archived' && <StatusPill status="archived" label="Archived" className="ml-2" />}
                    {c.address && <div className="text-xs text-muted font-normal truncate max-w-[16rem]">{c.address}</div>}
                  </td>
                  <td>{c.contactPerson ?? '—'}</td>
                  <td className="whitespace-nowrap">
                    {c.phone ? (
                      <span className="inline-flex items-center gap-2">
                        <a href={`tel:${c.phone}`} className="text-steel hover:underline">{c.phone}</a>
                        {wa && <WhatsappButton href={wa} />}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="text-muted">{stateName(c.stateCode)}</td>
                  <td className="font-mono text-xs">{c.gstin ?? '—'}</td>
                  <td className="text-right whitespace-nowrap">{termsLabel(c.creditTermsDays)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && empty(6)}
          </tbody>
        </table>
      </DesktopTable>
      <Pagination basePath="/customers" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
