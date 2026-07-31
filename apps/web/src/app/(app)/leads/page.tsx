import { formatINRShort, LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { listLeads } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { FilterBar } from '@/components/filter-bar';
import { LeadForm } from './lead-form';
import { StageSelect } from './stage-select';
import { convertLeadToCustomerAction } from './actions';

export const metadata = { title: 'Leads' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string }>;
}) {
  const { q, stage } = await searchParams;
  const user = await requireUser();
  const rows = await listLeads(q, stage);
  const canConvert = can(user, 'customer.create');

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-5">Leads</h1>

      {can(user, 'lead.create') && (
        <details className="reveal card mb-5">
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
            <span className="chev" aria-hidden>›</span> Add a lead
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4"><LeadForm /></div>
        </details>
      )}

      <FilterBar
        basePath="/leads"
        q={q}
        placeholder="Search name, requirement, source…"
        chipParam="stage"
        chipValue={stage}
        chips={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Source</th><th>Customer</th><th>Requirement</th>
              <th className="text-right">Est. value</th><th>Stage</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5 align-middle">
                <td className="text-muted">{l.source ?? '—'}</td>
                <td className="font-medium text-ink">
                  {l.customerName}
                  {l.contact && <span className="text-faint font-normal"> · {l.contact}</span>}
                </td>
                <td className="text-muted max-w-[20rem] truncate">{l.requirement ?? '—'}</td>
                <td className="text-right tabular-nums font-mono">{l.valueEstimate ? formatINRShort(l.valueEstimate) : '—'}</td>
                <td>
                  {can(user, 'lead.edit')
                    ? <StageSelect id={l.id} stage={l.stage} />
                    : <span className="capitalize">{l.stage}</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {l.convertedCustomerId ? (
                    <span className="text-xs text-ok">✓ customer</span>
                  ) : l.stage === 'won' && canConvert ? (
                    <form action={convertLeadToCustomerAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-xs text-steel hover:underline">→ Make customer</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">
                {q || stage ? 'Nothing matches this filter.' : 'No leads yet — add your first enquiry above.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
