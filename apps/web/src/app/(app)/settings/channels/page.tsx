import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { listLeadChannels, listUsersWithRoles } from '@/lib/queries';
import { CreateChannelForm, ChannelEditor, type ChannelView } from './channel-controls';
import type { ChannelConfig } from '@/lib/ingest/types';

export const metadata = { title: 'Lead sources' };

export default async function ChannelsPage() {
  const user = await requireUser();
  if (!can(user, 'lead_channel.manage')) redirect('/dashboard');

  const [channels, users] = await Promise.all([listLeadChannels(), listUsersWithRoles()]);
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? 'inbound.your-domain.com';

  const views: ChannelView[] = channels.map((c) => {
    const cfg = (c.config ?? {}) as ChannelConfig;
    const token = cfg.inboundToken ?? '';
    return {
      id: c.id,
      name: c.name,
      enabled: c.enabled,
      inboundToken: token,
      defaultOwnerUserId: cfg.defaultOwnerUserId ?? null,
      autoCreate: cfg.autoCreate !== false,
      senderAllowlist: cfg.senderAllowlist ?? [],
      captureAddress: `leads+${token}@${inboundDomain}`,
      webhookUrl: `${appUrl || 'https://your-app'}/api/leads/inbound?provider=generic&t=${token}`,
    };
  });
  const userOpts = users.map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="max-w-3xl">
      <p className="eyebrow">Settings</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Lead sources</h1>
      <p className="text-sm text-muted mb-5 max-w-2xl leading-relaxed">
        Capture enquiries automatically by forwarding your email here. Point a Gmail filter for your
        IndiaMART / TradeIndia notifications (and your sales address) at the capture address below —
        every enquiry then shows up in the <b>Lead inbox</b>.
      </p>

      <details className="reveal card mb-5" open={views.length === 0}>
        <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
          <span className="chev" aria-hidden>›</span> Add an email source
        </summary>
        <div className="px-4 pb-4 border-t border-line pt-4"><CreateChannelForm /></div>
      </details>

      <div className="flex flex-col gap-4">
        {views.map((v) => <ChannelEditor key={v.id} channel={v} users={userOpts} />)}
      </div>

      <p className="text-xs text-faint mt-4 leading-relaxed max-w-2xl">
        The capture address is unguessable and specific to your company. Set up a mail-forwarding provider
        (Cloudflare Email Routing or Postmark inbound) once, pointing it at the webhook URL with the shared
        secret header — your administrator handles that step. IMAP polling and the IndiaMART / TradeIndia
        APIs are coming next for sources that can't forward.
      </p>
    </div>
  );
}
