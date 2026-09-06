import { z } from 'zod';
import { MAX_DOC_COLUMNS } from './documents';
import { CUSTOMER_REG_TYPES, LEAD_STAGES, ORDER_CATEGORIES, MATERIAL_OWNERSHIP, PAYMENT_METHODS } from './enums';

// Every message here is shown to a non-technical user next to the field:
// one sentence, what happened + what to do. Never a zod default.

const emptyToUndef = z.literal('').transform(() => undefined);
const optionalEmail = z.string().email('Enter a valid email address').optional().or(emptyToUndef);

/** 15-char GSTIN: 2-digit state · 5 letters · 4 digits · 1 letter · entity · Z · check char. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_MESSAGE =
  "That doesn't look like a GSTIN — it is 15 characters like 06ABCDE1234F1Z5 (copy it from their bill or GST certificate)";

export const customerInput = z.object({
  name: z.string().trim().min(1, "Enter the company or person's name").max(200, 'Name is too long (max 200 characters)'),
  regType: z.enum(CUSTOMER_REG_TYPES).default('unregistered'),
  gstin: z.string().trim().toUpperCase().length(15, GSTIN_MESSAGE).regex(GSTIN_PATTERN, GSTIN_MESSAGE).optional().or(emptyToUndef),
  stateCode: z.string().trim().max(2, 'State code is 2 digits, e.g. 06 for Haryana').optional().or(emptyToUndef),
  contactPerson: z.string().trim().max(200, 'Contact name is too long (max 200 characters)').optional().or(emptyToUndef),
  phone: z.string().trim().max(20, 'Phone number is too long — enter the 10-digit mobile').optional().or(emptyToUndef),
  email: optionalEmail,
  address: z.string().trim().max(300, 'Address is too long (max 300 characters)').optional().or(emptyToUndef),
  creditTermsDays: z.coerce.number({ invalid_type_error: 'Payment terms must be a number of days' })
    .int('Payment terms must be whole days')
    .min(0, 'Payment terms must be between 0 and 365 days')
    .max(365, 'Payment terms must be between 0 and 365 days')
    .default(0),
});
export type CustomerInput = z.infer<typeof customerInput>;

// A user-defined descriptive column on a document's item table (e.g. "Steel
// grade", "Cavities"). Purely informational — never feeds pricing or tax.
export const columnDef = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1, 'Name the new column or remove it').max(60, 'Column name is too long (max 60 characters)'),
  /**
   * How this field prints on the document:
   *   'column' — its own column in the item table (good for 1–3 short values)
   *   'spec'   — under the item description as "Material: D2 · Hardness: 58 HRC"
   * Omitted = decide automatically (see `splitColumns`), which keeps older
   * documents looking exactly as they always did.
   */
  display: z.enum(['column', 'spec']).optional(),
});
export type ColumnDef = z.infer<typeof columnDef>;

// Custom-column values for a single row, keyed by columnDef.id → free text.
// Generous cap — these are descriptive; over-long values are clamped upstream.
const rowAttributes = z.record(z.string().max(2000)).default({});

