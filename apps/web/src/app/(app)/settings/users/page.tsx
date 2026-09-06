import { redirect } from 'next/navigation';
import { listUsersWithRoles } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { CreateUserForm, EditProfile, ResetPassword, RoleSelect, StatusToggle } from './user-controls';

export const metadata = { title: 'Staff' };

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, 'user.manage')) redirect(NAV.dashboard.href);
  const rows = await listUsersWithRoles();

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{NAV.users.label}</h1>
      <p className="text-sm text-muted mb-5">Everyone who can sign in, and what each person can do.</p>

      <details className="reveal card mb-5" open={rows.length <= 1}>
        <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2 min-h-[44px]">
          <span className="chev" aria-hidden>›</span> Add a staff member
        </summary>
        <div className="px-4 pb-4 border-t border-line pt-4"><CreateUserForm /></div>
      </details>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>Name</th><th>Role</th><th>Sign-in</th><th>Last signed in</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const self = u.id === user.userId;
              return (
                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5 align-top">
                  <td>
                    <div className="font-medium text-ink">{u.name}{self && <span className="text-muted font-normal"> (you)</span>}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td><RoleSelect id={u.id} current={u.roles[0] ?? ''} disabled={self} /></td>
                  <td><StatusToggle id={u.id} status={u.status} disabled={self} /></td>
                  <td className="text-xs text-muted whitespace-nowrap">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</td>
                  <td className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <EditProfile id={u.id} name={u.name} email={u.email} />
                      <ResetPassword id={u.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted mt-3 leading-relaxed max-w-2xl">
        Owners can do everything. Blocking someone signs them out straight away. You can&rsquo;t change your own role or block
        yourself — ask another owner.
      </p>
    </div>
  );
}
