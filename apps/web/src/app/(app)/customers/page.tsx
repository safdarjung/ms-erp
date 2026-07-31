import { listCustomers } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { FilterBar } from '@/components/filter-bar';
import { CustomerForm } from './customer-form';
import { deleteCustomerAction } from './actions';

export const metadata = { title: 'Customers' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const rows = await listCustomers(q);
  const canDelete = can(user, 'customer.delete');

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-5">Customers</h1>

      {can(user, 'customer.create') && (
        <details className="reveal card mb-5">
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
            <span className="chev" aria-hidden>›</span> Add a customer
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4"><CustomerForm /></div>
        </details>
      )}

      <FilterBar basePath="/customers" q={q} placeholder="Search name, GSTIN, phone…" />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Name</th><th>GSTIN</th><th>State</th><th>Contact</th><th>Phone</th>
              <th className="text-right">Credit</th>{canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-medium text-ink">
                  {c.name}
                  {c.address && <div className="text-xs text-faint font-normal truncate max-w-[16rem]">{c.address}</div>}
                </td>
                <td className="font-mono text-xs">{c.gstin ?? '—'}</td>
                <td>{c.stateCode ?? '—'}</td>
                <td>{c.contactPerson ?? '—'}</td>
                <td>{c.phone ?? '—'}</td>
                <td className="text-right tabular-nums">{c.creditTermsDays} d</td>
                {canDelete && (
                  <td className="text-right">
                    <form action={deleteCustomerAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-crit hover:underline text-xs">Delete</button>
                    </form>
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
    </div>
  );
}
