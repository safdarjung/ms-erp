import { requireUser } from '@/lib/rbac';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { PasswordForm } from './password-form';

export const metadata = { title: 'Change password' };

export default async function PasswordPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{NAV.password.label}</h1>
      <p className="text-sm text-muted mb-5">
        Signed in as {user.email}. After you change it, your other phones and computers will be signed out.
      </p>
      <div className="card p-4">
        <PasswordForm />
      </div>
    </div>
  );
}
