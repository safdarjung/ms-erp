'use client';
import { useFormStatus } from 'react-dom';

/**
 * Submit button that shows what is happening while the form saves.
 * `pendingLabel` defaults to "Saving…"; pass "Signing in…", "Making bill…" etc.
 */
export function SubmitButton({
  children,
  className = 'btn-primary',
  disabled = false,
  pendingLabel = 'Saving…',
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
