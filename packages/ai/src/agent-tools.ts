// The agent's write/navigation tool registry — one provider-neutral source of
// truth (like TOOL_META for query/chart). Every write tool is STAGED: the loop
// never executes it directly; the web layer validates, previews and stores it
// as a pending ai_action row, and the user confirms in the UI (docs/05 §5
// human-in-the-loop). Schemas here are for the model; the server re-validates
// everything with zod before staging AND before executing.

// ── Minimal JSON-Schema subset both providers can express ───────────────────

export type JsonSchemaProp = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

export type ActionToolDef = {
  /** Tool name = ai_action.kind. */
  name: string;
  description: string;
  /** ERP permission key the user must hold (checked again server-side). */
  permission: string;
  properties: Record<string, JsonSchemaProp>;
  required: string[];
};

// ── Shared fragments ────────────────────────────────────────────────────────

const uuid = (what: string): JsonSchemaProp => ({
  type: 'string',
  description: `UUID of the ${what} — must come from a run_analytics_query result in this conversation, never guessed`,
});

const CUSTOMER_FIELDS: Record<string, JsonSchemaProp> = {
  name: { type: 'string', description: 'Company / customer name' },
  regType: { type: 'string', enum: ['registered', 'unregistered'], description: 'GST registration type' },
  gstin: { type: 'string', description: '15-character GSTIN (registered customers only)' },
  stateCode: { type: 'string', description: '2-digit Indian GST state code, e.g. 06 = Haryana' },
  contactPerson: { type: 'string' },
  phone: { type: 'string' },
  email: { type: 'string' },
  address: { type: 'string', description: 'Postal address for documents' },
  creditTermsDays: { type: 'integer', description: 'Credit period in days (0 = advance)' },
};

const LEAD_FIELDS: Record<string, JsonSchemaProp> = {
  customerName: { type: 'string', description: 'Prospect / company name' },
  contact: { type: 'string', description: 'Contact person' },
  phone: { type: 'string' },
  email: { type: 'string' },
  source: { type: 'string', description: 'e.g. IndiaMART, WhatsApp, Referral, Walk-in' },
  requirement: { type: 'string', description: 'What they need, in one or two lines' },
  stage: { type: 'string', enum: ['new', 'contacted', 'negotiation', 'won', 'lost'] },
  valueEstimate: { type: 'number', description: 'Estimated deal value in INR' },
  nextFollowupAt: { type: 'string', description: 'Next follow-up date, YYYY-MM-DD' },
};

const ITEM_FIELDS: Record<string, JsonSchemaProp> = {
  description: { type: 'string', description: 'Line description as it should appear on the document' },
  hsn: { type: 'string', description: 'HSN/SAC code; omit if unknown' },
  qty: { type: 'number' },
  uom: { type: 'string', description: 'NOS, SET, KG, HRS…' },
  rate: { type: 'number', description: 'Unit rate in INR, ex-GST' },
  gstRate: { type: 'number', description: 'GST percent — 18 unless the user or history says otherwise' },
};

const itemsProp = (tooling: boolean): JsonSchemaProp => ({
  type: 'array',
  description: 'Line items (1–15). Taxable values, GST split and totals are computed by the app — never by you.',
  items: {
    type: 'object',
    properties: tooling
      ? { ...ITEM_FIELDS, isToolingCharge: { type: 'boolean', description: 'True for a one-time tooling / NRE line' } }
      : ITEM_FIELDS,
    required: ['description', 'qty', 'rate'],
  },
});

// ── The registry ────────────────────────────────────────────────────────────

