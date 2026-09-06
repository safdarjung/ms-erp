'use client';
import Link from 'next/link';
import { NAV } from '@/lib/nav-labels';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message?.startsWith('FORBIDDEN');
  return (
    <div className="max-w-md mx-auto mt-16 card p-6 text-center" role="alert">
      <div className="text-2xl mb-2" aria-hidden>{forbidden ? '🔒' : '⚠'}</div>
      <h2 className="font-semibold text-lg mb-1">
        {forbidden ? "You don't have access to this." : 'Something went wrong — nothing you saved is lost.'}
      </h2>
      <p className="text-sm text-muted mb-5">
        {forbidden
          ? 'Ask the owner to give you access.'
          : 'Please try again. If it keeps happening, tell the owner.'}
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-2">
        {!forbidden && <button type="button" onClick={reset} className="btn-primary">Try again</button>}
        <Link href={NAV.dashboard.href} className={forbidden ? 'btn-primary' : 'btn-ghost'}>Go to {NAV.dashboard.label}</Link>
      </div>
    </div>
  );
}
