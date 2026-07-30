// Custom-template renderer for the GST bill/invoice — reproduces the
// M.S. Enterprises letterhead exactly (see docs/05 §4). Pure function:
// typed InvoiceData in → self-contained print-ready HTML out. The legal
// numbers are computed here deterministically; a headless browser turns
// this HTML into the final PDF.

export type TaxLine = { label: string; amount: number };
export type InvoiceItem = { description: string; hsn: string; qty: number; rate: number };

export type InvoiceData = {
  company: {
    name: string;
    factory: string;
    office: string;
    gstin: string;
    bank: { name: string; acNo: string; ifsc: string };
  };
  buyer: { name: string; addressLines: string[]; gstin?: string };
  billNo: string;
  date: string;
  docLabel?: string;
  items: InvoiceItem[];
  /** e.g. [{label:'IGST 18%', amount}] inter-state, or CGST+SGST intra-state */
  taxLines: TaxLine[];
  terms: string[];
};

const money = (n: number) => n.toFixed(2);
const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const multiline = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

export function renderInvoiceHTML(d: InvoiceData): string {
  const subtotal = d.items.reduce((s, i) => s + i.qty * i.rate, 0);
  const taxTotal = d.taxLines.reduce((s, t) => s + t.amount, 0);
  const grand = subtotal + taxTotal;
  const totalRows = 2 + d.taxLines.length; // Total + tax lines + G.TOTAL

  const itemRows = d.items
    .map(
      (i, idx) => `
      <tr>
        <td class="c">${idx + 1}.</td>
        <td class="desc">${multiline(i.description)}</td>
        <td class="c">${esc(i.hsn)}</td>
        <td class="c">${i.qty}</td>
        <td class="r">${money(i.rate)}</td>
        <td class="r">${money(i.qty * i.rate)}</td>
      </tr>`,
    )
    .join('');

  const taxRows = d.taxLines
    .map((t) => `<tr><td class="tl" colspan="2">${esc(t.label)}</td><td class="r tv">${money(t.amount)}</td></tr>`)
    .join('');

  const b = d.company.bank;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Bill ${esc(d.billNo)} — ${esc(d.company.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; }
  @media screen { body { max-width: 794px; margin: 16px auto; box-shadow: 0 0 0 1px #e2e2e2; background: #fff; } html { background: #f0f2f5; } }
  .band { background: #e6f4f8; text-align: center; padding: 10px 0 8px; }
  .title { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 700;
           font-size: 46px; color: #1c8ea8; letter-spacing: 2px; line-height: 1; }
  .addr { font-weight: 700; font-size: 12.5px; margin: 10px 2px 0; }
  .addr .row { display: flex; justify-content: space-between; gap: 12px; }
  .rule { border-top: 3px solid #000; margin: 6px 0 16px; }
  .buyer { margin: 0 4px 16px; line-height: 1.5; }
  .buyer .nm { font-size: 13px; }
  .buyer .gst { font-weight: 700; font-size: 11.5px; margin-top: 6px; }
  .billrow { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 8px; }
  .billno { font-weight: 700; font-size: 15px; }
  .date { font-weight: 700; font-size: 12px; }
  table.bill { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.bill th, table.bill td { border: 1px solid #000; padding: 6px 8px; vertical-align: top; }
  table.bill th { text-align: center; font-weight: 700; }
  .c { text-align: center; } .r { text-align: right; }
  .desc { white-space: normal; line-height: 1.5; }
  .spacer td { height: 210px; }
  .bank { font-size: 11px; line-height: 1.5; }
  tfoot .terms { font-size: 11px; white-space: pre-line; line-height: 1.5; }
  tfoot .tl { text-align: center; } tfoot .tv { font-variant-numeric: tabular-nums; }
  tfoot .gtot { font-weight: 700; }
</style></head>
<body>
  <div class="band"><div class="title">${esc(d.company.name)}</div></div>
  <div class="addr">
    <div>${esc(d.company.factory)}</div>
    <div class="row"><span>${esc(d.company.office)}</span><span>GSTIN: ${esc(d.company.gstin)}</span></div>
  </div>
  <div class="rule"></div>

  <div class="buyer">
    <div class="nm">${esc(d.buyer.name)}</div>
    ${d.buyer.addressLines.map((l) => `<div>${esc(l)}</div>`).join('')}
    ${d.buyer.gstin ? `<div class="gst">GST: ${esc(d.buyer.gstin)}</div>` : ''}
  </div>

  <div class="billrow"><span class="billno">${esc(d.docLabel ?? 'BILL')} No. ${esc(d.billNo)}</span><span class="date">Date- ${esc(d.date)}</span></div>

  <table class="bill">
    <colgroup>
      <col style="width:7%"><col style="width:45%"><col style="width:15%">
      <col style="width:7%"><col style="width:13%"><col style="width:13%">
    </colgroup>
    <thead>
      <tr><th>SNo.</th><th>Description</th><th>HSN CODE</th><th>QTY</th><th>Rate</th><th>Amount</th></tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="spacer"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr>
        <td></td>
        <td class="bank"><b>Our Bank Details:</b><br>${esc(b.name)},<br>A/C No. ${esc(b.acNo)}<br>IFSC- ${esc(b.ifsc)}</td>
        <td></td><td></td><td></td><td></td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td class="terms" colspan="3" rowspan="${totalRows}">${d.terms.map(esc).join('\n')}</td>
        <td class="tl" colspan="2">Total</td><td class="r tv">${money(subtotal)}</td>
      </tr>
      ${taxRows}
      <tr><td class="tl gtot" colspan="2">G. TOTAL</td><td class="r tv gtot">${money(grand)}</td></tr>
    </tfoot>
  </table>
</body></html>`;
}
