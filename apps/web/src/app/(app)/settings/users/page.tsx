import { redirect } from 'next/navigation';
import { listUsersWithRoles } from '@/lib/queries';
import { requireUser, can } from '@/lib/rbac';
import { formatDate } from '@/lib/format';
import { CreateUserForm, EditProfile, ResetPassword, RoleSelect, StatusToggle } from './user-controls';

export const metadata = { title: 'Users' };

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, 'user.manage')) redirect('/dashboard');
  const rows = await listUsersWithRoles();

  return (
    <div className="max-w-5xl">
      <p className="eyebrow">Settings</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-5">Users &amp; roles</h1>

      <details className="reveal card mb-5">
        <summary className="px-4 py-3 text-sm font-medium text-ink flex items-center gap-2">
          <span className="chev" aria-hidden>›</span> Add a user
        </summary>
        <div className="px-4 pb-4 border-t border-line pt-4"><CreateUserForm /></div>
      </details>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-faint border-b border-line text-xs uppercase tracking-wide [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
              <th>User</th><th>Role</th><th>Status</th><th>Last login</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const self = u.id === user.userId;
              return (
                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2.5">
                  <td>
                    <div className="font-medium text-ink">{u.name}{self && <span className="text-faint font-normal"> (you)</span>}</div>
                    <div className="text-xs text-faint">{u.email}</div>
                  </td>
                  <td><RoleSelect id={u.id} current={u.roles[0] ?? ''} disabled={self} /></td>
                  <td><StatusToggle id={u.id} status={u.status} disabled={self} /></td>
                  <td className="text-xs text-muted">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}</td>
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

      <p className="text-xs text-faint mt-3 leading-relaxed max-w-2xl">
        Roles carry fixed permission sets (owner = everything). Disabling a user ends their sessions
        immediately. You cannot change your own role or status — ask another owner.
      </p>
    </div>
  );
}
