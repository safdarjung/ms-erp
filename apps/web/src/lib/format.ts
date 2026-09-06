// Date helpers. Everything renders in India time so a bill dated "2 Sep 2026"
// reads the same on the shop floor and on a server abroad.

const IST = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

// Intl's en-IN short month is "Sept" on newer ICU builds; we want a stable "Sep",
// so pull the numeric parts in IST and name the month ourselves.
const PARTS = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: IST });

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function istParts(dt: Date): { day: number; month: number; year: number } {
  const get = (type: string) => Number(PARTS.formatToParts(dt).find((p) => p.type === type)?.value ?? 0);
  return { day: get('day'), month: get('month'), year: get('year') };
}

/** "2 Sep 2026" (India time). "—" when there is no date. */
export function formatDate(d: Date | string | null | undefined): string {
  const dt = toDate(d);
  if (!dt) return '—';
  const { day, month, year } = istParts(dt);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "2 Sep" — for tight columns and cards. */
export function formatDateShort(d: Date | string | null | undefined): string {
  const dt = toDate(d);
  if (!dt) return '—';
  const { day, month } = istParts(dt);
  return `${day} ${MONTHS[month - 1]}`;
}

/** Whole calendar days from today (IST) to `d`. Negative = in the past. */
export function daysFromToday(d: Date | string | null | undefined, now: Date = new Date()): number | null {
  const dt = toDate(d);
  if (!dt) return null;
  const a = istParts(dt);
  const b = istParts(now);
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcA - utcB) / DAY_MS);
}

export type DueTone = 'crit' | 'warn' | 'muted';

/** "Today" / "Overdue by 3 days" / "Tomorrow" / "15 Sep" with a colour tone. */
export function followupLabel(d: Date | string | null | undefined): { text: string; tone: DueTone } | null {
  const days = daysFromToday(d);
  if (days === null) return null;
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone: 'crit' };
  if (days === 0) return { text: 'Today', tone: 'warn' };
  if (days === 1) return { text: 'Tomorrow', tone: 'muted' };
  return { text: formatDateShort(d), tone: 'muted' };
}

/** "Overdue · 12 days" / "Due today" / "Due 15 Sep" for a bill that still has money due. */
export function dueLabel(d: Date | string | null | undefined): { text: string; tone: DueTone } | null {
  const days = daysFromToday(d);
  if (days === null) return null;
  if (days < 0) return { text: `Overdue · ${-days} day${days === -1 ? '' : 's'}`, tone: 'crit' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `Due ${formatDateShort(d)}`, tone: 'muted' };
}
