import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { getOutreachSettings } from '@/lib/queries';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { OutreachForm } from './outreach-form';

export const metadata = { title: 'WhatsApp message' };

export default async function OutreachPage() {
  const user = await requireUser();
  if (!can(user, 'settings.manage')) redirect(NAV.dashboard.href);
  const settings = await getOutreachSettings();

  return (
    <div className="max-w-2xl">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{NAV.outreach.label}</h1>
      <p className="text-sm text-muted mb-5 max-w-xl leading-relaxed">
        When you tap <b>WhatsApp</b> on an enquiry, WhatsApp opens with this message already typed, from your own number.
        You just press send.
      </p>
      <div className="card p-4"><OutreachForm settings={settings} /></div>
    </div>
  );
}
