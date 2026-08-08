'use client';
import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { StatusPill } from '@/components/status-pill';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';
import { createLeadFromInboundAction, ignoreInboundAction, type ActionState } from './actions';

export type InboxMessage = {
  id: string;
  status: string;
  source: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: string;
  parseMethod: string;
  dedupeReason: string | null;
  leadId: string | null;
  attachments: { name: string; mimeType: string; size: number; url: string | null }[];
  prefill: {
    customerName: string;
    contact: string;
    phone: string;
    email: string;
    requirement: string;
    source: string;
  };
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Needs review', converted: 'Lead created', duplicate: 'Duplicate',
  spam: 'Filtered', ignored: 'Dismissed', failed: 'Failed',
};

export function InboxRow({ message: m, canManage }: { message: InboxMessage; canManage: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(createLeadFromInboundAction, {});
  const toast = useToast();
  useEffect(() => {
    if (state.error) toast({ title: 'Could not create lead', description: state.error, variant: 'error' });
    else if (state.ok) toast({ title: 'Lead created', variant: 'success' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = [m.fromName, m.fromEmail].filter(Boolean).join(' · ') || '—';

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusPill status={m.status} label={STATUS_LABEL[m.status] ?? m.status} />
            <span className="text-xs text-faint">{m.source}</span>
            <span className="text-xs text-faint">· {m.receivedAt}</span>
          </div>
          <div className="font-medium text-ink truncate">{m.subject || '(no subject)'}</div>
          <div className="text-xs text-muted truncate">From: {who}</div>
          {m.dedupeReason && m.status !== 'pending' && (
            <div className="text-xs text-faint mt-1">{m.dedupeReason}</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          {m.leadId ? (
            <Link href={`/leads/${m.leadId}`} className="text-xs text-steel hover:underline">View lead →</Link>
          ) : null}
        </div>
      </div>

      {m.attachments.length > 0 && (
        <div className="mt-3">
          <div className="text-[0.7rem] uppercase tracking-wide text-faint mb-1.5">
            Attachments ({m.attachments.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a, i) =>
              a.mimeType.startsWith('image/') && a.url ? (
                <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="h-20 w-20 object-cover rounded border border-line" />
                </a>
              ) : (
                <a
                  key={i}
                  href={a.url ?? undefined}
                  target={a.url ? '_blank' : undefined}
                  rel="noreferrer"
                  className={`text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-line ${
                    a.url ? 'bg-surface-2 hover:bg-surface text-ink' : 'bg-surface-2 text-faint cursor-default'
                  }`}
                >
                  📎 <span className="max-w-[12rem] truncate">{a.name}</span>
                  {a.size ? <span className="text-faint">· {Math.round(a.size / 1024)} KB</span> : null}
                  {!a.url && <span className="text-faint">(unavailable)</span>}
                </a>
              ),
            )}
          </div>
        </div>
      )}

      {m.status === 'pending' && canManage && (
        <details className="reveal mt-3 border-t border-line pt-3">
          <summary className="text-sm font-medium text-accent flex items-center gap-2 cursor-pointer">
            <span className="chev" aria-hidden>›</span> Review &amp; create lead
          </summary>
          <form action={action} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end mt-3">
            <input type="hidden" name="inboundId" value={m.id} />
            <div className="col-span-2 md:col-span-1">
              <label className="label">Customer / enquiry *</label>
              <input name="customerName" required defaultValue={m.prefill.customerName} className="field" />
            </div>
            <div>
              <label className="label">Contact person</label>
              <input name="contact" defaultValue={m.prefill.contact} className="field" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" defaultValue={m.prefill.phone} inputMode="tel" className="field" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" defaultValue={m.prefill.email} className="field" />
            </div>
            <div>
              <label className="label">Source</label>
              <input name="source" defaultValue={m.prefill.source} className="field" />
            </div>
            <div>
              <label className="label">Est. value (₹)</label>
              <input name="valueEstimate" type="number" min={0} className="field" placeholder="0" />
            </div>
            <div className="col-span-2">
              <label className="label">Requirement</label>
              <input name="requirement" defaultValue={m.prefill.requirement} className="field" />
            </div>
            <div className="col-span-2 md:col-span-4 flex items-center gap-2 md:justify-end">
              <ConfirmButton
                action={ignoreInboundAction}
                fields={{ id: m.id }}
                title="Dismiss this message?"
                body="It won't create a lead. You can still find it under the Dismissed filter."
                confirmLabel="Dismiss"
              >
                Ignore
              </ConfirmButton>
              <SubmitButton className="btn-primary">Create lead</SubmitButton>
            </div>
            {state.error && <p className="text-sm text-crit col-span-2 md:col-span-4">{state.error}</p>}
          </form>
        </details>
      )}
    </div>
  );
}
