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

function digitCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}
function emailsIn(text: string): string[] {
  return text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
}

// IndiaMART "BuyLead" emails put the buyer's name, company and phone on bare
// (unlabelled) lines inside a "Buyer's Contact Details" block, with only the
// email labelled — so the generic label scan misses them. This extractor is
// tuned to that layout, and appends the requirement attributes (quantity,
// material, …) that IndiaMART lists under "Buylead Details".
function parseIndiaMart(lines: string[], email: InboundEmail): ExtractedLead | null {
  const lower = lines.map((l) => l.toLowerCase());
  // Only handle the BuyLead layout here; the older labelled format is left to the generic scan.
  const isBuyLead = lower.some((l) =>
    l.includes('buylead') || l.includes("buyer's contact") || l.includes('buy lead') || l.includes('buyer contact'));
  if (!isBuyLead) return null;

  const contactIdx = lower.findIndex((l) => l.includes('contact details') || l.includes('buyer contact'));
  let endIdx = lines.length;
  for (let i = Math.max(contactIdx, 0) + 1; i < lines.length; i++) {
    const l = lower[i] ?? '';
    if (/^(sells|member since)\b/.test(l) || l.includes('buylead details') || l.includes('requirement details')) { endIdx = i; break; }
  }
  const block = lines.slice(contactIdx >= 0 ? contactIdx + 1 : 0, endIdx);

  let emailV = fieldOf(block, ['E-mail', 'Email ID', 'Email'])
    ?? emailsIn(block.join('\n')).find((e) => !/indiamart/i.test(e))
    ?? null;
  if (emailV && /indiamart/i.test(emailV)) emailV = null;

  let phoneV: string | null = null;
  for (const l of block) {
    const m = l.match(/\+?\d[\d\s\-()]{8,}\d/);
    if (m && digitCount(m[0]) >= 10) { phoneV = m[0].replace(/[()]/g, '').trim(); break; }
  }

  // Bare name / company lines = anything that isn't a badge, label, email or phone.
  const plain = block.filter((l) => {
    if (/[✓✔]/.test(l)) return false;
    if (/^(phone|e-?mail|gst|sells|member since)\b/i.test(l)) return false;
    if (l.includes('@')) return false;
    if (digitCount(l) >= 10) return false;
    return l.trim().length > 1;
  });
  const name = plain[0] ?? null;
  const companyRaw = plain[1] ?? null;
  const company = companyRaw ? ((companyRaw.split(/\s+-\s+/)[0] ?? companyRaw).trim()) : null;

  let product = (email.subject ?? '').replace(/^\s*buyer details for\s*/i, '').trim() || null;
  const detIdx = lower.findIndex((l) => l.includes('buylead details') || l.includes('requirement details'));
  if (!product && detIdx >= 0) {
    const cand = (lines[detIdx + 1] ?? '').trim();
    if (cand && !cand.includes(':')) product = cand;
  }
  const attrs = ['Quantity', 'Material', 'Application', 'Processing Type', 'Probable Order Value', 'Probable Requirement Type']
    .map((k) => { const v = fieldOf(lines, [k]); return v ? `${k}: ${v}` : null; })
    .filter(Boolean);
  const requirement = [product, attrs.join(', ')].filter(Boolean).join(' — ') || email.subject || null;

  if (!phoneV && !emailV) return null; // no contact channel — let the generic scan try

  return {
    customerName: (company || name || email.fromName || product || 'IndiaMART enquiry').slice(0, 200),
    contact: name,
    phone: phoneV,
    email: emailV,
    requirement: requirement ? requirement.slice(0, 2000) : null,
    source: 'IndiaMART',
  };
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

  // IndiaMART's BuyLead layout needs the dedicated extractor; fall back to the
  // generic label scan (which handles TradeIndia and IndiaMART's older format).
  if (source === 'IndiaMART') {
    const im = parseIndiaMart(lines, email);
    if (im) return { lead: im, source };
  }
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
