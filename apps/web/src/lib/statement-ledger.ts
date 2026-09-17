// Pure arithmetic behind the customer STATEMENT OF ACCOUNT and the PAYMENT
// RECEIPT. No imports on purpose: callers hand in plain numbers and ISO
// strings, so this can be unit-tested with node's runner and never touches the
// database. Every date is reduced to an IST calendar day — a bill dated
// "2 Sep" reads the same on the shop floor and on a server abroad.

export type LedgerBill = {
  id: string;
  number: string;
  /** ISO timestamp or a YYYY-MM-DD day. */
  date: string;
  amount: number;
  poRef?: string | null;
  /** Bills marked 'cancelled' are ignored, along with their payments. */
  status?: string;
};

export type LedgerPayment = {
  id: string;
  billId: string;
  date: string;
  amount: number;
  /** Plain-language method, e.g. "UPI" (caller resolves PAYMENT_METHOD_LABELS). */
  methodLabel?: string;
  reference?: string | null;
  /** ISO timestamp; tiebreak for two payments on the same day. */
  createdAt?: string;
};

export type LedgerRow = {
  kind: 'bill' | 'payment';
  /** IST calendar day, YYYY-MM-DD. */
  date: string;
  particulars: string;
  /** Bill number a payment was recorded against (payments only). */
  against?: string;
  debit: number;
  credit: number;
  /** Running balance after this row: positive = customer owes, negative = advance. */
  balance: number;
  refId: string;
};

export type Ledger = {
  from: string;
  to: string;
  opening: number;
  rows: LedgerRow[];
  closing: number;
  totals: { debit: number; credit: number };
};

export type AgingBuckets = { current: number; d30: number; d60: number; d60plus: number; total: number };

