// Shared client/server form result shape. Kept free of `server-only` so both
// server actions and client components can import the type.

export type ActionResult = { ok?: boolean; error?: string; message?: string };

/** Normalise a thrown error into a user-facing message (hides RBAC internals). */
export function toActionError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith('FORBIDDEN')) return "You don't have permission to do that.";
  if (msg === 'NEXT_REDIRECT') throw e as Error; // let redirects propagate
  return msg || 'Something went wrong. Please try again.';
}
