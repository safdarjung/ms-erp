// Dev helper: render sample documents to HTML for PDF preview.
//   tsx src/pdf/preview.ts <outdir>
// The samples are deliberately "worst realistic case" so the A4 layout can be
// eyeballed: several parts, several items per part, and rich per-item specs.
import { writeFileSync } from 'node:fs';
import { renderDocumentHTML, buildTaxLines, type DocumentData } from './document-template';

const COMPANY: DocumentData['company'] = {
  name: 'M.S. ENTERPRISES',
  factory: 'FACTORY: 5B-Sanjay Memorial Indl. Estate Phase-1, Near YMCA Chowk, N.I.T. FARIDABAD',
  office: 'OFFICE ADDRESS: NH 1C/69 NIT Faridabad',
  gstin: '06AKQPM8903J1ZN',
  bank: { name: 'PUNJAB NATIONAL BANK', acNo: '0483050019340', ifsc: 'PUNB0048320' },
};

const BUYER: DocumentData['buyer'] = {
  name: 'M/S CHATTERJI RUBBER MFG. CO.',
  addressLines: ['129A, J. K. Paul Road, Kolkata- 700038'],
  gstin: '19AADFC2983M1ZZ',
  stateLabel: '19 — West Bengal',
};

const TERMS = [
  'Delivery time 10 working days.',
  '50% advance, 25% against delivery, 25% after trial.',
  'GST extra as applicable.',
  'Plating and polishing charges extra.',
];

// ── Bill: one part, and two fields left undecided so the auto rule keeps them
// as table columns — this is what every older document looks like. ───────────
// Buyer is West Bengal (19) vs supplier Haryana (06) → inter-state → IGST.
const INVOICE: DocumentData = {
  docLabel: 'TAX INVOICE',
  company: COMPANY,
  buyer: BUYER,
  number: 'INV/26-27/0781',
  meta: [
    { label: 'Date', value: '01.07.2026' },
    { label: 'PO Ref.', value: 'CR/PO/2231' },
    { label: 'Place of Supply', value: '19 — West Bengal' },
    { label: 'Tax Type', value: 'IGST (inter-state)' },
  ],
  columns: [
    { id: 'cav', label: 'Cavities' },
    { id: 'steel', label: 'Steel grade' },
  ],
  items: [
    {
      description: 'Middle size 16 cavity rubber moulding die as per your drawing\nDie material EN 31',
      hsn: '84807100', qty: 1, uom: 'NOS', rate: 23000, amount: 23000,
      groupLabel: '16-CAV RUBBER DIE', groupNote: 'Drawing CR-16CAV-R2 · EN 31',
      attributes: { cav: '16', steel: 'EN 31' },
    },
    {
      description: 'Spare cavity insert set (matched to above die)',
      hsn: '84807100', qty: 2, uom: 'SET', rate: 2400, amount: 4800,
      groupLabel: '16-CAV RUBBER DIE', groupNote: 'Drawing CR-16CAV-R2 · EN 31',
      attributes: { cav: '4', steel: 'EN 31' },
    },
    { description: 'Polishing & lapping of cavity inserts', hsn: '998898', qty: 16, uom: 'NOS', rate: 120, amount: 1920 },
  ],
  totals: {
    subtotal: 29720,
    taxLines: buildTaxLines(true, [18, 18, 18], { cgst: 0, sgst: 0, igst: 5349.6 }),
    grand: 35069.6,
    words: 'Thirty Five Thousand Sixty Nine Rupees and Sixty Paise Only',
  },
  terms: TERMS,
};

// ── Quotation: the hard case. Two parts with notes, three dies each, six spec
// fields under the description + one short field kept as a table column, and a
// standalone one-time charge at the end. ────────────────────────────────────
const QCOLUMNS: DocumentData['columns'] = [
  { id: 'cav', label: 'Cavities', display: 'column' },
  { id: 'mat', label: 'Material', display: 'spec' },
  { id: 'hard', label: 'Hardness', display: 'spec' },
  { id: 'size', label: 'Size', display: 'spec' },
  { id: 'thk', label: 'Thickness', display: 'spec' },
  { id: 'fin', label: 'Finish', display: 'spec' },
  { id: 'tol', label: 'Tolerance', display: 'spec' },
];

