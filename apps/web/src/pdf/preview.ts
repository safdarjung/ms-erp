// Dev helper: render sample documents to HTML for PDF preview.
//   tsx src/pdf/preview.ts <outdir>
import { writeFileSync } from 'node:fs';
import { renderDocumentHTML, buildTaxLines, type DocumentData } from './document-template';

const COMPANY: DocumentData['company'] = {
  name: 'M.S. ENTERPRISES',
  factory: 'FACTORY: 5B-Sanjay Memorial Indl. Estate Phase-1, Near YMCA Chowk, N.I.T. FARIDABAD',
  office: 'OFFICE ADDRESS: NH 1C/69 NIT Faridabad',
  gstin: '06AKQPM8903J1ZN',
  bank: { name: 'PUNJAB NATIONAL BANK', acNo: '0483050019340', ifsc: 'PUNB0048320' },
};

// Buyer is West Bengal (19) vs supplier Haryana (06) → inter-state → IGST.
const INVOICE: DocumentData = {
  docLabel: 'TAX INVOICE',
  company: COMPANY,
  buyer: {
    name: 'M/S CHATTERJI RUBBER MFG. CO.',
    addressLines: ['129A, J. K. Paul Road, Kolkata- 700038'],
    gstin: '19AADFC2983M1ZZ',
    stateLabel: '19 — West Bengal',
  },
  number: 'INV/26-27/0781',
  meta: [
    { label: 'Date', value: '01.07.2026' },
    { label: 'PO Ref.', value: 'CR/PO/2231' },
    { label: 'Place of Supply', value: '19 — West Bengal' },
    { label: 'Tax Type', value: 'IGST (inter-state)' },
  ],
  items: [
    {
      description: 'Middle size 16 cavity rubber moulding die as per your drawing\nDie material EN 31',
      hsn: '84807100', qty: 1, uom: 'NOS', rate: 23000, amount: 23000,
    },
    { description: 'Polishing & lapping of cavity inserts', hsn: '998898', qty: 16, uom: 'NOS', rate: 120, amount: 1920 },
  ],
  totals: {
    subtotal: 24920,
    taxLines: buildTaxLines(true, [18, 18], { cgst: 0, sgst: 0, igst: 4485.6 }),
    grand: 29405.6,
    words: 'Twenty Nine Thousand Four Hundred Five Rupees and Sixty Paise Only',
  },
  terms: [
    'Delivery time 10 working days.',
    '50% advance, 25% against delivery, 25% after trial.',
    'GST extra as applicable.',
    'Plating and polishing charges extra.',
  ],
};

const QUOTATION: DocumentData = {
  ...INVOICE,
  docLabel: 'QUOTATION',
  number: 'QT/26-27/0042',
  meta: [
    { label: 'Date', value: '01.07.2026' },
    { label: 'Valid Until', value: '16.07.2026 (15 days)' },
    { label: 'Place of Supply', value: '19 — West Bengal' },
    { label: 'Tax Type', value: 'IGST (inter-state)' },
  ],
  items: [
    ...INVOICE.items,
    { description: 'Tool trial & first-piece inspection report', hsn: '998898', qty: 1, uom: 'SET', rate: 3500, amount: 3500, isTooling: true },
  ],
  notes: 'Drawing ref: CR-16CAV-R2. Cavity steel hardness 58–60 HRC.',
};

const outdir = process.argv[2] ?? '/tmp';
writeFileSync(`${outdir}/ms-invoice.html`, renderDocumentHTML(INVOICE));
writeFileSync(`${outdir}/ms-quotation.html`, renderDocumentHTML(QUOTATION));
console.log(`wrote ${outdir}/ms-invoice.html and ${outdir}/ms-quotation.html`);
