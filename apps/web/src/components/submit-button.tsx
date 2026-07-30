'use client';
import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  className = 'btn-primary',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending ? 'Saving…' : children}
    </button>
  );
}
