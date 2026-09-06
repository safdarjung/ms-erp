// Shared client/server form result shape + error normalisation. Kept free of
// `server-only` and React so both server actions and client components can
// import it.

export type ActionResult = {
  ok?: boolean;
  error?: string;
  /** Form field the error belongs to (input `name`), so the UI can point at it. */
  field?: string;
  message?: string;
};

/**
 * Marker for errors our own code throws with a message that is safe (and
 * meant) to show to the user. `toActionError` passes these through verbatim.
 */
export class UserError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'UserError';
    this.field = field;
  }
}

export const GENERIC_ERROR =
  'Something went wrong on our side. Please try again — if it keeps happening, tell the owner.';
export const PERMISSION_ERROR =
  "You don't have permission for this — ask the owner to give you access.";
const DUPLICATE_ERROR = 'This already exists.';
const IN_USE_ERROR = "Can't delete — it's still used by a bill, order or quotation.";
const TOO_LONG_ERROR = 'One of the fields is too long.';
const MAX_USER_MESSAGE_LENGTH = 240;

// Driver / SQL vocabulary that never belongs in front of a user.
const TECHNICAL_TEXT =
  /syntax error|relation "|column "|does not exist|violates|duplicate key|foreign key|null value in column|invalid input syntax|invalid input value|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|timed out|Failed query|TypeError|ReferenceError|Cannot read propert|is not a function|is not defined|Unexpected token|JSON at position|\bundefined\b|\bnull\b|\bNaN\b|postgres|drizzle|SQLSTATE|pg_|\bsql\b|\bstack\b/i;

/** Walk `error` → `cause` looking for a Postgres SQLSTATE code. */
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function isNextControlFlow(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const digest = (e as { digest?: unknown }).digest;
  const message = (e as { message?: unknown }).message;
  return (typeof digest === 'string' && digest.startsWith('NEXT_'))
    || (typeof message === 'string' && message.startsWith('NEXT_'));
}

/** Heuristic: a sentence our own code wrote for the user, not a driver dump. */
function looksUserFacing(msg: string): boolean {
  if (!msg || msg.length > MAX_USER_MESSAGE_LENGTH) return false;
  if (!/^[A-Z0-9₹]/.test(msg)) return false;
  return !TECHNICAL_TEXT.test(msg);
}

/**
 * Normalise a thrown error into one plain sentence for the user. Redirects
 * (NEXT_REDIRECT / NEXT_NOT_FOUND) are re-thrown so they keep working when an
 * action wraps its whole body in try/catch. The raw error is always logged.
 */
export function toActionError(e: unknown): string {
  if (isNextControlFlow(e)) throw e;
  console.error('[action]', e);

  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (msg.startsWith('FORBIDDEN')) return PERMISSION_ERROR;
  if (e instanceof UserError) return msg;

  const code = pgCode(e);
  if (code === '23505' || /duplicate key/i.test(msg)) return DUPLICATE_ERROR;
  if (code === '23503' || /foreign key/i.test(msg)) return IN_USE_ERROR;
  if (code === '22001' || /value too long/i.test(msg)) return TOO_LONG_ERROR;
  if (code) return GENERIC_ERROR;

  return looksUserFacing(msg) ? msg : GENERIC_ERROR;
}

// ── Field-level validation errors ───────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', phone: 'Phone', email: 'Email', gstin: 'GSTIN', stateCode: 'State',
  address: 'Address', creditTermsDays: 'Payment terms', contactPerson: 'Contact person',
  customerName: 'Company / name', contact: 'Contact person', source: 'Source',
  requirement: 'Requirement', valueEstimate: 'Approx. value', nextFollowupAt: 'Follow-up date',
  amount: 'Amount', paidOn: 'Payment date', stage: 'Stage', notes: 'Note',
};

/** Rewrite zod's stock wording when the schema didn't supply a message. */
function humaniseZodMessage(message: string): string {
  const tooLong = /at most (\d+) character/i.exec(message);
  if (tooLong) return `keep it under ${tooLong[1]} characters`;
  if (/Expected number|received nan/i.test(message)) return 'enter a number';
  if (/^Required$|Invalid input|invalid_type/i.test(message)) return 'please fill this in';
  if (/Invalid enum|Invalid option/i.test(message)) return 'pick one of the options';
  return message;
}

export type ZodIssueLike = { path?: (string | number)[]; message: string };

/**
 * Turn a zod issue into `{ error: "Label: message", field }` so the form can
 * show it under the right input. Skips the label when the message already
 * names the field ("Name is required" stays as is).
 */
export function fieldError(issue: ZodIssueLike | undefined): { error: string; field?: string } {
  if (!issue) return { error: 'Please check the form and try again.' };
  const field = issue.path?.find((p): p is string => typeof p === 'string');
  const label = field ? FIELD_LABELS[field] : undefined;
  const message = humaniseZodMessage(issue.message);
  if (!label) return { error: message, field };
  const alreadyNamed = message.toLowerCase().startsWith(label.toLowerCase());
  return { error: alreadyNamed ? message : `${label}: ${message}`, field };
}
