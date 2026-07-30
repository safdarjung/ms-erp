import { z } from 'zod';
import { CUSTOMER_REG_TYPES, LEAD_STAGES } from './enums';

const emptyToUndef = z.literal('').transform(() => undefined);
const optionalEmail = z.string().email('Enter a valid email').optional().or(emptyToUndef);

export const customerInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  regType: z.enum(CUSTOMER_REG_TYPES).default('unregistered'),
  gstin: z.string().trim().length(15, 'GSTIN must be 15 characters').optional().or(emptyToUndef),
  stateCode: z.string().trim().max(2).optional().or(emptyToUndef),
  contactPerson: z.string().trim().max(200).optional().or(emptyToUndef),
  phone: z.string().trim().max(20).optional().or(emptyToUndef),
  email: optionalEmail,
  address: z.string().trim().max(300).optional().or(emptyToUndef),
  creditTermsDays: z.coerce.number().int().min(0).max(365).default(0),
});
export type CustomerInput = z.infer<typeof customerInput>;

export const invoiceItemInput = z.object({
  description: z.string().trim().min(1, 'Description is required'),
  hsn: z.string().trim().max(10).optional().or(emptyToUndef),
  qty: z.coerce.number().positive('Qty must be greater than 0'),
  uom: z.string().trim().max(10).default('NOS'),
  rate: z.coerce.number().min(0),
  gstRate: z.coerce.number().min(0).max(40).default(18),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInput>;

export const invoiceInput = z.object({
  customerId: z.string().uuid('Select a customer'),
  docDate: z.string().min(1, 'Date is required'),
  poRef: z.string().trim().max(40).optional().or(emptyToUndef),
  terms: z.string().trim().max(4000).optional().or(emptyToUndef),
  items: z.array(invoiceItemInput).min(1, 'Add at least one line item'),
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

export const quotationItemInput = invoiceItemInput.extend({
  isToolingCharge: z.coerce.boolean().default(false),
});
export type QuotationItemInput = z.infer<typeof quotationItemInput>;

export const quotationInput = z.object({
  customerId: z.string().uuid('Select a customer'),
  docDate: z.string().min(1, 'Date is required'),
  validityDays: z.coerce.number().int().min(1).max(365).default(15),
  terms: z.string().trim().max(4000).optional().or(emptyToUndef),
  notes: z.string().trim().max(2000).optional().or(emptyToUndef),
  items: z.array(quotationItemInput).min(1, 'Add at least one line item'),
});
export type QuotationInput = z.infer<typeof quotationInput>;

export const leadInput = z.object({
  customerName: z.string().trim().min(1, 'Customer name is required').max(200),
  contact: z.string().trim().max(200).optional().or(emptyToUndef),
  phone: z.string().trim().max(20).optional().or(emptyToUndef),
  email: optionalEmail,
  source: z.string().trim().max(80).optional().or(emptyToUndef),
  requirement: z.string().trim().max(2000).optional().or(emptyToUndef),
  stage: z.enum(LEAD_STAGES).default('new'),
  valueEstimate: z.coerce.number().min(0).optional(),
});
export type LeadInput = z.infer<typeof leadInput>;
