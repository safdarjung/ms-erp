import type { InboundEmail, ChannelConfig } from './types';

// Deterministic bulk/newsletter gate. Applied ONLY to non-marketplace mail —
// recognized IndiaMART/TradeIndia enquiries (which come from automated senders)
// bypass this in the pipeline, since they ARE the leads we want.

const NOREPLY = /(^|[.\-_+])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|newsletter|notif(y|ications?))@/i;

function header(email: InboundEmail, name: string): string {
  const h = email.headers ?? {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(h[key] ?? '') : '';
}

export function isBulk(email: InboundEmail, cfg: ChannelConfig): { bulk: boolean; reason?: string } {
  if (typeof email.spamScore === 'number' && email.spamScore >= 5) {
    return { bulk: true, reason: `provider spam score ${email.spamScore}` };
  }
  if (header(email, 'List-Unsubscribe')) return { bulk: true, reason: 'List-Unsubscribe header (newsletter)' };
  const precedence = header(email, 'Precedence').toLowerCase();
  if (['bulk', 'list', 'junk'].includes(precedence)) return { bulk: true, reason: `Precedence: ${precedence}` };
  const auto = header(email, 'Auto-Submitted').toLowerCase();
  if (auto && auto !== 'no') return { bulk: true, reason: 'Auto-Submitted' };

  const from = (email.fromEmail ?? '').toLowerCase();
  if (from && NOREPLY.test(from)) return { bulk: true, reason: 'no-reply sender' };

  // Optional positive filter: if the owner set an allowlist, the sender must match.
  const allow = (cfg.senderAllowlist ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && from) {
    const ok = allow.some((a) => {
      const dom = a.replace(/^@/, '');
      return from === a || from.endsWith('@' + dom) || from.endsWith('.' + dom);
    });
    if (!ok) return { bulk: true, reason: 'sender not in allowlist' };
  }
  return { bulk: false };
}
