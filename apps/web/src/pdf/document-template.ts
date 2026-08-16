// Custom-template renderer for M.S. Enterprises documents — quotation,
// proforma and GST tax invoice on the company letterhead (docs/05 §4).
// Pure function: typed DocumentData in → self-contained print-ready HTML out.
// Every figure is computed upstream deterministically (@ms/core computeGst);
// this file only PRESENTS stored values — it never recomputes legal numbers.

export type TaxLine = { label: string; amount: number };
export type DocColumn = { id: string; label: string };
export type DocItem = {
  description: string;
  hsn: string;
  qty: number;
  uom: string;
  rate: number;
  /** Line taxable value as stored (qty × rate, rounded once upstream). */
  amount: number;
  isTooling?: boolean;
  /** Part/section heading this row sits under (blank = ungrouped). */
  groupLabel?: string;
  /** Custom-column values keyed by DocColumn.id. */
  attributes?: Record<string, string>;
};

export type DocumentData = {
  docLabel: 'TAX INVOICE' | 'PROFORMA INVOICE' | 'QUOTATION';
  company: {
    name: string;
    factory: string;
    office: string;
    gstin: string;
    bank: { name: string; acNo: string; ifsc: string };
  };
  buyer: {
    name: string;
    addressLines: string[];
    gstin?: string;
    stateLabel?: string;
  };
  number: string;
  /** Right-hand meta rows: Date, PO Ref, Place of Supply, Validity… */
  meta: { label: string; value: string }[];
  /** User-defined descriptive columns (rendered between Description and HSN). */
  columns?: DocColumn[];
  items: DocItem[];
  totals: {
    subtotal: number;
    taxLines: TaxLine[];
    roundOff?: number;
    grand: number;
    words: string;
  };
  terms: string[];
  notes?: string;
};

/** Stored tax totals with % labels when all items share one GST rate. */
export function buildTaxLines(
  interstate: boolean,
  gstRates: number[],
  totals: { cgst: number; sgst: number; igst: number },
): TaxLine[] {
  const one = new Set(gstRates).size === 1 ? gstRates[0]! : null;
  return interstate
    ? [{ label: `IGST${one !== null ? ` @ ${one}%` : ''}`, amount: totals.igst }]
    : [
        { label: `CGST${one !== null ? ` @ ${one / 2}%` : ''}`, amount: totals.cgst },
        { label: `SGST${one !== null ? ` @ ${one / 2}%` : ''}`, amount: totals.sgst },
      ];
}

// ── Formatting ──────────────────────────────────────────────────────────────

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => String(Number(n));
const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const multiline = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