export const invoiceItemInput = z.object({
  description: z.string().trim().min(1, 'Write what this line is for'),
  hsn: z.string().trim().max(10, 'HSN code is too long (max 10 digits)').optional().or(emptyToUndef),
  qty: z.coerce.number({ invalid_type_error: 'Quantity must be a number' }).positive('Quantity must be more than 0'),
  uom: z.string().trim().max(10, 'Unit is too long (max 10 characters)').default('NOS'),
  rate: z.coerce.number({ invalid_type_error: 'Rate must be a number' }).min(0, "Rate can't be negative"),
  gstRate: z.coerce.number({ invalid_type_error: 'GST % must be a number' })
    .min(0, "GST % can't be negative").max(40, "GST % can't be more than 40").default(18),
  // Optional part/section this row belongs to (NULL/absent = ungrouped).
  groupLabel: z.string().trim().max(120, 'Part name is too long (max 120 characters)').optional().or(emptyToUndef),
  // Detail printed beside the part heading (drawing no., component, material…).
  // Every row of a part carries the same note; the renderers read the first one.
  groupNote: z.string().trim().max(200, 'Part detail is too long (max 200 characters)').optional().or(emptyToUndef),
  attributes: rowAttributes,
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInput>;

const customerIdField = z.string({ required_error: 'Pick a customer from the list' }).uuid('Pick a customer from the list');
const docDateField = z.string({ required_error: 'Pick a date' }).min(1, 'Pick a date');
const termsField = z.string().trim().max(4000, 'Terms are too long (max 4000 characters)').optional().or(emptyToUndef);
const notesField = z.string().trim().max(2000, 'Notes are too long (max 2000 characters)').optional().or(emptyToUndef);
const poRefField = z.string().trim().max(40, 'PO number is too long (max 40 characters)').optional().or(emptyToUndef);
const columnDefsField = z.array(columnDef)
  .max(MAX_DOC_COLUMNS, `You can add up to ${MAX_DOC_COLUMNS} extra fields`).default([]);

export const invoiceInput = z.object({
  customerId: customerIdField,
  docDate: docDateField,
  poRef: poRefField,
  terms: termsField,
  notes: notesField,
  items: z.array(invoiceItemInput).min(1, 'Add at least one item with a description'),
  columnDefs: columnDefsField,
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

export const quotationItemInput = invoiceItemInput.extend({
  isToolingCharge: z.coerce.boolean().default(false),
});
export type QuotationItemInput = z.infer<typeof quotationItemInput>;

export const quotationInput = z.object({
  customerId: customerIdField,
  docDate: docDateField,
  validityDays: z.coerce.number({ invalid_type_error: 'Validity must be a number of days' })
    .int('Validity must be whole days')
    .min(1, 'Validity must be at least 1 day')
    .max(365, "Validity can't be more than 365 days")
    .default(15),
  terms: termsField,
  notes: notesField,
  items: z.array(quotationItemInput).min(1, 'Add at least one item with a description'),
  columnDefs: columnDefsField,
});
export type QuotationInput = z.infer<typeof quotationInput>;

export const orderInput = z.object({
  customerId: customerIdField,
  docDate: docDateField,
  poRef: poRefField,
  orderCategory: z.enum(ORDER_CATEGORIES, { errorMap: () => ({ message: 'Pick an order type from the list' }) }).default('tool_build'),
  materialOwnership: z.enum(MATERIAL_OWNERSHIP, { errorMap: () => ({ message: 'Pick who supplies the material' }) }).default('customer'),
  deliveryDate: z.string().optional().or(emptyToUndef),
  quotationId: z.string().uuid('Refresh the page and try again').optional().or(emptyToUndef),
  items: z.array(invoiceItemInput).min(1, 'Add at least one item with a description'),
  columnDefs: columnDefsField,
});
export type OrderInput = z.infer<typeof orderInput>;

export const paymentInput = z.object({
  invoiceId: z.string({ required_error: 'Refresh the page and try again' }).uuid('Refresh the page and try again'),
  amount: z.coerce.number({ invalid_type_error: 'Enter the amount received' }).positive('Enter the amount received'),
  paidOn: z.string({ required_error: 'Pick the payment date' }).min(1, 'Pick the payment date'),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Pick how the payment came in' }) }).default('bank'),
  reference: z.string().trim().max(60, 'Reference is too long (max 60 characters)').optional().or(emptyToUndef),
  notes: z.string().trim().max(300, 'Note is too long (max 300 characters)').optional().or(emptyToUndef),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export const leadInput = z.object({
  customerName: z.string().trim().min(1, "Enter the company or person's name").max(200, 'Name is too long (max 200 characters)'),
  contact: z.string().trim().max(200, 'Contact name is too long (max 200 characters)').optional().or(emptyToUndef),
  phone: z.string().trim().max(20, 'Phone number is too long — enter the 10-digit mobile').optional().or(emptyToUndef),
  email: optionalEmail,
  source: z.string().trim().max(80, 'Source is too long (max 80 characters)').optional().or(emptyToUndef),
  requirement: z.string().trim().max(2000, 'Requirement is too long (max 2000 characters)').optional().or(emptyToUndef),
  stage: z.enum(LEAD_STAGES, { errorMap: () => ({ message: 'Pick a stage from the list' }) }).default('new'),
  valueEstimate: z.coerce.number({ invalid_type_error: 'Estimated value must be a number' }).min(0, "Estimated value can't be negative").optional(),
});
export type LeadInput = z.infer<typeof leadInput>;

// ── Human-readable zod issues ────────────────────────────────────────────────

/** Field → label used to prefix a server-side validation message ("Validity: …"). */
export const DOCUMENT_FIELD_LABELS: Record<string, string> = {
  customerId: 'Customer', docDate: 'Date', validityDays: 'Validity', poRef: 'Customer PO no.',
  terms: 'Terms', notes: 'Notes', items: 'Items', columnDefs: 'Extra columns',
  orderCategory: 'Order type', materialOwnership: 'Material', deliveryDate: 'Delivery date',
  amount: 'Amount', paidOn: 'Payment date', method: 'Payment method', reference: 'Reference no.',
};

/**
 * Turn a zod issue into one plain sentence with a field prefix — "Validity: …"
 * or "Line 3: …" for item paths — without repeating a field name the message
 * already starts with.
 */
export function describeZodIssue(
  issue: { path: (string | number)[]; message: string },
  labels: Record<string, string> = DOCUMENT_FIELD_LABELS,
): string {
  const [head, idx] = issue.path;
  if (head === 'items' && typeof idx === 'number') return `Line ${idx + 1}: ${issue.message}`;
  if (head === 'columnDefs') return issue.message;
  const label = typeof head === 'string' ? labels[head] : undefined;
  if (!label) return issue.message;
  if (issue.message.toLowerCase().startsWith(label.toLowerCase())) return issue.message;
  return `${label}: ${issue.message}`;
}

/** First issue of a failed parse, phrased for the user. */
export function firstZodMessage(
  error: { issues: { path: (string | number)[]; message: string }[] },
  labels?: Record<string, string>,
): string {
  const first = error.issues[0];
  return first ? describeZodIssue(first, labels) : 'Please check the highlighted field and try again.';
}
