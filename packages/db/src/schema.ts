import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, varchar, timestamp, boolean, integer, numeric, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { ColumnDef } from '@ms/core';

// Standard audit timestamps (fresh builders per table).
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Platform & security ─────────────────────────────────────────────────────

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  subdomain: varchar('subdomain', { length: 63 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  fyStart: varchar('fy_start', { length: 5 }).notNull().default('04-01'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  ...ts(),
}, (t) => ({ subdomainUq: uniqueIndex('tenant_subdomain_uq').on(t.subdomain) }));

export const branch = pgTable('branch', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  gstin: varchar('gstin', { length: 15 }),
  stateCode: varchar('state_code', { length: 2 }),
  address: text('address'),
  isDefault: boolean('is_default').notNull().default(false),
  ...ts(),
}, (t) => ({ tenantIdx: index('branch_tenant_idx').on(t.tenantId) }));

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  phone: varchar('phone', { length: 20 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  locale: varchar('locale', { length: 5 }).notNull().default('en'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...ts(),
}, (t) => ({
  emailUq: uniqueIndex('users_email_uq').on(t.email),
  tenantIdx: index('users_tenant_idx').on(t.tenantId),
}));

export const role = pgTable('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  ...ts(),
}, (t) => ({ tenantIdx: index('role_tenant_idx').on(t.tenantId) }));

// Global permission catalog (not tenant-scoped).
export const permission = pgTable('permission', {
  key: varchar('key', { length: 60 }).primaryKey(),
  description: text('description'),
});

export const rolePermission = pgTable('role_permission', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').notNull(),
  permissionKey: varchar('permission_key', { length: 60 }).notNull(),
}, (t) => ({
  uq: uniqueIndex('role_permission_uq').on(t.roleId, t.permissionKey),
  tenantIdx: index('role_permission_tenant_idx').on(t.tenantId),
}));

export const userRole = pgTable('user_role', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
}, (t) => ({
  uq: uniqueIndex('user_role_uq').on(t.userId, t.roleId),
  tenantIdx: index('user_role_tenant_idx').on(t.tenantId),
}));

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tokenUq: uniqueIndex('session_token_uq').on(t.tokenHash) }));

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  entityType: varchar('entity_type', { length: 60 }).notNull(),
  entityId: uuid('entity_id'),
  action: varchar('action', { length: 40 }).notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index('audit_tenant_idx').on(t.tenantId) }));

// ── CRM & Sales (Phase-1 slice) ─────────────────────────────────────────────

export const customer = pgTable('customer', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  code: varchar('code', { length: 30 }),
  name: text('name').notNull(),
  regType: varchar('reg_type', { length: 20 }).notNull().default('unregistered'),
  gstin: varchar('gstin', { length: 15 }),
  stateCode: varchar('state_code', { length: 2 }),
  contactPerson: text('contact_person'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  creditTermsDays: integer('credit_terms_days').notNull().default(0),
  creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  ...ts(),
}, (t) => ({ tenantIdx: index('customer_tenant_idx').on(t.tenantId) }));

export const lead = pgTable('lead', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  source: varchar('source', { length: 80 }),
  customerName: text('customer_name').notNull(),
  contact: text('contact'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  requirement: text('requirement'),
  stage: varchar('stage', { length: 20 }).notNull().default('new'),
  ownerUserId: uuid('owner_user_id'),
  valueEstimate: numeric('value_estimate', { precision: 14, scale: 2 }),
  nextFollowupAt: timestamp('next_followup_at', { withTimezone: true }),
  convertedCustomerId: uuid('converted_customer_id'),
  // Origin trace when a lead was auto-created from an inbound_message (email/marketplace).
  inboundMessageId: uuid('inbound_message_id'),
  ...ts(),
}, (t) => ({
  tenantIdx: index('lead_tenant_idx').on(t.tenantId),
  stageIdx: index('lead_stage_idx').on(t.tenantId, t.stage),
  // One lead per inbound message (backstop against double-create races); partial
  // so hand-entered leads (null) are unconstrained.
  inboundUq: uniqueIndex('lead_inbound_message_uq').on(t.tenantId, t.inboundMessageId)
    .where(sql`inbound_message_id is not null`),
}));

export const leadActivity = pgTable('lead_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('note'),
  notes: text('notes'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  byUserId: uuid('by_user_id'),
}, (t) => ({ leadIdx: index('lead_activity_lead_idx').on(t.leadId) }));

// ── Sales → GST spine ───────────────────────────────────────────────────────

export const docSequence = pgTable('doc_sequence', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  docType: varchar('doc_type', { length: 20 }).notNull(),
  fy: varchar('fy', { length: 7 }).notNull(),
  prefix: varchar('prefix', { length: 12 }).notNull(),
  nextNumber: integer('next_number').notNull().default(1),
}, (t) => ({ uq: uniqueIndex('doc_sequence_uq').on(t.tenantId, t.docType, t.fy) }));

