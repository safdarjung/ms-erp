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
  hsn: { type: 'string', description: 'HSN/SAC code — default 84807100 (rubber/plastic moulding dies) unless the item is clearly something else' },
  qty: { type: 'number' },
  uom: { type: 'string', description: 'NOS, SET, KG, HRS…' },
  rate: { type: 'number', description: 'Unit rate in INR, ex-GST' },
  gstRate: { type: 'number', description: 'GST percent — 18 unless the user or history says otherwise' },
  groupLabel: {
    type: 'string',
    description:
      'The PART this line belongs to, e.g. "30017AW1002" or "Bracket LH". Every item made for the same part carries the same value and they print together under one heading with a subtotal. ' +
      'Omit only for standalone lines (e.g. a trial/proving charge).',
  },
  groupNote: {
    type: 'string',
    description:
      "Detail about the PART itself, printed beside its heading — drawing no., component name, material, sheet thickness, e.g. \"Drawing DRG-114 · MS 2mm\". Send the same text on every line of that part. Don't put per-item specs here; those go in attributes.",
  },
  attributes: {
    type: 'array',
    description:
      'Specs for THIS item, as {name,value} pairs — e.g. [{"name":"Material","value":"D2"},{"name":"Hardness","value":"58-60 HRC"},{"name":"Size","value":"200x150x25"}]. ' +
      'Reuse the SAME name across items so they line up as one field (up to 16 per document). Short values (1–2 fields) print as their own column; more than that print under the item description, so give as many specs as the user mentioned. ' +
      'Descriptive only — never affects price or GST.',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Column name — repeat identically across lines that share the column' },
        value: { type: 'string', description: "This line's value for that column" },
      },
      required: ['name', 'value'],
    },
  },
};

const ITEM_FIELDS_TOOLING: Record<string, JsonSchemaProp> = {
  ...ITEM_FIELDS,
  isToolingCharge: { type: 'boolean', description: 'True for a one-time tooling / NRE line' },
};

const itemsProp = (tooling: boolean): JsonSchemaProp => ({
  type: 'array',
  description: 'Line items (1–60). Taxable values, GST split and totals are computed by the app — never by you.',
  items: {
    type: 'object',
    properties: tooling ? ITEM_FIELDS_TOOLING : ITEM_FIELDS,
    required: ['description', 'qty', 'rate'],
  },
});

// ── Line-level edit operations (update_* / duplicate_quotation) ─────────────
// The model names lines by the S.No printed on the document and says WHAT
// changes; the server resolves the ops into the full new line list and shows
// the user a change list. Far more reliable than re-sending 30 lines.

