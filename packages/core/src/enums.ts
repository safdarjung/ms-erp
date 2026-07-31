// Shared enum value sets. Kept as `as const` arrays so they double as runtime
// lists (for <select> options, seeds, validation) and compile-time union types.

export const LEAD_STAGES = ['new', 'contacted', 'negotiation', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note'] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const CUSTOMER_REG_TYPES = ['registered', 'unregistered'] as const;
export type CustomerRegType = (typeof CUSTOMER_REG_TYPES)[number];

// Quotation workflow. 'converted' is set by the system when an invoice is made.
export const QUOTATION_STATUSES = ['draft', 'sent', 'approved', 'rejected', 'converted'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Statuses a user can set by hand (not 'converted'). */
export const QUOTATION_SETTABLE_STATUSES = ['draft', 'sent', 'approved', 'rejected'] as const;

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Draft', sent: 'Sent', approved: 'Approved', rejected: 'Rejected', converted: 'Converted',
};

// Invoice lifecycle. 'issued' on creation; 'paid'/'cancelled' set by hand.
export const INVOICE_STATUSES = ['issued', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Issued', paid: 'Paid', cancelled: 'Cancelled',
};

// Order/job branch — the highest-leverage flag in the schema (see docs/02).
export const MATERIAL_OWNERSHIP = ['customer', 'company'] as const;
export type MaterialOwnership = (typeof MATERIAL_OWNERSHIP)[number];

export const ORDER_CATEGORIES = ['job_work', 'own_manufacture', 'tool_build', 'repair'] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];
