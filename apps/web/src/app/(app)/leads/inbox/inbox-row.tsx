'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef, type RefObject } from 'react';
import { StatusPill } from '@/components/status-pill';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { WhatsappButton } from '@/components/whatsapp-button';
import { useToast } from '@/components/toast';
import { createLeadFromInboundAction, ignoreInboundAction, type ActionState } from './actions';
import { LeadFields } from '../lead-form';
import { FormErrorSummary, useFocusInvalid } from '../../customers/customer-form';

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
  waHref: string | null;
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

/** Plain-words status labels for inbound messages (DB values + their aliases). */
export const INBOX_STATUS_LABELS: Record<string, string> = {
  pending: 'Needs review',
  accepted: 'Enquiry created ✓',
  created: 'Enquiry created ✓',
  converted: 'Enquiry created ✓',
  duplicate: 'Already an enquiry',
  spam: 'Looks like spam',
  dismissed: 'Dismissed',
  ignored: 'Dismissed',
  failed: "Couldn't read",
};

/** StatusPill tones are keyed by status word; map inbox statuses onto ones it knows. */
const PILL_STATUS: Record<string, string> = {
  pending: 'unpaid', accepted: 'converted', created: 'converted', converted: 'converted',
  duplicate: 'draft', spam: 'rejected', dismissed: 'archived', ignored: 'archived', failed: 'rejected',
};

/** Statuses a person can still turn into an enquiry by hand. */
const RECOVERABLE = new Set(['spam', 'duplicate', 'ignored', 'dismissed', 'failed']);

/** Translate the filter's internal reason into one plain sentence. */
export function plainReason(reason: string | null | undefined, status: string): string | null {
  if (!reason) return status === 'duplicate' ? 'Same phone/email as an existing enquiry' : null;
  const r = reason.toLowerCase();
  if (/existing lead|phone\/email|matched/.test(r)) return 'Same phone/email as an existing enquiry';
  if (/allowlist|allowed list/.test(r)) return "Sender isn't on your allowed list (change it in Email enquiry setup)";
  if (/auto-submitted|no-reply|noreply|automatic/.test(r)) return 'Sent by an automatic system';
  if (/unsubscribe|newsletter|precedence|bulk|spam score|junk/.test(r)) return 'Looks like a newsletter or bulk mail';
  return 'Marked automatically';
}

function reviewSummary(status: string): string {
  if (status === 'spam') return 'Not spam — create enquiry';
  if (status === 'duplicate' || status === 'ignored' || status === 'dismissed') return 'Create anyway';
  if (status === 'failed') return 'Create enquiry by hand';
  return 'Review & create enquiry';
}

export function InboxRow({ message: m, canManage }: { message: InboxMessage; canManage: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(createLeadFromInboundAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.error && !state.field) toast({ title: "Couldn't create the enquiry", description: state.error, variant: 'error' });
    else if (state.ok) toast({ title: state.message ?? 'Enquiry created ✓', variant: 'success' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusInvalid(ref as RefObject<HTMLFormElement | null>, state);

  const who = [m.fromName, m.fromEmail].filter(Boolean).join(' · ') || '—';
  const reason = m.status !== 'pending' && m.status !== 'converted' ? plainReason(m.dedupeReason, m.status) : null;
  const canReview = canManage && (m.status === 'pending' || RECOVERABLE.has(m.status));

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <StatusPill status={PILL_STATUS[m.status] ?? m.status} label={INBOX_STATUS_LABELS[m.status] ?? m.status} />
            <span className="text-xs text-muted">{m.source}</span>
            <span className="text-xs text-muted">· {m.receivedAt}</span>
          </div>
          <div className="font-medium text-ink truncate">{m.subject || '(no subject)'}</div>
          <div className="text-xs text-muted truncate">From: {who}</div>
          {reason && (
            <div className="text-xs text-muted mt-1">
              {reason}
              {m.status === 'duplicate' && m.leadId && (
                <> · <Link href={`/leads/${m.leadId}`} className="text-steel hover:underline">View →</Link></>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {m.waHref && <WhatsappButton href={m.waHref} />}
          {m.leadId && m.status !== 'duplicate' && (
            <Link href={`/leads/${m.leadId}`} className="btn-ghost text-xs sm:border-0 sm:bg-transparent sm:px-0 sm:text-steel sm:hover:underline">
              View enquiry →
            </Link>
          )}
        </div>
      </div>

      {m.attachments.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-muted mb-1.5">
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
                  className={`text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-11 sm:min-h-0 rounded border border-line ${
                    a.url ? 'bg-surface-2 hover:bg-surface text-ink' : 'bg-surface-2 text-muted cursor-default'
                  }`}
                >
                  📎 <span className="max-w-[12rem] truncate">{a.name}</span>
                  {a.size ? <span className="text-muted">· {Math.round(a.size / 1024)} KB</span> : null}
                  {!a.url && <span className="text-muted">(unavailable)</span>}
                </a>
              ),
            )}
          </div>
        </div>
      )}

      {canReview && (
        <details className="reveal mt-3 border-t border-line pt-3">
          <summary className="text-sm font-medium text-accent flex items-center gap-2 cursor-pointer min-h-11 sm:min-h-0">
            <span className="chev" aria-hidden>›</span> {reviewSummary(m.status)}
          </summary>
          <form ref={ref} action={action} className="space-y-3 mt-3">
            <input type="hidden" name="inboundId" value={m.id} />
            <FormErrorSummary state={state} />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <LeadFields state={state} initial={{ ...m.prefill, valueEstimate: '' }} />
              <div className="sm:col-span-2 md:col-span-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:justify-end">
                {m.status === 'pending' && (
                  <ConfirmButton
                    action={ignoreInboundAction}
                    fields={{ id: m.id }}
                    className="btn-ghost text-sm"
                    variant="danger"
                    title="Dismiss this message?"
                    body="It won't become an enquiry. You can still find it under Dismissed."
                    confirmLabel="Yes, dismiss"
                  >
                    Dismiss
                  </ConfirmButton>
                )}
                <SubmitButton className="btn-primary" pendingLabel="Saving…">Create enquiry</SubmitButton>
              </div>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
