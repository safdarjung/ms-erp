// Customer STATEMENT OF ACCOUNT on the company letterhead — a plain ledger of
// bills raised (debit) and payments received (credit) with a running balance,
// then the ageing of whatever is still due. Pure function: typed data in,
// self-contained print-ready HTML out. Every figure is computed upstream
// (src/lib/statement-ledger.ts); this file only PRESENTS stored values.

import {
  ADDR_FIT_SCRIPT, FOOTER_CSS, INFO_CSS, LETTERHEAD_CSS, SHEET_CSS,
  esc, inr, multiline, renderBankCell, renderLetterhead, renderSignCell, type LetterheadCompany,
} from './document-template';

export type StatementRow = {
  /** Preformatted, e.g. "5 Apr 2026". */
  date: string;
  particulars: string;
  /** Bill a payment was recorded against (payments only). */
  against?: string;
  debit: number;
  credit: number;
  /** Running balance: positive = customer owes, negative = advance held. */
  balance: number;
};

export type StatementData = {
  company: LetterheadCompany;
  customer: { name: string; addressLines: string[]; gstin?: string; phone?: string; stateLabel?: string };
  /** Preformatted dates. */
  period: { from: string; to: string };
  /** Preformatted date the statement was produced. */
  generatedOn: string;
  opening: number;
  rows: StatementRow[];
  closing: number;
  totals: { debit: number; credit: number };
  /** Closing balance in words (of the absolute amount). */
  closingWords: string;
  aging: { current: number; d30: number; d60: number; d60plus: number; total: number };
  /** Live (non-cancelled) bills on the account. */
  billCount: number;
};

/** Balance column: an advance (negative) prints as "5,000.00 Cr". */
const bal = (n: number): string => (n < -0.005 ? `${inr(-n)} Cr` : inr(n));

const SETTLED_EPS = 0.5;

function closingLabel(closing: number): string {
  if (closing > SETTLED_EPS) return 'Balance due (baaki)';
  if (closing < -SETTLED_EPS) return 'Advance held — we owe the customer';
  return 'Balance due — Nil (fully settled)';
}

