import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { listLeadChannels, listUsersWithRoles } from '@/lib/queries';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { CreateChannelForm, ChannelEditor, type ChannelView } from './channel-controls';
import type { ChannelConfig } from '@/lib/ingest/types';

export const metadata = { title: 'Email enquiry setup' };

export default async function ChannelsPage() {
  const user = await requireUser();
  if (!can(user, 'lead_channel.manage')) redirect(NAV.dashboard.href);

  const [channels, users] = await Promise.all([listLeadChannels(), listUsersWithRoles()]);
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? '';
  const inboundReady = !!inboundDomain;

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
      captureAddress: inboundReady ? `leads+${token}@${inboundDomain}` : '',
      inboundReady,
      webhookUrl: `${appUrl || 'https://your-app'}/api/leads/inbound?provider=generic&t=${token}`,
    };
  });
  const userOpts = users.map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="max-w-3xl">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{NAV.channels.label}</h1>
      <p className="text-sm text-muted mb-5 max-w-2xl leading-relaxed">
        Forward your IndiaMART / TradeIndia emails to a special address and they turn into enquiries by themselves.
        Three steps, done once.
      </p>

      {views.length === 0 ? (
        <div className="card p-4 mb-5">
          <p className="text-sm text-ink mb-3">First, create your forwarding address.</p>
          <CreateChannelForm />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {views.map((v) => <ChannelEditor key={v.id} channel={v} users={userOpts} />)}
          </div>
          <details className="reveal card mt-5">
            <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-[44px]">
              <span className="chev" aria-hidden>›</span> Add another forwarding address
            </summary>
            <div className="px-4 pb-4 border-t border-line pt-4"><CreateChannelForm /></div>
          </details>
        </>
      )}
    </div>
  );
}