export const ACTION_TOOLS: ActionToolDef[] = [
  {
    name: 'create_customer',
    description: 'Add a new customer (proposed to the user for confirmation).',
    permission: 'customer.create',
    properties: CUSTOMER_FIELDS,
    required: ['name'],
  },
  {
    name: 'update_customer',
    description: 'Change fields of an existing customer. Query the current values first and only pass the fields that change.',
    permission: 'customer.edit',
    properties: { id: uuid('customer'), ...CUSTOMER_FIELDS },
    required: ['id'],
  },
  {
    name: 'delete_customer',
    description: 'Permanently delete a customer. Only when the user explicitly asks to delete.',
    permission: 'customer.delete',
    properties: { id: uuid('customer') },
    required: ['id'],
  },
  {
    name: 'create_lead',
    description: 'Record a new sales lead / enquiry.',
    permission: 'lead.create',
    properties: LEAD_FIELDS,
    required: ['customerName'],
  },
  {
    name: 'update_lead',
    description: 'Update a lead — move its stage, set the next follow-up, correct details. Pass only the fields that change.',
    permission: 'lead.edit',
    properties: { id: uuid('lead'), ...LEAD_FIELDS },
    required: ['id'],
  },
  {
    name: 'delete_lead',
    description: 'Permanently delete a lead and its activity log. Only when the user explicitly asks to delete.',
    permission: 'lead.delete',
    properties: { id: uuid('lead') },
    required: ['id'],
  },
  {
    name: 'log_lead_activity',
    description: 'Log a call / email / meeting / note on a lead.',
    permission: 'lead.edit',
    properties: {
      leadId: uuid('lead'),
      type: { type: 'string', enum: ['call', 'email', 'meeting', 'note'] },
      notes: { type: 'string', description: 'What happened / what was agreed' },
    },
    required: ['leadId', 'notes'],
  },
  {
    name: 'convert_lead_to_customer',
    description: 'Mark a lead won and create a customer from it (idempotent — safe if already converted).',
    permission: 'customer.create',
    properties: { leadId: uuid('lead') },
    required: ['leadId'],
  },
  {
    name: 'create_quotation',
    description:
      'Draft a quotation with line items. You propose descriptions, quantities and ex-GST rates ' +
      '(anchor on quote history for similar work); the app computes taxable values, CGST/SGST/IGST and totals deterministically.',
    permission: 'quotation.create',
    properties: {
      customerId: uuid('customer'),
      docDate: { type: 'string', description: 'Document date YYYY-MM-DD; omit for today' },
      validityDays: { type: 'integer', description: 'Offer validity in days (default 15)' },
      terms: { type: 'string', description: 'Terms & conditions, one per line' },
      notes: { type: 'string' },
      items: itemsProp(true),
    },
    required: ['customerId', 'items'],
  },
  {
    name: 'update_quotation',
    description:
      'Edit an existing quotation (same number): change items, terms, notes, date or validity. ' +
      'The items array REPLACES all existing lines — query quotation_item first and resend unchanged lines too. ' +
      'Totals & GST recompute automatically. Converted quotations are locked.',
    permission: 'quotation.edit',
    properties: {
      id: uuid('quotation'),
      docDate: { type: 'string', description: 'New document date YYYY-MM-DD (omit to keep)' },
      validityDays: { type: 'integer' },
      terms: { type: 'string', description: 'Full replacement terms, one per line (omit to keep)' },
      notes: { type: 'string' },
      items: itemsProp(true),
    },
    required: ['id'],
  },
  {
    name: 'set_quotation_status',
    description: 'Move a quotation between draft / sent / approved / rejected. Converted quotations are locked.',
    permission: 'quotation.edit',
    properties: {
      id: uuid('quotation'),
      status: { type: 'string', enum: ['draft', 'sent', 'approved', 'rejected'] },
    },
    required: ['id', 'status'],
  },
  {
    name: 'convert_quotation_to_invoice',
    description: 'Create a GST tax invoice from a quotation (idempotent — returns the existing invoice if already converted).',
    permission: 'invoice.create',
    properties: { quotationId: uuid('quotation') },
    required: ['quotationId'],
  },
  {
    name: 'create_invoice',
    description:
      'Create a GST tax invoice directly (without a quotation). The app computes all tax figures deterministically.',
    permission: 'invoice.create',
    properties: {
      customerId: uuid('customer'),
      docDate: { type: 'string', description: 'Document date YYYY-MM-DD; omit for today' },
      poRef: { type: 'string', description: "Customer's PO reference, if any" },
      terms: { type: 'string', description: 'Terms, one per line' },
      items: itemsProp(false),
    },
    required: ['customerId', 'items'],
  },
  {
    name: 'update_invoice',
    description:
      'Edit an existing tax invoice / bill (same number): change items, terms, notes, date or PO ref. ' +
      'The items array REPLACES all existing lines — query tax_invoice_item first and resend unchanged lines too. ' +
      'Tax figures recompute automatically. Cancelled invoices are locked.',
    permission: 'invoice.edit',
    properties: {
      id: uuid('invoice'),
      docDate: { type: 'string', description: 'New document date YYYY-MM-DD (omit to keep)' },
      poRef: { type: 'string' },
      terms: { type: 'string', description: 'Full replacement terms, one per line (omit to keep)' },
      notes: { type: 'string' },
      items: itemsProp(false),
    },
    required: ['id'],
  },
  {
    name: 'set_invoice_status',
    description: 'Cancel an invoice or set it back to issued. (Paid/partly-paid is tracked automatically from recorded payments — use record_payment for receipts.)',
    permission: 'invoice.edit',
    properties: {
      id: uuid('invoice'),
      status: { type: 'string', enum: ['issued', 'cancelled'] },
    },
    required: ['id', 'status'],
  },
  {
    name: 'convert_quotation_to_order',
    description: 'Open a sales order from a quotation (idempotent). GST is finalised later when the order is invoiced.',
    permission: 'order.create',
    properties: {
      quotationId: uuid('quotation'),
      orderCategory: { type: 'string', enum: ['job_work', 'own_manufacture', 'tool_build', 'repair'] },
      materialOwnership: { type: 'string', enum: ['customer', 'company'], description: 'Who supplies the material' },
    },
    required: ['quotationId'],
  },
  {
    name: 'convert_order_to_invoice',
    description: 'Raise a GST tax invoice from a sales order (idempotent — returns the existing invoice if already raised).',
    permission: 'invoice.create',
    properties: { orderId: uuid('sales order') },
    required: ['orderId'],
  },
  {
    name: 'record_payment',
    description: 'Record a customer payment (receipt) against a tax invoice — reduces its outstanding amount. Cannot exceed what is outstanding.',
    permission: 'invoice.edit',
    properties: {
      invoiceId: uuid('invoice'),
      amount: { type: 'number', description: 'Amount received in INR' },
      paidOn: { type: 'string', description: 'Payment date YYYY-MM-DD; omit for today' },
      method: { type: 'string', enum: ['bank', 'upi', 'cash', 'cheque', 'card', 'other'] },
      reference: { type: 'string', description: 'UTR / cheque no. / transaction reference' },
    },
    required: ['invoiceId', 'amount'],
  },
  {
    name: 'delete_payment',
    description: 'Remove a recorded payment (receipt) from an invoice — re-opens that amount as outstanding. Only when the user explicitly asks to reverse/delete a receipt.',
    permission: 'invoice.edit',
    properties: { id: uuid('payment') },
    required: ['id'],
  },
  {
    name: 'create_order',
    description: 'Create a sales order directly with line items (when there is no quotation to convert from). GST is finalised later when the order is invoiced.',
    permission: 'order.create',
    properties: {
      customerId: uuid('customer'),
      docDate: { type: 'string', description: 'Order date YYYY-MM-DD; omit for today' },
      deliveryDate: { type: 'string', description: 'Promised delivery date YYYY-MM-DD' },
      poRef: { type: 'string', description: "Customer's PO reference" },
      orderCategory: { type: 'string', enum: ['job_work', 'own_manufacture', 'tool_build', 'repair'] },
      materialOwnership: { type: 'string', enum: ['customer', 'company'], description: 'Who supplies the material' },
      items: itemsProp(false),
    },
    required: ['customerId', 'items'],
  },
  {
    name: 'set_order_status',
    description: 'Move a sales order between open / in production / delivered / closed / cancelled.',
    permission: 'order.edit',
    properties: {
      id: uuid('sales order'),
      status: { type: 'string', enum: ['open', 'in_progress', 'delivered', 'closed', 'cancelled'] },
    },
    required: ['id', 'status'],
  },
  {
    name: 'set_customer_status',
    description: 'Archive or restore a customer (reversible — the safe alternative to deleting one that has documents).',
    permission: 'customer.edit',
    properties: {
      id: uuid('customer'),
      status: { type: 'string', enum: ['active', 'archived'] },
    },
    required: ['id', 'status'],
  },
];

