export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-live="polite" aria-busy>
      <p className="text-sm text-muted mb-3">Loading…</p>
      <div className="skeleton h-8 w-56 mb-6" aria-hidden />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20" />)}
      </div>
      <div className="skeleton h-72" aria-hidden />
    </div>
  );
}