const EDIT_OP: JsonSchemaProp = {
  type: 'object',
  description:
    'One edit. Every `line` / `lines` / `toLine` / `afterLine` number is the S.No printed on the document BEFORE this batch ' +
    '(exactly as get_document returned it) — plan all edits from one read; lines added in this batch cannot be targeted by later ops.',
  properties: {
    op: {
      type: 'string',
      enum: ['update', 'add', 'remove', 'move', 'adjust_rates', 'set_gst', 'set_group', 'rename_group', 'set_group_note',
        'set_specs', 'set_column', 'set_column_display', 'rename_column', 'remove_column'],
      description:
        'update = change fields of one line (pass only the fields that change) · add = insert a new line (`item`) · remove = delete one line · ' +
        'move = reorder (`line` → `toLine`) · adjust_rates = change rates by `percent` or `amount` on `lines` / a part (`groupLabel`) / all · ' +
        'set_gst = set `gstRate` on `lines` / a part / all · set_group = put `lines` under part `groupLabel` ("" = no part) · ' +
        'rename_group = rename a part (`from` → `to`) · set_group_note = set the part detail (`groupLabel` + `note`; "" clears it) · ' +
        'set_specs = write the same spec values (`specs`) on `lines` / a whole part / all — the quick way to say "every die of this part is D2, 58-60 HRC" · ' +
        'set_column = create/fill one field `name` with per-line `values` · set_column_display = show a field as its own column or under the item (`name` + `display`) · ' +
        'rename_column (`from` → `to`) · remove_column (`name`)',
    },
    line: { type: 'integer', description: 'Target line S.No (update / remove / move). For adjust_rates / set_gst a single-line scope.' },
    lines: { type: 'array', items: { type: 'integer' }, description: 'Several target lines (adjust_rates / set_gst / set_group)' },
    groupLabel: {
      type: 'string',
      description: 'update/add/move: the part this line belongs to ("" = no part). adjust_rates/set_gst/set_specs: scope = every line of this part. set_group / set_group_note: the part concerned.',
    },
    note: {
      type: 'string',
      description: 'set_group_note (also set_group / add): the part detail printed beside its heading, e.g. "Drawing DRG-114 · MS 2mm". "" removes it.',
    },
    specs: {
      type: 'array',
      description: 'set_specs: field values written to every line in scope, as {name,value} pairs. An empty value clears that field on those lines.',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
        required: ['name', 'value'],
      },
    },
    display: {
      type: 'string',
      enum: ['column', 'spec'],
      description: "set_column_display (also set_column when creating one): 'column' gives the field its own table column (only for short values); 'spec' prints it under the item description.",
    },
    toLine: { type: 'integer', description: 'move: the printed position the line should end up at' },
    afterLine: { type: 'integer', description: 'add: insert after this line (0 = at the top). Omit to append at the end of the given part, else at the end of the document.' },
    item: { type: 'object', description: 'add: the new line', properties: ITEM_FIELDS_TOOLING, required: ['description', 'qty', 'rate'] },
    description: { type: 'string', description: 'update: new description' },
    hsn: { type: 'string', description: 'update: new HSN/SAC' },
    qty: { type: 'number', description: 'update: new quantity' },
    uom: { type: 'string', description: 'update: new unit' },
    rate: { type: 'number', description: 'update: new ex-GST unit rate (INR)' },
    gstRate: { type: 'number', description: 'update: new GST % for that line · set_gst: the GST % to apply' },
    isToolingCharge: { type: 'boolean', description: 'update: mark/unmark as a one-time tooling / NRE line (quotations)' },
    attributes: {
      type: 'array', description: 'update: custom-column values for this line as {name,value} pairs (a new name creates the column)',
      items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] },
    },
    percent: { type: 'number', description: 'adjust_rates: change rates by this percent (+5 = 5% up, -10 = 10% discount)' },
    amount: { type: 'number', description: 'adjust_rates: add this ₹ amount to each rate (negative to reduce)' },
    roundTo: { type: 'number', description: 'adjust_rates: round the new rates to a multiple of this (e.g. 100 or 500)' },
    from: { type: 'string', description: 'rename_group / rename_column: current name' },
    to: { type: 'string', description: 'rename_group / rename_column: new name' },
    name: { type: 'string', description: 'set_column / remove_column: the column name' },
    values: {
      type: 'array', description: 'set_column: per-line values ({line, value}); an empty value clears the cell',
      items: { type: 'object', properties: { line: { type: 'integer' }, value: { type: 'string' } }, required: ['line', 'value'] },
    },
  },
  required: ['op'],
};

const editsProp: JsonSchemaProp = {
  type: 'array',
  description:
    'Line-level edits applied to the CURRENT lines, in order (read them with get_document first). Preferred over `items` for any change ' +
    'that keeps most of the document — one rate, a few lines, "+5% on everything", rename a part, add a column. Never send both `edits` and `items`.',
  items: EDIT_OP,
};

