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
import { convertLeadToCustomerAction, deleteLeadAction } from '../actions';
import { OwnerSelect, ActivityForm, LeadEditForm, ACTIVITY_LABELS } from '../lead-detail';

export const metadata = { title: 'Enquiry' };

const ACTIVITY_ICON: Record<string, string> = { call: '📞', email: '✉', meeting: '🤝', note: '📝' };
const toDateInput = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Overdue by 3 days" / "Due today" / "15 Sep 2026" — closed enquiries just show the date. */
function followupStatus(at: Date | string | null, closed: boolean): { text: string; tone: string } | null {
  if (!at) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const due = new Date(at);
  const diffDays = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000);
  if (closed) return { text: formatDate(due), tone: 'text-muted' };
  if (diffDays < 0) return { text: `Overdue by ${plural(-diffDays, 'day', 'days')}`, tone: 'text-crit font-medium' };
  if (diffDays === 0) return { text: 'Due today', tone: 'text-warn font-medium' };
  return { text: formatDate(due), tone: 'text-ink' };
}

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getLead(id);
  if (!data?.lead) notFound();
  const { lead: l, activities, ownerName } = data;
  const canEdit = can(user, 'lead.edit');
  const canConvert = can(user, 'customer.create');
  const users = canEdit ? await usersForSelect() : [];
  const outreach = await getOutreachSettings();
  const wa = buildWhatsappLink({ phone: l.phone, name: l.contact || l.customerName, product: l.requirement, settings: outreach });

  const closed = ['won', 'lost'].includes(l.stage);
  const followup = followupStatus(l.nextFollowupAt, closed);
  const showWonBanner = l.stage === 'won' && !l.convertedCustomerId && canConvert;

  const convertButton = (
    <ConfirmButton
      action={convertLeadToCustomerAction}
      fields={{ id: l.id }}
      className="btn-primary text-sm"
      variant="primary"
      title={`Add ${l.customerName} as a customer?`}
      body="You'll then be able to make quotations and bills for them. Nothing is deleted."
      confirmLabel="Yes, add customer"
    >
      Add as customer
    </ConfirmButton>
  );

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted mb-1">Enquiries &amp; customers</p>
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{l.customerName}</h1>
          {canEdit
            ? <StageSelect id={l.id} stage={l.stage} name={l.customerName} />
            : <StatusPill status={l.stage} label={LEAD_STAGE_LABELS[l.stage as LeadStage] ?? l.stage} />}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {wa && <WhatsappButton href={wa} prominent />}
          {l.convertedCustomerId ? (
            <Link href={`/customers/${l.convertedCustomerId}`} className="btn-ghost text-sm">Customer ✓ · View →</Link>
          ) : showWonBanner ? convertButton : null}
        </div>
      </div>

      {showWonBanner && (
        <div className="card px-4 py-3 mb-5 flex items-center justify-between gap-3 flex-wrap border-accent/40 bg-accent-soft/40">
          <div className="text-sm text-ink">
            <span className="font-medium">Won 🎉</span> — add {l.customerName} as a customer? You&apos;ll then be able to make quotations and bills for them.
          </div>
          {convertButton}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 flex flex-col gap-5">
          <div className="card p-4">
            <div className="text-xs text-muted mb-1.5">Requirement</div>
            <div className="text-sm text-ink whitespace-pre-wrap">{l.requirement || <span className="text-muted">Nothing written yet — add it under Edit enquiry.</span>}</div>
          </div>

          <div className="card">
            <div className="px-4 py-3 border-b border-line font-medium text-sm">Notes &amp; follow-ups</div>
            {canEdit && (
              <div className="px-4 py-3 border-b border-line bg-surface-2/40"><ActivityForm leadId={l.id} /></div>
            )}
            {activities.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted">No notes yet — jot down what was said after each call.</div>
            ) : (
              <ul className="divide-y divide-line">
                {activities.map((a) => (
                  <li key={a.id} className="px-4 py-3 flex gap-3 text-sm">
                    <span aria-hidden className="shrink-0">{ACTIVITY_ICON[a.type] ?? '•'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-ink">{a.notes || <span className="text-muted">{ACTIVITY_LABELS[a.type] ?? 'Note'}</span>}</div>
                      <div className="text-xs text-muted mt-0.5">{ACTIVITY_LABELS[a.type] ?? 'Note'} · {formatDate(a.at)}{a.byName ? ` · ${a.byName}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="card p-4 text-sm space-y-2">
            <div className="text-xs text-muted">Details</div>
            <Row label="Source" value={l.source || '—'} />
            <Row label="Contact person" value={l.contact || '—'} />
            <Row label="Phone" value={l.phone ? <a href={`tel:${l.phone}`} className="text-steel hover:underline">{l.phone}</a> : '—'} />
            <Row label="Email" value={l.email ? <a href={`mailto:${l.email}`} className="text-steel hover:underline break-all">{l.email}</a> : '—'} />
            <Row label="Approx. value" value={l.valueEstimate ? formatINR(l.valueEstimate) : '—'} />
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-muted">Next follow-up</span>
              <span className={followup?.tone ?? 'text-muted'}>{followup?.text ?? 'None set'}</span>
            </div>
            <div className="pt-1">
              <span className="text-muted block mb-1">Handled by</span>
              {canEdit ? <OwnerSelect id={l.id} ownerUserId={l.ownerUserId} users={users} /> : <span>{ownerName ?? 'Nobody yet'}</span>}
            </div>
          </div>

          {canEdit && (
            <details className="reveal card">
              <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-11">
                <span className="chev" aria-hidden>›</span> Edit enquiry
              </summary>
              <div className="px-4 pb-4 border-t border-line pt-4">
                <LeadEditForm lead={{
                  id: l.id, customerName: l.customerName, contact: l.contact ?? '', phone: l.phone ?? '',
                  email: l.email ?? '', source: l.source ?? '', requirement: l.requirement ?? '',
                  stage: l.stage, valueEstimate: l.valueEstimate ?? '', nextFollowupAt: toDateInput(l.nextFollowupAt),
                }} />
                {can(user, 'lead.delete') && !l.convertedCustomerId && (
                  <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-muted">Not a real enquiry? You can remove it. To keep the history, mark it Lost instead.</span>
                    <ConfirmButton
                      action={deleteLeadAction}
                      fields={{ id: l.id }}
                      variant="danger"
                      title="Delete this enquiry?"
                      body="Its notes and follow-ups go too. To keep it, mark it Lost instead."
                      confirmLabel="Yes, delete"
                    >
                      Delete this enquiry
                    </ConfirmButton>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="mt-5"><Link href="/leads" className="text-steel text-sm hover:underline">← All enquiries</Link></div>
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
