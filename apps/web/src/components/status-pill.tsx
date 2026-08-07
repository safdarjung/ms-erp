// Unified status pill with consistent colour semantics across leads, quotations,
// orders and invoices. Colour is backed by a text label so meaning never rests
// on colour alone (accessibility).

type Tone = 'muted' | 'steel' | 'warn' | 'ok' | 'crit';

const TONE: Record<string, Tone> = {
  // neutral / not-started
  draft: 'muted', new: 'muted', open: 'muted', archived: 'muted', unregistered: 'muted',
  // in-progress / informational
  sent: 'steel', contacted: 'steel', in_progress: 'steel', issued: 'steel', registered: 'steel', active: 'steel',
  // attention / partial
  negotiation: 'warn', partial: 'warn', partially_paid: 'warn', due_soon: 'warn', unpaid: 'warn',
  // positive / done
  approved: 'ok', converted: 'ok', won: 'ok', delivered: 'ok', closed: 'ok', paid: 'ok', invoiced: 'ok',
  // negative
  rejected: 'crit', cancelled: 'crit', lost: 'crit', overdue: 'crit',
};

const CLS: Record<Tone, string> = {
  muted: 'bg-surface-2 text-muted',
  steel: 'bg-[#e7eef5] text-steel',
  warn: 'bg-[#f6efd9] text-warn',
  ok: 'bg-[#e4f1ea] text-ok',
  crit: 'bg-[#f6e6e2] text-crit',
};

export function StatusPill({ status, label, className = '' }: { status: string; label?: string; className?: string }) {
  const tone = TONE[status] ?? 'muted';
  return <span className={`pill ${CLS[tone]} ${className}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}