export const quotation = pgTable('quotation', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  number: varchar('number', { length: 30 }).notNull(),
  docDate: timestamp('doc_date', { withTimezone: true }).notNull().defaultNow(),
  customerId: uuid('customer_id').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  placeOfSupply: varchar('place_of_supply', { length: 2 }),
  isInterstate: boolean('is_interstate').notNull().default(false),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  cgst: numeric('cgst', { precision: 14, scale: 2 }).notNull().default('0'),
  sgst: numeric('sgst', { precision: 14, scale: 2 }).notNull().default('0'),
  igst: numeric('igst', { precision: 14, scale: 2 }).notNull().default('0'),
  grandTotal: numeric('grand_total', { precision: 14, scale: 2 }).notNull().default('0'),
  validityDays: integer('validity_days').notNull().default(15),
  terms: text('terms'),
  notes: text('notes'),
  // User-defined descriptive columns for this doc's item table: [{ id, label }].
  columnDefs: jsonb('column_defs').$type<ColumnDef[]>().notNull().default(sql`'[]'::jsonb`),
  convertedOrderId: uuid('converted_order_id'),
  convertedInvoiceId: uuid('converted_invoice_id'),
  createdBy: uuid('created_by'),
  ...ts(),
}, (t) => ({ tenantIdx: index('quotation_tenant_idx').on(t.tenantId) }));

export const quotationItem = pgTable('quotation_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  quotationId: uuid('quotation_id').notNull(),
  seq: integer('seq').notNull().default(1),
  description: text('description').notNull(),
  hsn: varchar('hsn', { length: 10 }),
  qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1'),
  uom: varchar('uom', { length: 10 }).notNull().default('NOS'),
  rate: numeric('rate', { precision: 14, scale: 2 }).notNull().default('0'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull().default('18'),
  taxableValue: numeric('taxable_value', { precision: 14, scale: 2 }).notNull().default('0'),
  isToolingCharge: boolean('is_tooling_charge').notNull().default(false),
  // Part / section heading this row sits under (NULL = ungrouped).
  groupLabel: varchar('group_label', { length: 120 }),
  // Custom-column values keyed by columnDef.id.
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
}, (t) => ({ qIdx: index('quotation_item_q_idx').on(t.quotationId) }));

export const salesOrder = pgTable('sales_order', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  number: varchar('number', { length: 30 }).notNull(),
  docDate: timestamp('doc_date', { withTimezone: true }).notNull().defaultNow(),
  customerId: uuid('customer_id').notNull(),
  quotationId: uuid('quotation_id'),
  poRef: varchar('po_ref', { length: 40 }),
  orderCategory: varchar('order_category', { length: 20 }).notNull().default('tool_build'),
  materialOwnership: varchar('material_ownership', { length: 12 }).notNull().default('customer'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  deliveryDate: timestamp('delivery_date', { withTimezone: true }),
  totalValue: numeric('total_value', { precision: 14, scale: 2 }).notNull().default('0'),
  columnDefs: jsonb('column_defs').$type<ColumnDef[]>().notNull().default(sql`'[]'::jsonb`),
  convertedInvoiceId: uuid('converted_invoice_id'),
  createdBy: uuid('created_by'),
  ...ts(),
}, (t) => ({ tenantIdx: index('sales_order_tenant_idx').on(t.tenantId) }));

export const orderItem = pgTable('order_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  seq: integer('seq').notNull().default(1),
  description: text('description').notNull(),
  hsn: varchar('hsn', { length: 10 }),
  qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1'),
  uom: varchar('uom', { length: 10 }).notNull().default('NOS'),
  rate: numeric('rate', { precision: 14, scale: 2 }).notNull().default('0'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull().default('18'),
  taxableValue: numeric('taxable_value', { precision: 14, scale: 2 }).notNull().default('0'),
  groupLabel: varchar('group_label', { length: 120 }),
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
}, (t) => ({ oIdx: index('order_item_o_idx').on(t.orderId) }));

export const taxInvoice = pgTable('tax_invoice', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  number: varchar('number', { length: 30 }).notNull(),
  docDate: timestamp('doc_date', { withTimezone: true }).notNull().defaultNow(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  type: varchar('type', { length: 20 }).notNull().default('tax_invoice'),
  customerId: uuid('customer_id').notNull(),
  quotationId: uuid('quotation_id'),
  orderId: uuid('order_id'),
  poRef: varchar('po_ref', { length: 40 }),
  placeOfSupply: varchar('place_of_supply', { length: 2 }),
  isInterstate: boolean('is_interstate').notNull().default(false),
  reverseCharge: boolean('reverse_charge').notNull().default(false),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  cgst: numeric('cgst', { precision: 14, scale: 2 }).notNull().default('0'),
  sgst: numeric('sgst', { precision: 14, scale: 2 }).notNull().default('0'),
  igst: numeric('igst', { precision: 14, scale: 2 }).notNull().default('0'),
  roundOff: numeric('round_off', { precision: 8, scale: 2 }).notNull().default('0'),
  grandTotal: numeric('grand_total', { precision: 14, scale: 2 }).notNull().default('0'),
  irn: text('irn'),
  ackNo: varchar('ack_no', { length: 40 }),
  ackDate: timestamp('ack_date', { withTimezone: true }),
  signedQr: text('signed_qr'),
  ewayBillNo: varchar('eway_bill_no', { length: 20 }),
  status: varchar('status', { length: 20 }).notNull().default('issued'),
  terms: text('terms'),
  notes: text('notes'),
  columnDefs: jsonb('column_defs').$type<ColumnDef[]>().notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid('created_by'),
  ...ts(),
}, (t) => ({ tenantIdx: index('tax_invoice_tenant_idx').on(t.tenantId) }));