const uuidOptional = (what: string): JsonSchemaProp => ({
  type: 'string',
  description: `UUID of the ${what} (from a query result / current page) — optional`,
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
      '(anchor on quote history for similar work); the app computes taxable values, CGST/SGST/IGST and totals deterministically. ' +
      'For multi-part jobs set each line\'s groupLabel to its part so lines group under a heading with a subtotal; ' +
      'add per-line attributes {name,value} pairs when the user wants extra descriptive columns (e.g. steel grade, cavities).',
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
      'Edit an existing quotation (same number). Lines: pass `edits` (line-level ops against the current lines — read them with get_document first) ' +
      'or, only when rebuilding the whole document, `items` (REPLACES every line). Header: terms, notes, date, validity — omit to keep. ' +
      'Totals & GST recompute automatically; the user sees a change list and can fine-tune on the card. Converted / ordered quotations are locked.',
    permission: 'quotation.edit',
    properties: {
      id: uuid('quotation'),
      docDate: { type: 'string', description: 'New document date YYYY-MM-DD (omit to keep)' },
      validityDays: { type: 'integer' },
      terms: { type: 'string', description: 'Full replacement terms, one per line (omit to keep)' },
      notes: { type: 'string', description: 'Replacement notes (omit to keep)' },
      edits: editsProp,
      items: itemsProp(true),
    },
    required: ['id'],
  },
  {
    name: 'duplicate_quotation',
    description:
      'Create a NEW quotation by copying an existing one — every line, part (with its detail), every item spec, extra field, terms and notes — optionally for a ' +
      'different customer and with `edits` applied to the copy (e.g. rates +5%, drop a line). The original is untouched. ' +
      'Use for repeat jobs and "same as QT/… but …" requests. Gets today\'s date and the next number.',
    permission: 'quotation.create',
    properties: {
      quotationId: uuid('source quotation'),
      customerId: uuidOptional('customer the copy is for (omit = same customer)'),
      docDate: { type: 'string', description: 'Document date YYYY-MM-DD; omit for today' },
      validityDays: { type: 'integer', description: 'Omit to keep the source validity' },
      terms: { type: 'string', description: 'Replacement terms, one per line (omit to copy)' },
      notes: { type: 'string', description: 'Replacement notes (omit to copy)' },
      edits: editsProp,
    },
    required: ['quotationId'],
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
      notes: { type: 'string', description: 'Note printed on the invoice (optional)' },
      items: itemsProp(false),
    },
    required: ['customerId', 'items'],
  },
  {
    name: 'update_invoice',
    description:
      'Edit an existing tax invoice / bill (same number). Lines: pass `edits` (line-level ops against the current lines — read them with get_document first) ' +
      'or, only when rebuilding the whole document, `items` (REPLACES every line). Header: terms, notes, date, PO ref — omit to keep. ' +
      'Tax figures recompute automatically; the user sees a change list and can fine-tune on the card. Cancelled invoices are locked.',
    permission: 'invoice.edit',
    properties: {
      id: uuid('invoice'),
      docDate: { type: 'string', description: 'New document date YYYY-MM-DD (omit to keep)' },
      poRef: { type: 'string' },
      terms: { type: 'string', description: 'Full replacement terms, one per line (omit to keep)' },
      notes: { type: 'string', description: 'Replacement notes (omit to keep)' },
      edits: editsProp,
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
    name: 'update_order',
    description:
      'Edit an existing sales order (same number): lines via `edits` (read them with get_document first) or a full `items` replacement; ' +
      'PO ref, delivery date, category, material ownership, date — omit to keep. Locked once invoiced or cancelled.',
    permission: 'order.edit',
    properties: {
      id: uuid('sales order'),
      docDate: { type: 'string', description: 'New order date YYYY-MM-DD (omit to keep)' },
      deliveryDate: { type: 'string', description: 'Promised delivery date YYYY-MM-DD ("" to clear)' },
      poRef: { type: 'string' },
      orderCategory: { type: 'string', enum: ['job_work', 'own_manufacture', 'tool_build', 'repair'] },
      materialOwnership: { type: 'string', enum: ['customer', 'company'] },
      edits: editsProp,
      items: itemsProp(false),
    },
    required: ['id'],
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

// ── Read a document in full (instant, not staged) ───────────────────────────

export const DOCUMENT_TYPES = ['quotation', 'invoice', 'order'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const GET_DOCUMENT_TOOL: ActionToolDef = {
  name: 'get_document',
  description:
    'Read one quotation / tax invoice / sales order in full — header, customer, the numbered lines exactly as printed (S.No, part, ' +
    'each item\'s specs by name, one-time-charge flag, rate, GST %), the parts with their detail and subtotals, the extra fields and how each one prints, ' +
    'totals, terms, notes and whether it is locked. Instant, no confirmation. ' +
    'Use it BEFORE editing a document, whenever the user refers to a document by number, and to copy lines from one document to another. ' +
    'Pass the uuid when you have it (query result / current page), otherwise the number or a fragment of it ("0003", "26-27/0012", "781").',
  permission: '',
  properties: {
    type: { type: 'string', enum: [...DOCUMENT_TYPES], description: 'quotation | invoice (tax invoice / bill) | order (sales order)' },
    id: { type: 'string', description: 'Record uuid, when known' },
    number: { type: 'string', description: 'Document number or a fragment of it — used when the uuid is not known' },
  },
  required: ['type'],
};

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