const DAY_MS = 86_400_000;
// IST has no daylight saving, so a fixed offset is exact and needs no Intl data.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** IST calendar day of an ISO timestamp; a bare YYYY-MM-DD passes through. Throws on garbage. */
export function istDay(date: string): string {
  if (ISO_DAY.test(date)) return date;
  const t = Date.parse(date);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${date}`);
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A strictly valid YYYY-MM-DD (real calendar date) or null. Used to vet query params. */
export function parseIsoDay(s: string | null | undefined): string | null {
  if (!s || !ISO_DAY.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return ok ? s : null;
}

/** Current Indian financial year to date, in IST: 1 April → today. */
export function defaultStatementPeriod(now: Date = new Date()): { from: string; to: string } {
  const to = istDay(now.toISOString());
  const year = Number(to.slice(0, 4));
  const month = Number(to.slice(5, 7));
  const fyStart = month >= 4 ? year : year - 1;
  return { from: `${fyStart}-04-01`, to };
}

function billParticulars(b: LedgerBill): string {
  return `Bill ${b.number}${b.poRef ? ` · PO ${b.poRef}` : ''}`;
}

function paymentParticulars(p: LedgerPayment): string {
  const parts = ['Payment received'];
  if (p.methodLabel) parts.push(p.methodLabel);
  if (p.reference) parts.push(`ref ${p.reference}`);
  return parts.join(' · ');
}

type Entry = {
  kind: 'bill' | 'payment';
  day: string;
  amount: number;
  particulars: string;
  against?: string;
  refId: string;
  /** Secondary sort key inside one day. */
  tie: string;
};

function compareEntries(a: Entry, b: Entry): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  // Same day: the bill is raised before the money for it arrives.
  if (a.kind !== b.kind) return a.kind === 'bill' ? -1 : 1;
  if (a.tie !== b.tie) return a.tie < b.tie ? -1 : 1;
  return a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0;
}

/**
 * Build the ledger rows for [from, to] (inclusive, IST days). Opening balance
 * is all activity before `from`; cancelled bills and their payments never
 * count. Positive balance = the customer still owes; negative = advance held.
 */
export function buildLedger(input: {
  bills: LedgerBill[];
  payments: LedgerPayment[];
  from: string;
  to: string;
}): Ledger {
  const { from, to } = input;
  const cancelled = new Set(input.bills.filter((b) => b.status === 'cancelled').map((b) => b.id));
  const numberOf = new Map(input.bills.map((b) => [b.id, b.number]));

  const entries: Entry[] = [];
  for (const b of input.bills) {
    if (cancelled.has(b.id)) continue;
    entries.push({
      kind: 'bill', day: istDay(b.date), amount: b.amount, particulars: billParticulars(b),
      refId: b.id, tie: b.number,
    });
  }
  for (const p of input.payments) {
    if (cancelled.has(p.billId)) continue;
    entries.push({
      kind: 'payment', day: istDay(p.date), amount: p.amount, particulars: paymentParticulars(p),
      against: numberOf.get(p.billId), refId: p.id, tie: p.createdAt ?? '',
    });
  }
  entries.sort(compareEntries);

  let opening = 0;
  const rows: LedgerRow[] = [];
  let balance = 0;
  let debit = 0;
  let credit = 0;

  for (const e of entries) {
    const signed = e.kind === 'bill' ? e.amount : -e.amount;
    if (e.day < from) { opening = r2(opening + signed); continue; }
    if (e.day > to) continue;
    if (rows.length === 0) balance = opening;
    balance = r2(balance + signed);
    if (e.kind === 'bill') debit = r2(debit + e.amount); else credit = r2(credit + e.amount);
    rows.push({
      kind: e.kind, date: e.day, particulars: e.particulars, against: e.against,
      debit: e.kind === 'bill' ? e.amount : 0,
      credit: e.kind === 'payment' ? e.amount : 0,
      balance, refId: e.refId,
    });
  }

  const closing = rows.length ? rows[rows.length - 1]!.balance : opening;
  return { from, to, opening, rows, closing, totals: { debit, credit } };
}

/**
 * Receivables ageing — the same bucketing as the analytics page: not yet due,
 * 1–30, 31–60 and over 60 days late, by each bill's own outstanding amount.
 */
export function agingBuckets(
  bills: { amount: number; received: number; dueDate?: string | null; status?: string }[],
  now: Date | string | number = Date.now(),
): AgingBuckets {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const a: AgingBuckets = { current: 0, d30: 0, d60: 0, d60plus: 0, total: 0 };
  for (const b of bills) {
    if (b.status === 'cancelled') continue;
    const outstanding = r2(b.amount - b.received);
    if (outstanding <= 0.5) continue;
    a.total += outstanding;
    const dueMs = b.dueDate ? Date.parse(b.dueDate) : NaN;
    const overdueDays = Number.isNaN(dueMs) ? -1 : Math.floor((nowMs - dueMs) / DAY_MS);
    if (overdueDays <= 0) a.current += outstanding;
    else if (overdueDays <= 30) a.d30 += outstanding;
    else if (overdueDays <= 60) a.d60 += outstanding;
    else a.d60plus += outstanding;
  }
  return { current: r2(a.current), d30: r2(a.d30), d60: r2(a.d60), d60plus: r2(a.d60plus), total: r2(a.total) };
}

// ── Payment receipt ─────────────────────────────────────────────────────────

/** "RCPT/20260903/1A2B3C4D" — IST day of payment + first 8 chars of the payment id. */
export function receiptRef(paymentId: string, paidOn: string): string {
  const day = istDay(paidOn).replace(/-/g, '');
  return `RCPT/${day}/${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * What the bill still owes after a given payment, counting every payment on
 * that bill up to and including it (ordered by paid-on, then created-at).
 * Null when the payment is not among the bill's payments.
 */
export function balanceAfterPayment(args: {
  billTotal: number;
  payments: { id: string; date: string; amount: number; createdAt?: string }[];
  paymentId: string;
}): { receivedUpTo: number; balance: number } | null {
  const sorted = [...args.payments].sort((a, b) => {
    const ta = Date.parse(a.date), tb = Date.parse(b.date);
    if (ta !== tb) return ta - tb;
    const ca = a.createdAt ?? '', cb = b.createdAt ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const idx = sorted.findIndex((p) => p.id === args.paymentId);
  if (idx < 0) return null;
  const receivedUpTo = r2(sorted.slice(0, idx + 1).reduce((s, p) => s + p.amount, 0));
  return { receivedUpTo, balance: r2(args.billTotal - receivedUpTo) };
}
