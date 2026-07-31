import { requireUser } from '@/lib/rbac';
import { PasswordForm } from './password-form';

export const metadata = { title: 'Change password' };

export default async function PasswordPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md">
      <p className="eyebrow">Settings</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Change password</h1>
      <p className="text-sm text-muted mb-5">Signed in as {user.email}. Changing your password signs out your other devices.</p>
      <div className="card p-4">
        <PasswordForm />
      </div>
    </div>
  );
}
