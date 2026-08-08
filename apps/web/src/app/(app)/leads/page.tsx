import { formatINRShort, LEAD_STAGES, LEAD_STAGE_LABELS } from '@ms/core';
import { listLeads, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink } from '@/lib/outreach';
import { requireUser, can } from '@/lib/rbac';
import Link from 'next/link';
import { FilterBar } from '@/components/filter-bar';
import { ConfirmButton } from '@/components/confirm-button';
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
  const outreach = await getOutreachSettings();
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
        placeholder="Search name, phone, requirement…"
        chipParam="stage"
        chipValue={stage}
        chips={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
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
                  <Link href={`/leads/${l.id}`} className="hover:text-accent hover:underline">{l.customerName}</Link>
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
                  <div className="flex items-center justify-end gap-3">
                    {(() => {
                      const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });
                      return wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#128C7E] hover:underline" title="Send intro on WhatsApp">
                          WhatsApp
                        </a>
                      ) : null;
                    })()}
                    {l.convertedCustomerId ? (
                      <span className="text-xs text-ok">✓ customer</span>
                    ) : l.stage === 'won' && canConvert ? (
                      <ConfirmButton
                        action={convertLeadToCustomerAction}
                        fields={{ id: l.id }}
                        className="text-xs text-steel hover:underline"
                        variant="primary"
                        title="Convert lead to customer?"
                        body={<>This creates a customer from <b>{l.customerName}</b> (or links to an existing one of the same name) so you can quote and invoice them.</>}
                        confirmLabel="Make customer"
                      >
                        → Make customer
                      </ConfirmButton>
                    ) : null}
                  </div>
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
