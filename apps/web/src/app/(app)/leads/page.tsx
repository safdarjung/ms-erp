import { formatINRShort } from '@ms/core';
import { listLeads } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { LeadForm } from './lead-form';
import { StageSelect } from './stage-select';

export default async function LeadsPage() {
  const user = await requireUser();
  const rows = await listLeads();

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Leads</h1>

      {can(user, 'lead.create') && <LeadForm />}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Source</th><th>Customer</th><th>Requirement</th>
              <th className="text-right">Est. value</th><th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 [&>td]:px-4 [&>td]:py-2.5 align-middle">
                <td className="text-muted">{l.source ?? '—'}</td>
                <td className="font-medium text-ink">
                  {l.customerName}
                  {l.contact && <span className="text-faint font-normal"> · {l.contact}</span>}
                </td>
                <td className="text-muted max-w-[22rem] truncate">{l.requirement ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{l.valueEstimate ? formatINRShort(l.valueEstimate) : '—'}</td>
                <td>
                  {can(user, 'lead.edit')
                    ? <StageSelect id={l.id} stage={l.stage} />
                    : <span className="capitalize">{l.stage}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No leads yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
