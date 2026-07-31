'use client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-md mx-auto mt-20 card p-6 text-center">
      <div className="text-2xl mb-2" aria-hidden>⚠</div>
      <h2 className="font-semibold text-lg mb-1">Something went wrong</h2>
      <p className="text-sm text-muted mb-4">
        {error.message?.startsWith('FORBIDDEN')
          ? 'You don’t have permission for that action.'
          : 'The page hit an unexpected error. Your data is safe.'}
      </p>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  );
}
