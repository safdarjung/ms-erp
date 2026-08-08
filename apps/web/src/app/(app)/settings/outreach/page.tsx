import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { getOutreachSettings } from '@/lib/queries';
import { OutreachForm } from './outreach-form';

export const metadata = { title: 'WhatsApp outreach' };

export default async function OutreachPage() {
  const user = await requireUser();
  if (!can(user, 'settings.manage')) redirect('/dashboard');
  const settings = await getOutreachSettings();

  return (
    <div className="max-w-2xl">
      <p className="eyebrow">Settings</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">WhatsApp outreach</h1>
      <p className="text-sm text-muted mb-5 max-w-xl leading-relaxed">
        Your number and the intro message behind the <b>WhatsApp</b> button on each lead. Tapping that button
        opens WhatsApp with this message pre-filled to the buyer — you just press send, from your own number.
      </p>
      <div className="card p-4"><OutreachForm settings={settings} /></div>
    </div>
  );
}
