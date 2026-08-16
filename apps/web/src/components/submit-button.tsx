'use client';
import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  className = 'btn-primary',
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className} aria-busy={pending}>
      {pending ? 'Saving…' : children}
    </button>
  );
}
