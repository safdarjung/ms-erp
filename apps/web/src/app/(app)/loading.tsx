export default function Loading() {
  return (
    <div className="max-w-5xl" aria-busy>
      <div className="skeleton h-3 w-20 mb-3" />
      <div className="skeleton h-8 w-56 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20" />)}
      </div>
      <div className="skeleton h-72" />
    </div>
  );
}
