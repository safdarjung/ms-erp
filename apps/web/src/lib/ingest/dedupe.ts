// Normalizers for matching an inbound enquiry against existing leads. Equality
// on normalized values (never `ilike` on raw input — a `%`/`_` in a phone/email
// would act as a wildcard, the latent bug in convertLeadToCustomerAction).

export function normalizeEmail(e?: string | null): string | null {
  const s = (e ?? '').trim().toLowerCase();
  return s.includes('@') ? s : null;
}

/** Digits only, last 10 (Indian mobile) — ignores +91 / spaces / dashes. */
export function normalizePhone(p?: string | null): string | null {
  const digits = (p ?? '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Escape LIKE/ILIKE metacharacters so a name match can't inject wildcards. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
