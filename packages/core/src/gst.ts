// India GST computation — deterministic (never AI). Given line items and
// whether the supply is inter-state, split into CGST/SGST (intra) or IGST (inter).

export type GstLine = { qty: number | string; rate: number | string; gstRate: number | string };
export type GstTotals = {
  subtotal: number; cgst: number; sgst: number; igst: number; taxTotal: number; grand: number;
};

const num = (v: number | string) => (typeof v === 'string' ? Number(v) : v) || 0;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeGst(lines: GstLine[], interstate: boolean): GstTotals {
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
  for (const l of lines) {
    const taxable = num(l.qty) * num(l.rate);
    subtotal += taxable;
    const tax = taxable * (num(l.gstRate) / 100);
    if (interstate) igst += tax;
    else { cgst += tax / 2; sgst += tax / 2; }
  }
  subtotal = r2(subtotal); cgst = r2(cgst); sgst = r2(sgst); igst = r2(igst);
  const taxTotal = r2(cgst + sgst + igst);
  return { subtotal, cgst, sgst, igst, taxTotal, grand: r2(subtotal + taxTotal) };
}

/** Inter-state when supplier & buyer GSTIN states differ. Unknown buyer → treat as intra. */
export function isInterstate(supplierStateCode?: string | null, buyerStateCode?: string | null): boolean {
  if (!supplierStateCode || !buyerStateCode) return false;
  return supplierStateCode !== buyerStateCode;
}

/** Financial year label for a date, e.g. 2026-07-01 → "26-27" (FY starts April). */
export function financialYear(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ── Amount in words (Indian system) ─────────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function two(n: number): string {
  return n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? ' ' + ONES[n % 10] : '');
}
function three(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  let n = rupees;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(two(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  let words = parts.join(' ').trim() + ' Rupees';
  if (paise) words += ' and ' + two(paise) + ' Paise';
  return words + ' Only';
}