export function renderStatementHTML(d: StatementData): string {
  const rowsHtml = d.rows.map((r) => `
        <tr>
          <td class="c">${esc(r.date)}</td>
          <td>${esc(r.particulars)}${r.against ? `<div class="against">against ${esc(r.against)}</div>` : ''}</td>
          <td class="r">${r.debit ? inr(r.debit) : ''}</td>
          <td class="r">${r.credit ? inr(r.credit) : ''}</td>
          <td class="r">${bal(r.balance)}</td>
        </tr>`).join('');

  const emptyHtml = d.rows.length ? '' : `
        <tr><td class="c mut" colspan="5">No bills or payments in this period.</td></tr>`;

  const aging = [
    { label: 'Not yet due', value: d.aging.current },
    { label: '1–30 days late', value: d.aging.d30 },
    { label: '31–60 days late', value: d.aging.d60 },
    { label: 'Over 60 days late', value: d.aging.d60plus },
  ];

  const c = d.customer;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STATEMENT OF ACCOUNT ${esc(c.name)} — ${esc(d.company.name)}</title>
<style>
${SHEET_CSS}

${LETTERHEAD_CSS}

${INFO_CSS}

  /* ── Ledger ─────────────────────────────────────────────────── */
  .grow { flex: 1; display: flex; flex-direction: column; margin-top: 8px; }
  .legend { font-size: 9px; color: #555; margin-bottom: 4px; }
  table.ledger { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.ledger th, table.ledger td { border: 1px solid #111; padding: 5px 8px; vertical-align: top; }
  table.ledger thead th {
    background: #f0f3f5; font-size: 9px; letter-spacing: .8px; text-transform: uppercase;
    text-align: center; padding: 7px 6px;
  }
  table.ledger tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .c { text-align: center; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .against { font-size: 9px; color: #555; }
  tr.open td, tr.tot td { background: #f7f9fa; font-weight: 600; }
  tr.close td { background: #f0f3f5; font-size: 11.5px; font-weight: 700; padding: 7px 8px; }
  .lbl { text-align: right; color: #333; }

  /* ── Summary: words + ageing ────────────────────────────────── */
  table.summary { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.summary td { border: 1px solid #111; vertical-align: top; padding: 7px 9px; width: 50%; }
  .words .val { font-weight: 700; font-style: italic; line-height: 1.55; }
  .words .note { margin-top: 6px; font-size: 9.5px; color: #333; }
  .age .metarow b { font-variant-numeric: tabular-nums; }
  .age .metarow.tot { font-weight: 700; }
  .age .metarow.tot span { color: #111; }

${FOOTER_CSS}
  .terms { font-size: 9.5px; line-height: 1.6; }
</style></head>
<body>
<div class="sheet">
${renderLetterhead(d.company, 'STATEMENT OF ACCOUNT')}

  <table class="info">
    <tr>
      <td class="buyer">
        <div class="to">Statement for</div>
        <div class="nm">${esc(c.name)}</div>
        ${c.addressLines.map((l) => `<div>${multiline(l)}</div>`).join('')}
        ${c.gstin ? `<div class="gstline">GSTIN : ${esc(c.gstin)}</div>` : ''}
        ${c.stateLabel ? `<div>State : ${esc(c.stateLabel)}</div>` : ''}
        ${c.phone ? `<div>Phone : ${esc(c.phone)}</div>` : ''}
      </td>
      <td>
        <div class="metarow docno"><span>Period</span><b>${esc(d.period.from)} – ${esc(d.period.to)}</b></div>
        <div class="metarow"><span>Statement date</span><b>${esc(d.generatedOn)}</b></div>
        <div class="metarow"><span>Bills on account</span><b>${d.billCount}</b></div>
        <div class="metarow"><span>${esc(closingLabel(d.closing))}</span><b>₹ ${bal(d.closing)}</b></div>
      </td>
    </tr>
  </table>

  <div class="grow">
    <div class="legend">Debit = bill raised · Credit = payment received · Balance = what is still due (Cr = advance with us)</div>
    <table class="ledger">
      <colgroup>
        <col style="width:14%"><col style="width:44%"><col style="width:14%"><col style="width:14%"><col style="width:14%">
      </colgroup>
      <thead>
        <tr><th>Date</th><th>Particulars</th><th>Debit (₹)</th><th>Credit (₹)</th><th>Balance (₹)</th></tr>
      </thead>
      <tbody>
        <tr class="open">
          <td class="c">${esc(d.period.from)}</td>
          <td>Opening balance</td>
          <td class="r"></td>
          <td class="r"></td>
          <td class="r">${bal(d.opening)}</td>
        </tr>${rowsHtml}${emptyHtml}
        <tr class="tot">
          <td class="lbl" colspan="2">Total for the period</td>
          <td class="r">${inr(d.totals.debit)}</td>
          <td class="r">${inr(d.totals.credit)}</td>
          <td class="r"></td>
        </tr>
        <tr class="close">
          <td class="lbl" colspan="4">${esc(closingLabel(d.closing))}</td>
          <td class="r">₹ ${bal(d.closing)}</td>
        </tr>
      </tbody>
    </table>

    <table class="summary">
      <tr>
        <td class="words">
          <div class="boxlab">Closing balance in words</div>
          <div class="val">${esc(d.closingWords)}</div>
          <div class="note">Please check this statement against your records and let us know of any difference within 7 days. Kindly quote the bill number when making a payment.</div>
        </td>
        <td class="age">
          <div class="boxlab">Ageing of amount due (as on ${esc(d.generatedOn)})</div>
          ${aging.map((a) => `<div class="metarow"><span>${esc(a.label)}</span><b>${inr(a.value)}</b></div>`).join('')}
          <div class="metarow tot"><span>Total due</span><b>₹ ${inr(d.aging.total)}</b></div>
        </td>
      </tr>
    </table>
  </div>

  <table class="footer">
    <tr>
      <td class="terms">
        <div class="boxlab">Payment</div>
        Please pay the balance due by bank transfer or UPI to the account alongside, quoting the bill number. Payments received after ${esc(d.period.to)} are not shown here.
      </td>
${renderBankCell(d.company.bank)}
${renderSignCell(d.company.name)}
    </tr>
  </table>
  <div class="fine">Subject to Faridabad jurisdiction · E. &amp; O.E. · This is a computer-generated statement.</div>
</div>
${ADDR_FIT_SCRIPT}
</body></html>`;
}