const PART_A = { groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm' };
const PART_B = { groupLabel: '30017AW1007', groupNote: 'Drawing DRG-118 · mounting bracket, MS 3mm' };

const QUOTATION: DocumentData = {
  docLabel: 'QUOTATION',
  company: COMPANY,
  buyer: BUYER,
  number: 'QT/26-27/0042',
  meta: [
    { label: 'Date', value: '01.07.2026' },
    { label: 'Valid Until', value: '16.07.2026 (15 days)' },
    { label: 'Place of Supply', value: '19 — West Bengal' },
    { label: 'Tax Type', value: 'IGST (inter-state)' },
  ],
  columns: QCOLUMNS,
  items: [
    {
      ...PART_A,
      description: 'Blanking die — complete with die set, strippers and pilots',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 48500, amount: 48500,
      attributes: {
        cav: '1', mat: 'D2', hard: '58–60 HRC', size: '250 × 180 mm',
        thk: '2.0 mm', fin: 'Ground', tol: '±0.05 mm',
      },
    },
    {
      ...PART_A,
      description: 'Piercing die — 4 punches with quick-change punch holders',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 32000, amount: 32000,
      attributes: {
        cav: '4', mat: 'D2 body, OHNS punches', hard: '60–62 HRC', size: '250 × 180 mm',
        thk: '2.0 mm', fin: 'Ground', tol: '±0.03 mm',
      },
    },
    {
      ...PART_A,
      description: 'Forming die with spring-loaded pad',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 27500, amount: 27500,
      attributes: {
        cav: '1', mat: 'EN 31', hard: '56–58 HRC', size: '220 × 160 mm',
        thk: '2.0 mm', fin: 'Polished', tol: '±0.10 mm',
      },
    },
    {
      ...PART_B,
      description: 'Blanking tool — progressive, 2 stations',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 52000, amount: 52000,
      attributes: {
        cav: '1', mat: 'D2', hard: '58–60 HRC', size: '320 × 210 mm',
        thk: '3.0 mm', fin: 'Ground', tol: '±0.05 mm',
      },
    },
    {
      ...PART_B,
      description: 'Bending tool (90° up-bend) with adjustable back stop',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 24000, amount: 24000,
      attributes: {
        cav: '1', mat: 'EN 31', hard: '56–58 HRC', size: '280 × 190 mm',
        thk: '3.0 mm', fin: 'Ground', tol: '±0.15 mm',
      },
    },
    {
      ...PART_B,
      description: 'Trim & pierce tool for final operation',
      hsn: '82073000', qty: 1, uom: 'NOS', rate: 18500, amount: 18500,
      attributes: {
        cav: '2', mat: 'D2', hard: '58–60 HRC', size: '260 × 180 mm',
        thk: '3.0 mm', fin: 'Ground', tol: '±0.05 mm',
      },
    },
    {
      description: 'Tool trial & first-piece inspection report (both parts)',
      hsn: '998898', qty: 1, uom: 'SET', rate: 3500, amount: 3500, isTooling: true,
    },
  ],
  totals: {
    subtotal: 206000,
    taxLines: buildTaxLines(true, [18, 18, 18, 18, 18, 18, 18], { cgst: 0, sgst: 0, igst: 37080 }),
    grand: 243080,
    words: 'Two Lakh Forty Three Thousand Eighty Rupees Only',
  },
  terms: TERMS,
  notes: 'Rates are for tool manufacture only. Steel is our scope unless stated otherwise.',
};

const outdir = process.argv[2] ?? '/tmp';
writeFileSync(`${outdir}/ms-invoice.html`, renderDocumentHTML(INVOICE));
writeFileSync(`${outdir}/ms-quotation.html`, renderDocumentHTML(QUOTATION));
console.log(`wrote ${outdir}/ms-invoice.html and ${outdir}/ms-quotation.html`);
