// Unified status pill with consistent colour semantics across enquiries,
// quotations, orders, bills and the email inbox. Colour is always backed by a
// text label so meaning never rests on colour alone (accessibility).

type Tone = 'muted' | 'steel' | 'warn' | 'ok' | 'crit' | 'dark';

const TONE: Record<string, Tone> = {
  // neutral / not started
  draft: 'muted', new: 'muted', open: 'muted', archived: 'muted', unregistered: 'muted',
  pending: 'muted', ignored: 'muted', dismissed: 'muted', spam: 'muted',
  // informational / in touch
  sent: 'steel', contacted: 'steel', issued: 'steel', registered: 'steel', active: 'steel', duplicate: 'steel',
  // attention / partly done
  negotiation: 'warn', partial: 'warn', partially_paid: 'warn', due_soon: 'warn', unpaid: 'warn', in_progress: 'warn',
  // done / positive
  approved: 'ok', won: 'ok', delivered: 'ok', paid: 'ok', invoiced: 'ok', accepted: 'ok', created: 'ok',
  // finished and moved on
  converted: 'dark', billed: 'dark', closed: 'dark',
  // negative
  rejected: 'crit', cancelled: 'crit', lost: 'crit', overdue: 'crit', failed: 'crit', disabled: 'crit',
};

const CLS: Record<Tone, string> = {
  muted: 'bg-surface-2 text-muted',
  steel: 'bg-[#e7eef5] text-steel',
  warn: 'bg-[#f6efd9] text-warn',
  ok: 'bg-[#e4f1ea] text-ok',
  crit: 'bg-[#f6e6e2] text-crit',
  dark: 'bg-[#dfe4ea] text-ink',
};

export function StatusPill({ status, label, className = '' }: { status: string; label?: string; className?: string }) {
  const tone = TONE[status] ?? 'muted';
  return <span className={`pill whitespace-nowrap ${CLS[tone]} ${className}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}
