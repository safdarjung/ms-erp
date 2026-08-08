import type { ReactNode } from 'react';
import { aiEnabled } from '@ms/ai';
import { requireUser } from '@/lib/rbac';
import { inboxPendingCount } from '@/lib/queries';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const canViewInbox = user.permissions.has('lead_inbox.view');
  const inboxCount = canViewInbox ? await inboxPendingCount() : 0;
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      aiEnabled={aiEnabled()}
      canManageUsers={user.permissions.has('user.manage')}
      canViewInbox={canViewInbox}
      canManageChannels={user.permissions.has('lead_channel.manage')}
      inboxCount={inboxCount}
    >
      {children}
    </AppShell>
  );
}
