import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { listInboundMessages, inboxPendingCount, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink } from '@/lib/outreach';
import { formatDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import { Pagination } from '@/components/pagination';
import { InboxRow, type InboxMessage } from './inbox-row';
import { signedUrl } from '@/lib/ingest/storage';
import type { ExtractedLead, StoredAttachment } from '@/lib/ingest/types';

export const metadata = { title: 'Lead inbox' };

const STATUS_CHIPS = [
  { value: 'pending', label: 'Needs review' },
  { value: 'converted', label: 'Lead created' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'spam', label: 'Filtered' },
  { value: 'ignored', label: 'Dismissed' },
];

export default async function LeadInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { status, q, page } = await searchParams;
  const user = await requireUser();
  if (!can(user, 'lead_inbox.view')) redirect('/dashboard');

  const [list, pending, outreach] = await Promise.all([
    listInboundMessages({ status, q, page: Number(page) }), inboxPendingCount(), getOutreachSettings(),
  ]);
  const { rows, total, page: current, pageSize } = list;
  const canManage = can(user, 'lead_inbox.manage');
  const canManageChannels = can(user, 'lead_channel.manage');

  const messages: InboxMessage[] = await Promise.all(rows.map(async (r) => {
    const p = (r.parsed ?? {}) as Partial<ExtractedLead>;
    const source = p.source ?? (r.channelKind === 'email_webhook' ? 'Email' : r.channelKind);
    const atts = Array.isArray(r.attachments) ? (r.attachments as StoredAttachment[]) : [];
    const attachments = await Promise.all(atts.map(async (a) => ({
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      url: a.path ? await signedUrl(a.path) : null,
    })));
    const prefill = {
      customerName: p.customerName ?? r.fromName ?? r.subject ?? '',
      contact: p.contact ?? r.fromName ?? '',
      phone: p.phone ?? r.fromPhone ?? '',
      email: p.email ?? r.fromEmail ?? '',
      requirement: p.requirement ?? r.subject ?? '',
      source,
    };
    const waHref = buildWhatsappLink({
      phone: prefill.phone, name: prefill.contact || prefill.customerName,
      product: prefill.requirement, settings: outreach,
    });
    return {
      id: r.id,
      status: r.status,
      source,
      fromName: r.fromName,
      fromEmail: r.fromEmail,
      subject: r.subject,
      receivedAt: formatDate(r.receivedAt),
      parseMethod: r.parseMethod,
      dedupeReason: r.dedupeReason,
      leadId: r.leadId,
      attachments,
      waHref,
      prefill,
    };
  }));

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">CRM</p>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Lead inbox</h1>
        {canManageChannels && (
          <Link href="/settings/channels" className="text-sm text-steel hover:underline">Lead sources →</Link>
        )}
      </div>
      <p className="text-sm text-muted mb-5">
        Enquiries forwarded from your email land here. IndiaMART / TradeIndia notifications become leads
        automatically; anything else waits for a quick review.
        {pending > 0 && <b className="text-ink"> {pending} need review.</b>}
      </p>

      <FilterBar
        basePath="/leads/inbox"
        q={q}
        placeholder="Search subject, sender…"
        chipParam="status"
        chipValue={status}
        chips={STATUS_CHIPS}
      />

      <div className="flex flex-col gap-3">
        {messages.map((m) => <InboxRow key={m.id} message={m} canManage={canManage} />)}
        {messages.length === 0 && (
          <div className="card px-4 py-10 text-center text-muted">
            {status
              ? 'Nothing with this status.'
              : 'No inbound enquiries yet. Set up a Lead source to start capturing email leads.'}
          </div>
        )}
      </div>
      <Pagination basePath="/leads/inbox" params={{ status, q }} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
