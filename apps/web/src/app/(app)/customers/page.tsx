import Link from 'next/link';
import { listCustomers } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { FilterBar } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ExportLink } from '@/components/export-link';
import { ConfirmButton } from '@/components/confirm-button';
import { StatusPill } from '@/components/status-pill';
import { CustomerForm } from './customer-form';
import { deleteCustomerAction } from './actions';

export const metadata = { title: 'Customers' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}) {
  const { q, page, sort } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize } = await listCustomers({ q, page: Number(page), sort });
  const canDelete = can(user, 'customer.delete');
  const params = { q, sort };
  const exportHref = `/export/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM</p>
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <ExportLink href={exportHref} />
      </div>

      {can(user, 'customer.create') && (
        <details className="reveal card mb-5">
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
            <span className="chev" aria-hidden>›</span> Add a customer
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4"><CustomerForm /></div>
        </details>
      )}

      <FilterBar basePath="/customers" q={q} placeholder="Search name, GSTIN, phone, email…" />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/customers" params={params} col="name" label="Name" /></th>
              <th>GSTIN</th><th>State</th><th>Contact</th><th>Phone</th>
              <th className="text-right"><SortLink basePath="/customers" params={params} col="credit" label="Credit" align="right" /></th>
              {canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-medium text-ink">
                  <Link href={`/customers/${c.id}`} className="hover:text-accent hover:underline">{c.name}</Link>
                  {c.status === 'archived' && <StatusPill status="archived" label="Archived" className="ml-2 !text-[0.6rem]" />}
                  {c.address && <div className="text-xs text-faint font-normal truncate max-w-[16rem]">{c.address}</div>}
                </td>
                <td className="font-mono text-xs">{c.gstin ?? '—'}</td>
                <td>{c.stateCode ?? '—'}</td>
                <td>{c.contactPerson ?? '—'}</td>
                <td>{c.phone ?? '—'}</td>
                <td className="text-right tabular-nums">{c.creditTermsDays} d</td>
                {canDelete && (
                  <td className="text-right">
                    <ConfirmButton
                      action={deleteCustomerAction}
                      fields={{ id: c.id }}
                      className="text-crit hover:underline text-xs"
                      title="Delete this customer?"
                      body={<>This permanently removes <b>{c.name}</b>. If they have any quotations, orders or invoices, deletion is blocked to protect those records.</>}
                      confirmLabel="Delete customer"
                      toastOk="Customer deleted"
                    >
                      Delete
                    </ConfirmButton>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 7 : 6} className="px-4 py-10 text-center text-muted">
                  {q ? 'No customers match this search.' : 'No customers yet — add your first one above.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination basePath="/customers" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
