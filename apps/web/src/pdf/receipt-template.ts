// PAYMENT RECEIPT on the company letterhead — one payment against one bill,
// with what that bill still owes afterwards. Pure function: typed data in,
// self-contained print-ready HTML out. Half a page of content on an A4 sheet;
// the balance figure is computed upstream (src/lib/statement-ledger.ts).

import {
  ADDR_FIT_SCRIPT, FOOTER_CSS, INFO_CSS, LETTERHEAD_CSS, SHEET_CSS,
  esc, inr, multiline, renderLetterhead, renderSignCell, type LetterheadCompany,
} from './document-template';

export type ReceiptData = {
  company: LetterheadCompany;
  receiptNo: string;
  /** Preformatted payment date. */
  date: string;
  receivedFrom: { name: string; addressLines: string[]; gstin?: string; phone?: string };
  amount: number;
  amountWords: string;
  /** Plain-language method, e.g. "UPI". */
  methodLabel: string;
  reference?: string;
  notes?: string;
  /** Cheque payments: the receipt holds good only once the cheque clears. */
  subjectToRealisation?: boolean;
  bill: {
    number: string;
    /** Preformatted bill date. */
    date: string;
    total: number;
    /** Everything received on this bill up to and including this payment. */
    receivedUpTo: number;
    balanceAfter: number;
    cancelled?: boolean;
  };
};

const SETTLED_EPS = 0.5;

export function renderReceiptHTML(d: ReceiptData): string {
  const from = d.receivedFrom;
  const settled = d.bill.balanceAfter <= SETTLED_EPS;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PAYMENT RECEIPT ${esc(d.receiptNo)} — ${esc(d.company.name)}</title>
<style>
${SHEET_CSS}

${LETTERHEAD_CSS}

${INFO_CSS}

  /* ── Amount + bill ──────────────────────────────────────────── */
  .amtbox {
    margin-top: 8px; border: 1px solid #111; background: #f0f3f5; padding: 10px 12px;
    display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }
  .amtbox .amt { font-size: 22px; font-weight: 800; letter-spacing: .5px; font-variant-numeric: tabular-nums; }
  .amtbox .amtw { font-weight: 700; font-style: italic; font-size: 11px; }
  table.bill { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  table.bill th, table.bill td { border: 1px solid #111; padding: 6px 8px; }
  table.bill thead th {
    background: #f0f3f5; font-size: 9px; letter-spacing: .8px; text-transform: uppercase;
    text-align: center; padding: 7px 6px;
  }
  .c { text-align: center; } .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: 'Courier New', monospace; font-size: 10px; }
  .due { font-weight: 700; }
  .thanks { margin-top: 12px; font-size: 12px; font-weight: 700; }
  .note { margin-top: 4px; font-size: 9.5px; color: #333; }

${FOOTER_CSS}
  .rnote { width: 62%; font-size: 9.5px; line-height: 1.6; }
  .sign { width: 38%; }
</style></head>
<body>
<div class="sheet">
${renderLetterhead(d.company, 'PAYMENT RECEIPT')}

  <table class="info">
    <tr>
      <td class="buyer">
        <div class="to">Received with thanks from</div>
        <div class="nm">${esc(from.name)}</div>
        ${from.addressLines.map((l) => `<div>${multiline(l)}</div>`).join('')}
        ${from.gstin ? `<div class="gstline">GSTIN : ${esc(from.gstin)}</div>` : ''}
        ${from.phone ? `<div>Phone : ${esc(from.phone)}</div>` : ''}
      </td>
      <td>
        <div class="metarow docno"><span>Receipt No.</span><b>${esc(d.receiptNo)}</b></div>
        <div class="metarow"><span>Date</span><b>${esc(d.date)}</b></div>
        <div class="metarow"><span>Paid by</span><b>${esc(d.methodLabel)}</b></div>
        ${d.reference ? `<div class="metarow"><span>Reference / UTR</span><b>${esc(d.reference)}</b></div>` : ''}
      </td>
    </tr>
  </table>

  <div class="amtbox">
    <div><div class="boxlab">Amount received</div><div class="amt">₹ ${inr(d.amount)}</div></div>
    <div class="amtw">${esc(d.amountWords)}</div>
  </div>

  <table class="bill">
    <colgroup>
      <col style="width:22%"><col style="width:16%"><col style="width:20%"><col style="width:20%"><col style="width:22%">
    </colgroup>
    <thead>
      <tr><th>Against bill</th><th>Bill date</th><th>Bill total (₹)</th><th>Received so far (₹)</th><th>Still due on this bill (₹)</th></tr>
    </thead>
    <tbody>
      <tr>
        <td class="c mono">${esc(d.bill.number)}${d.bill.cancelled ? '<div class="note">Bill cancelled</div>' : ''}</td>
        <td class="c">${esc(d.bill.date)}</td>
        <td class="r">${inr(d.bill.total)}</td>
        <td class="r">${inr(d.bill.receivedUpTo)}</td>
        <td class="r due">${settled ? 'Nil — fully paid' : inr(d.bill.balanceAfter)}</td>
      </tr>
    </tbody>
  </table>

  ${d.notes ? `<div class="note"><b>Note:</b> ${multiline(d.notes)}</div>` : ''}
  <div class="thanks">Thank you for your payment.</div>

  <table class="footer">
    <tr>
      <td class="rnote">
        <div class="boxlab">Please note</div>
        Please keep this receipt for your records.${d.subjectToRealisation ? ' Cheque payments are subject to realisation.' : ''}
        ${settled ? ' This bill is now fully paid.' : ' The balance shown is what is still due on this bill after this payment.'}
      </td>
${renderSignCell(d.company.name)}
    </tr>
  </table>
  <div class="fine">Subject to Faridabad jurisdiction · E. &amp; O.E. · This is a computer-generated receipt.</div>
</div>
${ADDR_FIT_SCRIPT}
</body></html>`;
}