// ── AI gateway metering (docs/05 §1) ────────────────────────────────────────

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  feature: varchar('feature', { length: 30 }).notNull(),
  model: varchar('model', { length: 60 }).notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index('ai_usage_tenant_idx').on(t.tenantId, t.createdAt) }));

// Staged assistant actions (docs/05 §5 human-in-the-loop): every write the AI
// proposes is stored here first and only executed after the user confirms in
// the UI — doubling as the audit trail of what the agent did.
export const aiAction = pgTable('ai_action', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: varchar('kind', { length: 40 }).notNull(),
  payload: jsonb('payload').notNull(),
  summary: text('summary').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('pending'),
  result: jsonb('result'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index('ai_action_tenant_idx').on(t.tenantId, t.createdAt) }));

// Customer receipts against a tax invoice (accounts-receivable). Outstanding &
// aging are derived from these vs the invoice grand total — never stored stale.
export const payment = pgTable('payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  paidOn: timestamp('paid_on', { withTimezone: true }).notNull().defaultNow(),
  method: varchar('method', { length: 16 }).notNull().default('bank'),
  reference: varchar('reference', { length: 60 }),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('payment_tenant_idx').on(t.tenantId),
  invoiceIdx: index('payment_invoice_idx').on(t.invoiceId),
}));

export const taxInvoiceItem = pgTable('tax_invoice_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  seq: integer('seq').notNull().default(1),
  description: text('description').notNull(),
  hsn: varchar('hsn', { length: 10 }),
  qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1'),
  uom: varchar('uom', { length: 10 }).notNull().default('NOS'),
  rate: numeric('rate', { precision: 14, scale: 2 }).notNull().default('0'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull().default('18'),
  taxableValue: numeric('taxable_value', { precision: 14, scale: 2 }).notNull().default('0'),
  groupLabel: varchar('group_label', { length: 120 }),
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
}, (t) => ({ iIdx: index('tax_invoice_item_i_idx').on(t.invoiceId) }));

// ── Inbound lead capture (email → Lead Inbox) ───────────────────────────────

// A per-tenant lead source. Phase-1 ships `email_webhook` (a mail-forwarding
// provider POSTs parsed enquiries to /api/leads/inbound). `imap`, `indiamart`
// and `tradeindia` are reserved for later phases (they add a `secret` column).
export const leadChannel = pgTable('lead_channel', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('email_webhook'),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  // Non-secret config: { inboundToken, defaultOwnerUserId, senderAllowlist[], autoCreate }.
  // `inboundToken` routes the capture address (leads+<token>@…) back to this tenant.
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...ts(),
}, (t) => ({
  tenantIdx: index('lead_channel_tenant_idx').on(t.tenantId),
  nameUq: uniqueIndex('lead_channel_name_uq').on(t.tenantId, t.kind, t.name),
}));

// Raw + parsed record of every inbound enquiry. `externalId` (the email
// Message-ID or a marketplace lead id) makes ingestion idempotent; `status`
// drives the Lead Inbox triage queue.
export const inboundMessage = pgTable('inbound_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  channelId: uuid('channel_id'),
  channelKind: varchar('channel_kind', { length: 20 }).notNull().default('email_webhook'),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  fromName: text('from_name'),
  fromEmail: varchar('from_email', { length: 255 }),
  fromPhone: varchar('from_phone', { length: 40 }),
  subject: text('subject'),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  rawHeaders: jsonb('raw_headers'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  // pending | converted | ignored | spam | duplicate | failed
  status: varchar('status', { length: 12 }).notNull().default('pending'),
  parseMethod: varchar('parse_method', { length: 10 }).notNull().default('none'), // template | ai | none
  parsed: jsonb('parsed'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  attachments: jsonb('attachments'),
  leadId: uuid('lead_id'),
  dedupeReason: text('dedupe_reason'),
  error: text('error'),
  ...ts(),
}, (t) => ({
  externalUq: uniqueIndex('inbound_message_external_uq').on(t.tenantId, t.channelKind, t.externalId),
  statusIdx: index('inbound_message_status_idx').on(t.tenantId, t.status),
}));
