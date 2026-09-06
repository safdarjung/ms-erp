// Lightweight, dependency-free charts (server-rendered) that match the app's
// CSS-bar aesthetic — no charting library, no client JS.

const MOBILE_MONTHS = 6;

/** Vertical bar chart for a time series (e.g. 12 months). Phones see the last 6. */
export function MonthlyBars({
  data, color = 'bg-steel/70', fmt,
}: {
  data: { label: string; value: number }[];
  color?: string;
  fmt: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const summary = data.map((d) => `${d.label}: ${fmt(d.value)}`).join(', ');
  return (
    <div className="flex items-end gap-1.5 h-44 pt-2" role="img" aria-label={summary}>
      {data.map((d, i) => {
        const hiddenOnPhone = i < data.length - MOBILE_MONTHS;
        return (
          <div
            key={i}
            className={`${hiddenOnPhone ? 'hidden sm:flex' : 'flex'} flex-1 flex-col items-center justify-end gap-1 h-full min-w-0`}
            title={`${d.label}: ${fmt(d.value)}`}
          >
            <div
              className={`w-full ${color} rounded-t-sm`}
              style={{ height: `${d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0}%` }}
            />
            <span className="text-[0.7rem] text-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal bars for a ranked list (top customers, sources, aging…). */
export function HBarList({
  data, fmt, color = 'bg-accent/70', labelWidth = '9rem', emptyLabel = 'Nothing here yet.',
}: {
  data: { label: string; value: number; hint?: string }[];
  fmt: (n: number) => string;
  color?: string;
  labelWidth?: string;
  emptyLabel?: string;
}) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return <p className="text-sm text-muted">{emptyLabel}</p>;
  const max = Math.max(...rows.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((d, i) => (
        <div key={i} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: `minmax(0, ${labelWidth}) 1fr auto` }}>
          <span className="truncate text-muted" title={d.label}>{d.label}{d.hint ? <span className="text-muted"> · {d.hint}</span> : null}</span>
          <div className="h-3.5 bg-surface-2 rounded-sm overflow-hidden">
            <div className={`h-full ${color} rounded-sm`} style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
          <span className="tabular-nums font-mono text-ink whitespace-nowrap">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
