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

// Invoice lifecycle. 'issued' on creation; 'cancelled' by hand. 'paid' is
// DERIVED from recorded payments (see paymentStatus), not set manually.
export const INVOICE_STATUSES = ['issued', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Lifecycle statuses a user sets by hand — paid is derived from payments. */
export const INVOICE_SETTABLE_STATUSES = ['issued', 'cancelled'] as const;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Issued', paid: 'Paid', cancelled: 'Cancelled',
};

// Accounts-receivable state, derived from payments vs grand total + due date.
export const PAYMENT_STATES = ['unpaid', 'partial', 'paid', 'overdue', 'cancelled'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
};

export const PAYMENT_METHODS = ['bank', 'upi', 'cash', 'cheque', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: 'Bank transfer / NEFT', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other',
};

/**
 * Derive AR state from money + dates. `pill` maps to StatusPill tones.
 * outstanding is grand − received; a tiny epsilon absorbs paise rounding.
 */
export function paymentStatus(args: {
  status: string; grandTotal: number; received: number; dueDate?: Date | string | null;
}): { state: PaymentState; outstanding: number } {
  const outstanding = Math.round((args.grandTotal - args.received) * 100) / 100;
  if (args.status === 'cancelled') return { state: 'cancelled', outstanding: 0 };
  if (outstanding <= 0.5) return { state: 'paid', outstanding: Math.max(0, outstanding) };
  if (args.received > 0.5) return { state: 'partial', outstanding };
  if (args.dueDate) {
    const due = typeof args.dueDate === 'string' ? new Date(args.dueDate) : args.dueDate;
    if (due.getTime() < Date.now()) return { state: 'overdue', outstanding };
  }
  return { state: 'unpaid', outstanding };
}

// Order/job branch — the highest-leverage flag in the schema (see docs/02).
export const MATERIAL_OWNERSHIP = ['customer', 'company'] as const;
export type MaterialOwnership = (typeof MATERIAL_OWNERSHIP)[number];

export const MATERIAL_OWNERSHIP_LABELS: Record<MaterialOwnership, string> = {
  customer: 'Customer-supplied material',
  company: 'We supply material',
};

export const ORDER_CATEGORIES = ['job_work', 'own_manufacture', 'tool_build', 'repair'] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];

export const ORDER_CATEGORY_LABELS: Record<OrderCategory, string> = {
  job_work: 'Job-work', own_manufacture: 'Own manufacture', tool_build: 'Tool / die build', repair: 'Repair / refurb',
};

// Sales-order lifecycle. 'invoiced' is derived (set when an invoice is raised).
export const ORDER_STATUSES = ['open', 'in_progress', 'delivered', 'closed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses a user can set by hand. */
export const ORDER_SETTABLE_STATUSES = ['open', 'in_progress', 'delivered', 'closed', 'cancelled'] as const;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open', in_progress: 'In production', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
};
