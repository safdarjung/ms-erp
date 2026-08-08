import type { InboundEmail, ExtractedLead } from './types';

// Deterministic parsers for IndiaMART & TradeIndia lead-notification emails.
// Their layouts are labelled ("Name: …", "Mobile: …"), so a labelled-line scan
// is reliable and free. Returns null when the mail isn't a recognized marketplace
// enquiry (→ the pipeline treats it as generic mail).

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/t[dh]>/gi, '\t')                                 // cell end → tab (key/value separator)
    .replace(/<(br|\/p|\/tr|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n') // block/row end → newline
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ ]{2,}/g, ' ')          // collapse runs of spaces (keep tabs as separators)
    .replace(/[ \t]*\n[ \t]*/g, '\n')  // trim whitespace around line breaks
    .replace(/\t{2,}/g, '\t')          // collapse repeated tabs
    .trim();
}

function clean(v: string): string {
  return v.replace(/^[\s:\-]+/, '').replace(/\s+/g, ' ').trim();
}

// Match "Label: value", "Label - value", or a two-cell table row "Label<tab>value"
// (with or without a colon in the value cell).
function fieldOf(lines: string[], labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp('^[ ]*' + label + '[ ]*[:\\-\\t][ ]*(.+)$', 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) {
        const v = clean(m[1] ?? '');
        if (v && !/^(n\/?a|none|-+)$/i.test(v)) return v.slice(0, 300);
      }
    }
  }
  return undefined;
}

export function parseMarketplaceEmail(email: InboundEmail): { lead: ExtractedLead; source: string } | null {
  const from = (email.fromEmail ?? '').toLowerCase();
  const rawText = (email.text && email.text.trim()) ? email.text : (email.html ? htmlToText(email.html) : '');
  const hay = `${from} ${email.subject ?? ''} ${rawText}`.toLowerCase();

  let source: string | null = null;
  if (from.includes('indiamart') || hay.includes('indiamart')) source = 'IndiaMART';
  else if (from.includes('tradeindia') || hay.includes('tradeindia')) source = 'TradeIndia';
  if (!source) return null;

  const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const name = fieldOf(lines, ['Contact Person', 'Sender Name', 'Buyer Name', 'Contact Name', 'Name']);
  const phone = fieldOf(lines, ['Mobile No', 'Mobile', 'Phone No', 'Phone', 'Contact No', 'Mob']);
  const emailF = fieldOf(lines, ['Email ID', 'E-mail', 'Email']);
  const company = fieldOf(lines, ['Company Name', 'Company', 'Firm Name', 'Firm']);
  const product = fieldOf(lines, ['Product/Service', 'Product Name', 'Product', 'Your Requirement', 'Subject']);
  const message = fieldOf(lines, ['Enquiry Details', 'Message', 'Requirement', 'Query', 'Details', 'Description']);

  // Require at least one contact channel or an identifiable party for a confident parse.
  if (!phone && !emailF && !name && !company) return null;

  const customerName = (company || name || email.fromName || product || `Unknown (${source})`).slice(0, 200);
  const requirement = [product, message].filter(Boolean).join(' — ') || email.subject || null;

  const lead: ExtractedLead = {
    customerName,
    contact: name || email.fromName || null,
    phone: phone || null,
    email: (emailF || email.fromEmail || null),
    requirement: requirement ? requirement.slice(0, 2000) : null,
    source,
  };
  return { lead, source };
}
