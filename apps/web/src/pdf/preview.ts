// Dev helper: render a sample invoice to HTML for PDF preview.
//   tsx src/pdf/preview.ts <out.html>
import { writeFileSync } from 'node:fs';
import { renderInvoiceHTML, type InvoiceData } from './invoice-template';

const SAMPLE: InvoiceData = {
  company: {
    name: 'M.S. ENTERPRISES',
    factory: 'FACTORY: 5B-Sanjay Memorial Indl. Estate Phase-1, Near YMCA Chowk, N.I.T. FARIDABAD',
    office: 'OFFICE ADDRESS: NH 1C/69 NIT Faridabad',
    gstin: '06AKQPM8903J1ZN',
    bank: { name: 'PUNJAB NATIONAL BANK', acNo: '0483050019340', ifsc: 'PUNB0048320' },
  },
  buyer: {
    name: 'M/S CHATTERJI RUBBER MFG. CO.',
    addressLines: ['129A, J. K. Paul Road, Kolkata- 700038'],
    gstin: '19AADFC2983M1ZZ',
  },
  billNo: '781',
  date: '01.07.2026',
  items: [
    {
      description: 'middle size 16 cavity rubber moulding die as per your drawing\ndie material en 31',
      hsn: '84807100',
      qty: 1,
      rate: 23000,
    },
  ],
  // Buyer is West Bengal (19) vs supplier Haryana (06) → inter-state → IGST.
  taxLines: [{ label: 'GST 18%', amount: 4230 }],
  terms: [
    'Delivery time 10 working days.',
    '50% advance',
    '25% against delivery',
    '25% after trail.',
    'GST extra',
    'Plating and Polishing charges extra',
  ],
};

const out = process.argv[2] ?? '/tmp/ms-invoice.html';
writeFileSync(out, renderInvoiceHTML(SAMPLE));
console.log('wrote ' + out);
