import type { ReactNode } from 'react';
import { aiEnabled } from '@ms/ai';
import { requireUser } from '@/lib/rbac';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      aiEnabled={aiEnabled()}
      canManageUsers={user.permissions.has('user.manage')}
    >
      {children}
    </AppShell>
  );
}
