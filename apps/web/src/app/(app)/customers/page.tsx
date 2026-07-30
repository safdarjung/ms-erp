import { listCustomers } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { CustomerForm } from './customer-form';
import { deleteCustomerAction } from './actions';

export default async function CustomersPage() {
  const user = await requireUser();
  const rows = await listCustomers();
  const canDelete = can(user, 'customer.delete');

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Customers</h1>

      {can(user, 'customer.create') && <CustomerForm />}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Code</th><th>Name</th><th>GSTIN</th><th>State</th><th>Contact</th><th>Phone</th>
              <th className="text-right">Credit</th>{canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2.5">
                <td className="font-mono text-xs text-muted">{c.code ?? '—'}</td>
                <td className="font-medium text-ink">{c.name}</td>
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
                <td colSpan={canDelete ? 8 : 7} className="px-4 py-8 text-center text-muted">No customers yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
