import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { formatINR, LEAD_STAGE_LABELS, type LeadStage } from '@ms/core';
import { getLead, usersForSelect, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink } from '@/lib/outreach';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { ConfirmButton } from '@/components/confirm-button';
import { WhatsappButton } from '@/components/whatsapp-button';
import { StageSelect } from '../stage-select';
import { convertLeadToCustomerAction } from '../actions';
import { OwnerSelect, ActivityForm, LeadEditForm } from '../lead-detail';

export const metadata = { title: 'Lead' };

const ACTIVITY_ICON: Record<string, string> = { call: '📞', email: '✉', meeting: '🤝', note: '📝' };
const toDateInput = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getLead(id);
  if (!data?.lead) notFound();
  const { lead: l, activities, ownerName } = data;
  const canEdit = can(user, 'lead.edit');
  const users = canEdit ? await usersForSelect() : [];
  const outreach = await getOutreachSettings();
  const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });

  const followupOverdue = l.nextFollowupAt && new Date(l.nextFollowupAt).getTime() < Date.now() && !['won', 'lost'].includes(l.stage);

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">CRM · Lead</p>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{l.customerName}</h1>
          {canEdit
            ? <StageSelect id={l.id} stage={l.stage} />
            : <StatusPill status={l.stage} label={LEAD_STAGE_LABELS[l.stage as LeadStage] ?? l.stage} />}
        </div>
        <div className="flex gap-2 items-center">
          {wa && <WhatsappButton href={wa} prominent />}
          {l.convertedCustomerId ? (
            <Link href={`/customers/${l.convertedCustomerId}`} className="btn-ghost">View customer →</Link>
          ) : l.stage === 'won' && can(user, 'customer.create') ? (
            <ConfirmButton
              action={convertLeadToCustomerAction}
              fields={{ id: l.id }}
              className="btn-primary"
              variant="primary"
              title="Convert lead to customer?"
              body={<>This creates a customer from <b>{l.customerName}</b> so you can quote and invoice them.</>}
              confirmLabel="Make customer"
            >
              → Make customer
            </ConfirmButton>
          ) : null}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 flex flex-col gap-5">
          <div className="card p-4">
            <div className="text-faint text-xs uppercase mb-1.5">Requirement</div>
            <div className="text-sm text-ink whitespace-pre-wrap">{l.requirement || <span className="text-muted">No requirement captured.</span>}</div>
          </div>

          <div className="card">
            <div className="px-4 py-3 border-b border-line font-medium text-sm">Activity &amp; follow-ups</div>
            {canEdit && (
              <div className="px-4 py-3 border-b border-line bg-surface-2/40"><ActivityForm leadId={l.id} /></div>
            )}
            {activities.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted">No activity logged yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {activities.map((a) => (
                  <li key={a.id} className="px-4 py-3 flex gap-3 text-sm">
                    <span aria-hidden className="shrink-0">{ACTIVITY_ICON[a.type] ?? '•'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-ink">{a.notes || <span className="capitalize text-muted">{a.type}</span>}</div>
                      <div className="text-xs text-faint mt-0.5">{formatDate(a.at)}{a.byName ? ` · ${a.byName}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="card p-4 text-sm space-y-2">
            <div className="text-faint text-xs uppercase">Details</div>
            <Row label="Source" value={l.source || '—'} />
            <Row label="Contact" value={l.contact || '—'} />
            <Row label="Phone" value={l.phone ? <a href={`tel:${l.phone}`} className="text-steel hover:underline">{l.phone}</a> : '—'} />
            <Row label="Email" value={l.email ? <a href={`mailto:${l.email}`} className="text-steel hover:underline break-all">{l.email}</a> : '—'} />
            <Row label="Est. value" value={l.valueEstimate ? formatINR(l.valueEstimate) : '—'} />
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-muted">Follow-up</span>
              <span className={followupOverdue ? 'text-crit font-medium' : ''}>{l.nextFollowupAt ? formatDate(l.nextFollowupAt) : '—'}{followupOverdue ? ' (due)' : ''}</span>
            </div>
            <div className="pt-1">
              <span className="text-muted block mb-1">Owner</span>
              {canEdit ? <OwnerSelect id={l.id} ownerUserId={l.ownerUserId} users={users} /> : <span>{ownerName ?? 'Unassigned'}</span>}
            </div>
          </div>

          {canEdit && (
            <details className="reveal card">
              <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
                <span className="chev" aria-hidden>›</span> Edit lead
              </summary>
              <div className="px-4 pb-4 border-t border-line pt-4">
                <LeadEditForm lead={{
                  id: l.id, customerName: l.customerName, contact: l.contact ?? '', phone: l.phone ?? '',
                  email: l.email ?? '', source: l.source ?? '', requirement: l.requirement ?? '',
                  stage: l.stage, valueEstimate: l.valueEstimate ?? '', nextFollowupDate: toDateInput(l.nextFollowupAt),
                }} />
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="mt-5"><Link href="/leads" className="text-steel text-sm hover:underline">← All leads</Link></div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}