export const ACTION_TOOL_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

// ── Navigation (instant, not staged) ────────────────────────────────────────

export const PAGE_TARGETS = {
  dashboard: { path: '/dashboard', label: 'Dashboard' },
  leads: { path: '/leads', label: 'Leads' },
  customers: { path: '/customers', label: 'Customers' },
  quotations: { path: '/quotations', label: 'Quotations' },
  new_quotation: { path: '/quotations/new', label: 'New quotation form' },
  quotation: { path: '/quotations/:id', label: 'Quotation', needsId: true },
  orders: { path: '/orders', label: 'Order book' },
  new_order: { path: '/orders/new', label: 'New order form' },
  order: { path: '/orders/:id', label: 'Order', needsId: true },
  invoices: { path: '/invoices', label: 'Invoices' },
  new_invoice: { path: '/invoices/new', label: 'New invoice form' },
  invoice: { path: '/invoices/:id', label: 'Invoice', needsId: true },
  print_quotation: { path: '/print/quotation/:id', label: 'Quotation PDF', needsId: true, newTab: true },
  print_invoice: { path: '/print/invoice/:id', label: 'Invoice PDF', needsId: true, newTab: true },
  users: { path: '/settings/users', label: 'Users & roles' },
  change_password: { path: '/settings/password', label: 'Change password' },
} as const;

export type PageKey = keyof typeof PAGE_TARGETS;

export const OPEN_PAGE_TOOL: ActionToolDef = {
  name: 'open_page',
  description:
    'Navigate the app for the user — opens a screen (or a print-ready PDF in a new tab) immediately, no confirmation. ' +
    'Use when the user asks to see something, and to show a record you just worked on.',
  permission: '',
  properties: {
    page: { type: 'string', enum: Object.keys(PAGE_TARGETS) },
    id: { type: 'string', description: 'Record UUID — required for quotation / invoice / print pages' },
  },
  required: ['page'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NavTarget = { path: string; label: string; newTab: boolean };

/** Resolve an open_page call to a concrete path, or explain what's wrong. */
export function resolvePage(input: { page?: string; id?: string }): NavTarget | { error: string } {
  const target = PAGE_TARGETS[input.page as PageKey];
  if (!target) return { error: `Unknown page "${input.page}". Pages: ${Object.keys(PAGE_TARGETS).join(', ')}` };
  if ('needsId' in target && target.needsId) {
    if (!input.id || !UUID_RE.test(input.id)) {
      return { error: `Page "${input.page}" needs a valid record UUID in "id" — get it from a query first.` };
    }
    return { path: target.path.replace(':id', input.id), label: target.label, newTab: 'newTab' in target && !!target.newTab };
  }
  return { path: target.path, label: target.label, newTab: false };
}
