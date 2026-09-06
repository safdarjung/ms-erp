// Indian number formatting (lakh/crore grouping). Amounts are numeric(14,2),
// which arrive as strings from the DB driver — accept both.

function toNumber(amount: number | string | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return Number.isFinite(n) ? n : null;
}

/** "₹12,000" for whole rupees, "₹12,000.50" when there are paise. */
export function formatINR(amount: number | string | null | undefined): string {
  const n = toNumber(amount);
  if (n === null) return '₹0';
  const isWhole = Math.abs(n - Math.round(n)) < 0.005;
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Trim trailing zeros after a decimal point: "1.50" → "1.5", "2.00" → "2". */
function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '');
}

/** Compact amounts for tiles and lists: "₹1.5 lakh", "₹2 Cr", "₹12,000". */
export function formatINRShort(amount: number | string | null | undefined): string {
  const n = toNumber(amount) ?? 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${trimZeros((abs / 1e7).toFixed(2))} Cr`;
  if (abs >= 1e5) return `${sign}₹${trimZeros((abs / 1e5).toFixed(2))} lakh`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}
