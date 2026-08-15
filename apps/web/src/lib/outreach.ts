// WhatsApp "one-tap" outreach: build a wa.me deep link that opens WhatsApp with
// the intro message pre-filled, addressed to the lead — sent from the owner's own
// number. No WhatsApp Business API, no template approval, no cost.

export const DEFAULT_WHATSAPP_NUMBER = '9811678546';

export const DEFAULT_INTRO =
  'Namaste {{name}}, thank you for your enquiry for {{product}}. This is M/s M.S. Enterprises ' +
  '— precision dies, press tools & CNC/VMC machining, Faridabad. To prepare your quotation, please ' +
  'share a few more details — quantity, drawing/sample, material, and required delivery date. ' +
  'You can reply here or reach us on {{number}}. — Team M.S. Enterprises';

export type OutreachSettings = { whatsappNumber: string; template: string };

/** Best-effort E.164-ish digits for wa.me (India default). Returns null if unusable. */
export function normalizeWaNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D+/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length >= 11 && d.length <= 15) return d; // already has a country code
  return null;
}

function fill(template: string, vars: { name?: string | null; product?: string | null; number: string }): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, (vars.name ?? '').trim() || 'ji')
    .replace(/\{\{\s*product\s*\}\}/gi, (vars.product ?? '').trim() || 'your requirement')
    .replace(/\{\{\s*number\s*\}\}/gi, vars.number);
}

export function buildWhatsappLink(opts: {
  phone?: string | null;
  name?: string | null;
  product?: string | null;
  settings: OutreachSettings;
}): string | null {
  const to = normalizeWaNumber(opts.phone);
  if (!to) return null;
  const text = fill(opts.settings.template, { name: opts.name, product: opts.product, number: opts.settings.whatsappNumber });
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** A polite payment-reminder wa.me link for an overdue invoice. Returns null if the phone is unusable. */
export function buildPaymentReminderLink(opts: {
  phone?: string | null;
  customerName?: string | null;
  invoiceNumber: string;
  outstanding: number;
  companyNumber?: string;
}): string | null {
  const to = normalizeWaNumber(opts.phone);
  if (!to) return null;
  const amount = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(opts.outstanding);
  const name = (opts.customerName ?? '').trim() || 'Sir/Madam';
  const text =
    `Namaste ${name}, a gentle reminder from M/s M.S. Enterprises: invoice ${opts.invoiceNumber} for ₹${amount} ` +
    `is now due for payment. Kindly arrange it at your convenience. For any query, reach us on ` +
    `${opts.companyNumber || DEFAULT_WHATSAPP_NUMBER}. Thank you. — Team M.S. Enterprises`;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