export function renderDocumentHTML(d: DocumentData): string {
  const cols = d.columns ?? [];
  const K = cols.length;
  // Columns: S.No | Description | …custom | HSN | Qty | UOM | Rate | Amount.
  const NCOL = 7 + K;

  // Column widths (%). Fixed for the numeric/code columns; Description + custom
  // columns share the remainder, Description weighted 2× so it stays widest.
  const fixed = { sno: 5, hsn: 9, qty: 6, uom: 6, rate: 11, amount: 12 };
  const flex = 100 - (fixed.sno + fixed.hsn + fixed.qty + fixed.uom + fixed.rate + fixed.amount);
  const descW = (flex * 2) / (2 + K);
  const custW = K ? flex / (2 + K) : 0;
  const colgroupHtml = [
    `<col style="width:${fixed.sno}%">`,
    `<col style="width:${descW.toFixed(2)}%">`,
    ...cols.map(() => `<col style="width:${custW.toFixed(2)}%">`),
    `<col style="width:${fixed.hsn}%">`,
    `<col style="width:${fixed.qty}%">`,
    `<col style="width:${fixed.uom}%">`,
    `<col style="width:${fixed.rate}%">`,
    `<col style="width:${fixed.amount}%">`,
  ].join('');

  const theadHtml = `<th>S.No</th><th>Description</th>${
    cols.map((c) => `<th>${esc(c.label)}</th>`).join('')
  }<th>HSN/SAC</th><th>Qty</th><th>UOM</th><th>Rate (₹)</th><th>Amount (₹)</th>`;

  const renderRow = (it: DocItem, sn: number) => `
      <tr>
        <td class="c">${sn}</td>
        <td class="desc">${multiline(it.description)}${it.isTooling ? '<div class="sub">One-time tooling / NRE charge</div>' : ''}</td>
        ${cols.map((c) => `<td class="c">${esc(it.attributes?.[c.id] ?? '')}</td>`).join('')}
        <td class="c mono">${esc(it.hsn)}</td>
        <td class="r">${qty(it.qty)}</td>
        <td class="c">${esc(it.uom)}</td>
        <td class="r">${inr(it.rate)}</td>
        <td class="r">${inr(it.amount)}</td>
      </tr>`;

  // Split into consecutive same-group segments; grouped segments get a heading
  // row + a subtotal row, ungrouped rows render bare. S.No stays continuous.
  type Seg = { group: string; items: DocItem[] };
  const segments: Seg[] = [];
  for (const it of d.items) {
    const g = (it.groupLabel ?? '').trim();
    const last = segments[segments.length - 1];
    if (last && last.group === g) last.items.push(it);
    else segments.push({ group: g, items: [it] });
  }

  let sn = 0;
  const itemRows = segments.map((seg) => {
    const body = seg.items.map((it) => renderRow(it, (sn += 1))).join('');
    if (!seg.group) return body;
    const sub = seg.items.reduce((s, it) => s + it.amount, 0);
    const header = `
      <tr class="grouphdr"><td class="ghead" colspan="${NCOL}">${esc(seg.group)}</td></tr>`;
    const subtotal = `
      <tr class="subtot"><td class="subl" colspan="${NCOL - 1}">Subtotal — ${esc(seg.group)}</td><td class="subv">${inr(sub)}</td></tr>`;
    return header + body + subtotal;
  }).join('');

  const fillCells = '<td></td>'.repeat(NCOL);

  const totalRows: { label: string; value: string; cls?: string }[] = [
    { label: 'Taxable Value', value: inr(d.totals.subtotal) },
    ...d.totals.taxLines.map((t) => ({ label: t.label, value: inr(t.amount) })),
    ...(d.totals.roundOff ? [{ label: 'Round Off', value: inr(d.totals.roundOff) }] : []),
    { label: 'Grand Total', value: `₹ ${inr(d.totals.grand)}`, cls: 'grand' },
  ];

  const metaRows = d.meta.map((m) => `
      <div class="metarow"><span>${esc(m.label)}</span><b>${esc(m.value)}</b></div>`).join('');

  const termsHtml = d.terms.length
    ? `<ol>${d.terms.map((t) => `<li>${esc(t.replace(/^\s*\d+[.)]\s*/, ''))}</li>`).join('')}</ol>`
    : '<div class="mut">—</div>';

  const b = d.company.bank;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.docLabel)} ${esc(d.number)} — ${esc(d.company.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: Arial, Helvetica, sans-serif; color: #111;
    font-size: 10.5px; line-height: 1.45;
  }
  .sheet { display: flex; flex-direction: column; min-height: 273mm; }
  @media screen {
    html { background: #eef1f4; }
    body { padding: 24px 12px; }
    .sheet {
      width: 210mm; min-height: 297mm; padding: 12mm; margin: 0 auto;
      background: #fff; box-shadow: 0 2px 24px rgba(20, 30, 40, .18);
    }
  }

  /* ── Letterhead ─────────────────────────────────────────────── */
  .band { background: #e6f4f8; text-align: center; padding: 12px 8px 9px; border-radius: 2px; }
  .band .name {
    font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 700;
    font-size: 38px; line-height: 1.05; color: #1c8ea8; letter-spacing: 2px;
  }
  .addr { display: flex; flex-direction: column; gap: 1px; margin: 7px 2px 0; font-weight: 600; font-size: 10px; }
  .addr .row { display: flex; justify-content: space-between; gap: 16px; }
  .addr .gst { white-space: nowrap; }
  .rule { border-top: 2.5px solid #111; margin: 7px 0 0; }

  .doctype {
    text-align: center; font-weight: 800; font-size: 20px; letter-spacing: 3px;
    text-transform: uppercase; margin: 11px 0 9px; color: #000;
  }

  /* ── Buyer / meta grid ──────────────────────────────────────── */
  table.info { width: 100%; border-collapse: collapse; }
  table.info td { border: 1px solid #111; vertical-align: top; padding: 7px 9px; }
  .buyer { width: 55%; }
  .buyer .to { font-size: 8.5px; letter-spacing: 1.2px; text-transform: uppercase; color: #555; margin-bottom: 3px; }
  .buyer .nm { font-weight: 700; font-size: 12px; margin-bottom: 1px; }
  .buyer .gstline { font-weight: 700; margin-top: 4px; }
  .metarow { display: flex; justify-content: space-between; gap: 12px; padding: 2.5px 0; border-bottom: 1px solid #e2e2e2; }
  .metarow:last-child { border-bottom: none; }
  .metarow span { color: #555; }
  .metarow b { text-align: right; }
  .docno { font-size: 12px; }

  /* ── Items ──────────────────────────────────────────────────── */
  .grow { flex: 1; display: flex; flex-direction: column; margin-top: 8px; }
  table.items { width: 100%; flex: 1; height: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th, table.items td { border: 1px solid #111; padding: 6px 8px; }
  table.items thead th {
    background: #f0f3f5; font-size: 9px; letter-spacing: .8px; text-transform: uppercase;
    text-align: center; padding: 7px 6px;
  }
  table.items td { vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; }
  .r, .tvalue { font-variant-numeric: tabular-nums; }
  .mono { font-family: 'Courier New', monospace; font-size: 10px; }
  .desc { line-height: 1.5; }
  .desc .sub { font-style: italic; font-size: 9px; color: #444; margin-top: 1px; }
  /* Part grouping */
  tr.grouphdr td.ghead {
    background: #e9eef1; font-weight: 700; font-size: 10.5px; letter-spacing: .3px; padding: 6px 8px;
  }
  tr.grouphdr td.ghead::before { content: "▸ "; color: #1c8ea8; }
  tr.subtot td { background: #f7f9fa; font-weight: 600; }
  tr.subtot .subl { text-align: right; color: #333; }
  tr.subtot .subv { text-align: right; font-variant-numeric: tabular-nums; }
  tr.fill td { height: 100%; border-top: none; border-bottom: none; }
  tr.fill td:first-child { min-height: 18mm; }

  /* ── Totals (tbody, not tfoot — tfoot would repeat per printed page) ── */
  .words { vertical-align: top; line-height: 1.55; }
  .words .lab { font-size: 8.5px; letter-spacing: 1.2px; text-transform: uppercase; color: #555; margin-bottom: 2px; }
  .words .val { font-weight: 700; font-style: italic; }
  .words .notes { margin-top: 6px; font-size: 9.5px; color: #333; }
  .words .notes b { font-style: normal; }
  .tlabel { text-align: right; font-weight: 600; color: #333; }
  .tvalue { text-align: right; font-weight: 600; }
  tr.grand td { background: #f0f3f5; font-size: 12px; font-weight: 700; padding: 7px 8px; }
  tr.grand .tlabel { color: #111; letter-spacing: .5px; }

  /* ── Footer: terms / bank / signature ───────────────────────── */
  table.footer { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.footer td { border: 1px solid #111; vertical-align: top; padding: 7px 9px; }
  .boxlab { font-size: 8.5px; letter-spacing: 1.2px; text-transform: uppercase; color: #555; margin-bottom: 3px; }
  .terms { width: 44%; font-size: 9.5px; }
  .terms ol { padding-left: 14px; }
  .terms li { margin: 1.5px 0; }
  .bank { width: 28%; font-size: 9.5px; line-height: 1.6; }
  .bank b { font-size: 10px; }
  .sign { width: 28%; }
  .signin { display: flex; flex-direction: column; justify-content: space-between; min-height: 24mm; }
  .signin .for { font-weight: 700; font-size: 10.5px; }
  .signin .who { text-align: center; padding-top: 3px; border-top: 1px solid #999; font-size: 9.5px; }
  .fine { text-align: center; color: #777; font-size: 8px; letter-spacing: .4px; margin-top: 6px; }
  .mut { color: #999; }
</style></head>
<body>
<div class="sheet">
  <header>
    <div class="band"><div class="name">${esc(d.company.name)}</div></div>
    <div class="addr">
      <div>${esc(d.company.factory)}</div>
      <div class="row"><span>${esc(d.company.office)}</span><span class="gst">GSTIN&nbsp;: ${esc(d.company.gstin)}</span></div>
    </div>
    <div class="rule"></div>
    <div class="doctype">${esc(d.docLabel)}</div>
  </header>

  <table class="info">
    <tr>
      <td class="buyer">
        <div class="to">${d.docLabel === 'QUOTATION' ? 'Quotation to' : 'Bill to'}</div>
        <div class="nm">${esc(d.buyer.name)}</div>
        ${d.buyer.addressLines.map((l) => `<div>${multiline(l)}</div>`).join('')}
        ${d.buyer.gstin ? `<div class="gstline">GSTIN : ${esc(d.buyer.gstin)}</div>` : ''}
        ${d.buyer.stateLabel ? `<div>State : ${esc(d.buyer.stateLabel)}</div>` : ''}
      </td>
      <td>
        <div class="metarow docno"><span>${d.docLabel === 'QUOTATION' ? 'Quotation No.' : 'Invoice No.'}</span><b>${esc(d.number)}</b></div>
        ${metaRows}
      </td>
    </tr>
  </table>

  <div class="grow">
    <table class="items">
      <colgroup>${colgroupHtml}</colgroup>
      <thead>
        <tr>${theadHtml}</tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="fill">${fillCells}</tr>
        <tr>
          <td class="words" colspan="${NCOL - 3}" rowspan="${totalRows.length}">
            <div class="lab">Amount in words</div>
            <div class="val">${esc(d.totals.words)}</div>
            ${d.notes ? `<div class="notes"><b>Note:</b> ${multiline(d.notes)}</div>` : ''}
          </td>
          <td class="tlabel" colspan="2">${esc(totalRows[0]!.label)}</td>
          <td class="tvalue">${esc(totalRows[0]!.value)}</td>
        </tr>
        ${totalRows.slice(1).map((t) => `
        <tr class="${t.cls ?? ''}">
          <td class="tlabel" colspan="2">${esc(t.label)}</td>
          <td class="tvalue">${esc(t.value)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <table class="footer">
    <tr>
      <td class="terms">
        <div class="boxlab">Terms &amp; Conditions</div>
        ${termsHtml}
      </td>
      <td class="bank">
        <div class="boxlab">Our Bank Details</div>
        <b>${esc(b.name)}</b><br>
        A/C No. : ${esc(b.acNo)}<br>
        IFSC : ${esc(b.ifsc)}
      </td>
      <td class="sign">
        <div class="signin">
          <div class="for">For ${esc(d.company.name)}</div>
          <div class="who">Authorised Signatory</div>
        </div>
      </td>
    </tr>
  </table>
  <div class="fine">Subject to Faridabad jurisdiction · E. &amp; O.E.${d.docLabel === 'QUOTATION' ? '' : ' · This is a computer-generated invoice.'}</div>
</div>
</body></html>`;
}
