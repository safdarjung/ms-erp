import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { listInboundMessages, inboxPendingCount, getOutreachSettings } from '@/lib/queries';
import { buildWhatsappLink } from '@/lib/outreach';
import { formatDate } from '@/lib/format';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { FilterBar } from '@/components/filter-bar';
import { Pagination } from '@/components/pagination';
import { EmptyState } from '@/components/list-cards';
import { InboxRow, type InboxMessage } from './inbox-row';
import { signedUrl } from '@/lib/ingest/storage';
import type { ExtractedLead, StoredAttachment } from '@/lib/ingest/types';

export const metadata = { title: 'Email enquiries' };

// Plain-words names for inbound_message.status values.
const STATUS_CHIPS = [
  { value: 'pending', label: 'Needs review' },
  { value: 'converted', label: 'Enquiry created ✓' },
  { value: 'duplicate', label: 'Already an enquiry' },
  { value: 'spam', label: 'Looks like spam' },
  { value: 'ignored', label: 'Dismissed' },
  { value: 'failed', label: "Couldn't read" },
];

export default async function LeadInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { status, q, page } = await searchParams;
  const user = await requireUser();
  if (!can(user, 'lead_inbox.view')) redirect(NAV.dashboard.href);

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

  const setupLink = canManageChannels
    ? <Link href={NAV.channels.href} className="text-steel hover:underline">{NAV.channels.label}</Link>
    : null;

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">{NAV_GROUPS.crm}</p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Email enquiries</h1>
        {canManageChannels && (
          <Link href={NAV.channels.href} className="btn-ghost text-xs w-full sm:w-auto">{NAV.channels.label} →</Link>
        )}
      </div>
      <p className="text-sm text-muted mb-5">
        Emails you forward here (IndiaMART, TradeIndia, your sales inbox) turn into enquiries. Ones we could not read fully wait for a quick look.
        {pending > 0 && <b className="text-ink"> {pending} need review.</b>}
      </p>

      <FilterBar
        basePath="/leads/inbox"
        q={q}
        placeholder="Search subject or sender…"
        chipParam="status"
        chipValue={status}
        chips={STATUS_CHIPS}
      />

      <div className="flex flex-col gap-3">
        {messages.map((m) => <InboxRow key={m.id} message={m} canManage={canManage} />)}
        {messages.length === 0 && (
          <EmptyState
            message={status || q
              ? <>Nothing here. <Link href="/leads/inbox" className="text-steel hover:underline">Show all →</Link></>
              : 'No email enquiries yet.'}
            hint={!status && !q && (
              <>Forward your IndiaMART / TradeIndia emails — {setupLink ? <>see {setupLink}.</> : 'ask the owner to set it up.'}</>
            )}
          />
        )}
      </div>
      <Pagination basePath="/leads/inbox" params={{ status, q }} page={current} pageSize={pageSize} total={total} />
    </div>
  );
}
