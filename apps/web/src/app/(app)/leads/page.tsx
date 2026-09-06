import Link from 'next/link';
import { formatINRShort, LEAD_STAGES, LEAD_STAGE_LABELS, type LeadStage } from '@ms/core';
import { listLeads, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink } from '@/lib/outreach';
import { requireUser, can } from '@/lib/rbac';
import { followupLabel, type DueTone } from '@/lib/format';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar, type Chip } from '@/components/filter-bar';
import { Pagination, SortLink } from '@/components/pagination';
import { ConfirmButton } from '@/components/confirm-button';
import { StatusPill } from '@/components/status-pill';
import { WhatsappButton } from '@/components/whatsapp-button';
import { MobileList, DesktopTable, ListCard, EmptyState } from '@/components/list-cards';
import { LeadForm } from './lead-form';
import { StageSelect } from './stage-select';
import { convertLeadToCustomerAction } from './actions';

export const metadata = { title: 'Enquiries' };

const NEW_HREF = '/leads?new=1#new-enquiry';
const CLOSED_STAGES: string[] = ['won', 'lost'];
const TONE_CLS: Record<DueTone, string> = { crit: 'text-crit font-medium', warn: 'text-warn font-medium', muted: 'text-muted' };

function stageLabel(stage: string): string {
  return LEAD_STAGE_LABELS[stage as LeadStage] ?? stage;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; due?: string; page?: string; sort?: string; new?: string }>;
}) {
  const { q, stage, due, page, sort, new: isNew } = await searchParams;
  const user = await requireUser();
  const { rows, total, page: current, pageSize } = await listLeads({ q, stage, due, page: Number(page), sort });
  const outreach = await getOutreachSettings();
  const canCreate = can(user, 'lead.create');
  const canEdit = can(user, 'lead.edit');
  const canConvert = can(user, 'customer.create');
  const canSeeInbox = can(user, 'lead_inbox.view');
  const openNew = canCreate && isNew === '1';
  const params = { q, stage, due, sort };
  const filtered = Boolean(q || stage || due);

  const chips: Chip[] = [
    ...LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] })),
    { value: 'today', label: 'Due today', param: 'due' },
  ];

  const newButton = canCreate && <Link href={NEW_HREF} className="btn-primary w-full sm:w-auto">+ New enquiry</Link>;
  const empty = (colSpan?: number) => (
    <EmptyState
      colSpan={colSpan}
      message={filtered ? <>Nothing matches this filter. <Link href="/leads" className="text-steel hover:underline">Clear →</Link></> : 'No enquiries yet.'}
      action={!filtered && newButton}
      hint={!filtered && (
        <>or forward an IndiaMART email {canSeeInbox
          ? <>(see <Link href={NAV.inbox.href} className="text-steel hover:underline">{NAV.inbox.label}</Link>)</>
          : '(ask the owner about Email enquiries)'}.</>
      )}
    />
  );

  /** "Make customer" for won enquiries, "Customer ✓ · View →" once done. */
  const convertControl = (l: typeof rows[number], compact: boolean) => {
    if (l.convertedCustomerId) {
      return (
        <Link href={`/customers/${l.convertedCustomerId}`} className={compact ? 'text-xs text-ok whitespace-nowrap hover:underline' : 'btn-ghost text-sm'}>
          Customer ✓ · View →
        </Link>
      );
    }
    if (l.stage !== 'won' || !canConvert) return null;
    return (
      <ConfirmButton
        action={convertLeadToCustomerAction}
        fields={{ id: l.id }}
        className={compact ? 'btn-primary !py-1 text-xs' : 'btn-primary text-sm'}
        variant="primary"
        title="Make a customer from this enquiry?"
        body={<>This adds <b>{l.customerName}</b> to Customers (or links them if they already exist) so you can send quotations and bills.</>}
        confirmLabel="Yes, make customer"
        pendingLabel="Making customer…"
        toastOk={`${l.customerName} is now a customer`}
      >
        Make customer
      </ConfirmButton>
    );
  };

  const followup = (l: typeof rows[number]) => (CLOSED_STAGES.includes(l.stage) ? null : followupLabel(l.nextFollowupAt));

  return (
    <div className="max-w-6xl">
      <p className="text-xs text-muted">{NAV_GROUPS.crm}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Enquiries</h1>
        <div className="flex flex-wrap items-center gap-2">{newButton}</div>
      </div>

      {canCreate && (
        <details id="new-enquiry" className="reveal card mb-5 scroll-mt-16" open={openNew}>
          <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-[44px]">
            <span className="chev" aria-hidden>›</span> New enquiry
          </summary>
          <div className="px-4 pb-4 border-t border-line pt-4"><LeadForm /></div>
        </details>
      )}

      <FilterBar
        basePath="/leads"
        q={q}
        placeholder="Search company, name, phone…"
        chipParam="stage"
        chipValue={stage}
        chips={chips}
        params={{ due }}
      />

      <MobileList>
        {rows.map((l) => {
          const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });
          const fu = followup(l);
          return (
            <ListCard
              key={l.id}
              title={<>{l.customerName}{l.contact && <span className="text-muted font-normal"> · {l.contact}</span>}</>}
              href={`/leads/${l.id}`}
              pill={<StatusPill status={l.stage} label={stageLabel(l.stage)} />}
              line2={l.requirement ?? undefined}
              line3={<>
                {fu ? <span className={TONE_CLS[fu.tone]}>Follow-up: {fu.text}</span> : null}
                {fu && l.source ? ' · ' : null}
                {l.source}
              </>}
              amount={l.valueEstimate ? formatINRShort(l.valueEstimate) : undefined}
              actions={(canEdit || wa || convertControl(l, false)) ? (
                <>
                  {canEdit && (
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span>Stage</span>
                      <StageSelect id={l.id} stage={l.stage} name={l.customerName} />
                    </div>
                  )}
                  {wa && <div className="[&>a]:w-full [&>a]:justify-center [&>a]:min-h-[44px] [&>a]:text-sm"><WhatsappButton href={wa} /></div>}
                  {convertControl(l, false)}
                </>
              ) : undefined}
            />
          );
        })}
        {rows.length === 0 && empty()}
      </MobileList>

      <DesktopTable>
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th><SortLink basePath="/leads" params={params} col="customer" label="Company / name" /></th>
              <th>Requirement</th>
              <th className="text-right"><SortLink basePath="/leads" params={params} col="value" label="Approx. value" align="right" /></th>
              <th>Stage</th>
              <th><SortLink basePath="/leads" params={params} col="followup" label="Follow-up" /></th>
              <th>Source</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });
              const fu = followup(l);
              return (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5 align-middle">
                  <td className="font-medium text-ink">
                    <Link href={`/leads/${l.id}`} className="hover:text-accent hover:underline">{l.customerName}</Link>
                    {l.contact && <span className="text-muted font-normal"> · {l.contact}</span>}
                  </td>
                  <td className="text-muted max-w-[18rem] truncate">{l.requirement ?? '—'}</td>
                  <td className="text-right tabular-nums font-mono whitespace-nowrap">{l.valueEstimate ? formatINRShort(l.valueEstimate) : '—'}</td>
                  <td>
                    {canEdit
                      ? <StageSelect id={l.id} stage={l.stage} name={l.customerName} />
                      : <StatusPill status={l.stage} label={stageLabel(l.stage)} />}
                  </td>
                  <td className="whitespace-nowrap">
                    {fu ? <span className={TONE_CLS[fu.tone]}>{fu.text}</span> : <span className="text-faint">—</span>}
                  </td>
                  <td className="text-muted">{l.source ?? '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      {wa && <WhatsappButton href={wa} />}
                      {convertControl(l, true)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && empty(7)}
          </tbody>
        </table>
      </DesktopTable>
      <Pagination basePath="/leads" params={params} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
