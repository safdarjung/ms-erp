import { z } from 'zod';

// Tenant letterhead/branding stored in `tenant.settings.letterhead` (jsonb).
// Shape matches the seeded M.S. Enterprises letterhead (packages/db/src/seed.ts)
// and the PDF template contract. Parsed leniently — extra keys pass through and
// a partially-filled letterhead still renders.
export const letterheadSchema = z.object({
  name: z.string().optional(),
  factory: z.string().optional(),
  office: z.string().optional(),
  gstin: z.string().optional(),
  stateCode: z.string().optional(),
  bank: z.object({
    name: z.string(),
    acNo: z.string(),
    ifsc: z.string(),
  }).optional(),
  defaultTerms: z.array(z.string()).optional(),
}).passthrough();

export type Letterhead = z.infer<typeof letterheadSchema>;

/** Safely extract the letterhead from a tenant `settings` jsonb value. */
export function parseLetterhead(settings: unknown): Letterhead | null {
  if (!settings || typeof settings !== 'object') return null;
  const raw = (settings as Record<string, unknown>).letterhead;
  if (!raw) return null;
  const parsed = letterheadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
