const STAGE_STYLES: Record<string, string> = {
  new: 'bg-surface-2 text-muted',
  contacted: 'bg-accent-soft text-accent',
  negotiation: 'bg-accent-soft text-accent',
  won: 'bg-[#e4f1ea] text-ok',
  lost: 'bg-[#f6e6e2] text-crit',
};

export function StagePill({ stage, label }: { stage: string; label: string }) {
  return <span className={`pill ${STAGE_STYLES[stage] ?? 'bg-surface-2 text-muted'}`}>{label}</span>;
}
