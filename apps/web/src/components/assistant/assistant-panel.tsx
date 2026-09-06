'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { LEAD_STAGE_LABELS, MATERIAL_OWNERSHIP_LABELS, ORDER_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from '@ms/core';
import { ShortcutKbd } from '@/components/shortcut-kbd';
import { MicButton } from './mic-button';
import { ChangeList, DocPreview, type PreviewDocMeta } from './doc-preview';
import { DocumentReviewModal } from './document-review';

// ── Types mirrored from the NDJSON protocol of /api/assistant ───────────────

type ChartSpec = { title: string; kind: 'bar'; labels: string[]; values: number[] };
type Cell = string | number | boolean | null;
type EditField = { key: string; label: string; type: 'text' | 'number' | 'date' | 'textarea' | 'select'; options?: string[] };
type EditItem = { description: string; hsn?: string; qty: number; uom?: string; rate: number; gstRate: number; isToolingCharge?: boolean; groupLabel?: string; groupNote?: string; attributes?: Record<string, string> };
type EditColumn = { id: string; label: string; display?: 'column' | 'spec' };
type ActionInfo = {
  actionId: string;
  kind: string;
  title: string;
  details: { label: string; value: string }[];
  items?: string[];
  changes?: string[];
  warning?: string;
  editable?: EditField[];
  payload?: Record<string, unknown>;
  editItems?: EditItem[];
  doc?: PreviewDocMeta;
};
type ActionPhase = 'pending' | 'executing' | 'executed' | 'cancelled' | 'failed';
type ActionPart = {
  kind: 'action'; action: ActionInfo; phase: ActionPhase; result?: string;
  /** In-app page of the saved record ("Open quotation →"). */
  path?: string;
  /** Print/PDF page (quotations and bills) — opens in a new tab. */
  printPath?: string;
  /** What was saved (quotation / invoice / order / customer / lead) — picks the link wording. */
  entityType?: string;
};
type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; label: string; done: boolean }
  | { kind: 'table'; title: string; columns: string[]; rows: Cell[][] }
  | { kind: 'chart'; spec: ChartSpec }
  | ActionPart
  | { kind: 'nav'; label: string; path: string; newTab?: boolean };
type Msg =
  | { role: 'user'; text: string; hidden?: boolean; files?: string[] }
  | { role: 'assistant'; parts: Part[] };

// Multimodal attachment (base64, no data: prefix) — mirrors @ms/ai's protocol.
// Kept local so this client bundle never imports the server-side AI package.
type Attachment = { name?: string; mimeType: string; data: string };
type PendingFile = Attachment & { name: string; size: number };

const ATTACH_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const ATTACH_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_FILES = 3;
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const MAX_FILES_TOTAL_BYTES = 15 * 1024 * 1024;

/** Read a File into base64 (strips the `data:<mime>;base64,` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

const isImageMime = (m: string) => m.startsWith('image/');

// ── Thread persistence (survives a reload / navigation within the tab) ──────

const THREAD_KEY = 'ms-assistant:thread:v2';
const WIDE_KEY = 'ms-assistant:wide';
const MAX_STORED_MSGS = 60;

function loadThread(): Msg[] {
  try {
    const raw = window.sessionStorage.getItem(THREAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Msg[];
    if (!Array.isArray(parsed)) return [];
    // Nothing is in flight after a reload: settle spinners; an action that was
    // mid-execution is unknowable here — say so rather than pretend.
    return parsed.map((m) => m.role === 'assistant'
      ? { ...m, parts: m.parts.map((p) =>
          p.kind === 'tool' ? { ...p, done: true }
          : p.kind === 'action' && p.phase === 'executing'
            ? { ...p, phase: 'failed' as const, result: 'The page reloaded while this was saving. Open the quotation / bill list to check whether it was saved.' }
            : p) }
      : m);
  } catch { return []; }
}
function saveThread(msgs: Msg[]) {
  try {
    if (!msgs.length) window.sessionStorage.removeItem(THREAD_KEY);
    else window.sessionStorage.setItem(THREAD_KEY, JSON.stringify(msgs.slice(-MAX_STORED_MSGS)));
  } catch { /* quota / private mode — non-fatal */ }
}

// Starter prompts. Questions send on tap. "✎" examples are things the AI will
// DO — they fill the box as a template ([customer], [rate]…) so the user edits
// the blanks before sending, rather than firing a half-made request.
type Suggestion = { text: string; fill?: boolean };
const ask = (text: string): Suggestion => ({ text });
const write = (text: string): Suggestion => ({ text: `✎ ${text}`, fill: true });
const QUOTE_TEMPLATE = write('Quotation for [customer]: [die] ₹[rate], [die] ₹[rate]');
const ENQUIRY_TEMPLATE = write('New enquiry: [company] — [what they need], approx ₹[value]');
const DEFAULT_SUGGESTIONS: Suggestion[] = [
  ask('What needs my attention today?'),
  QUOTE_TEMPLATE,
  ask('Kisne payment nahi di?'),
  ENQUIRY_TEMPLATE,
  ask('इस महीने कितनी बिक्री हुई?'),
];

const UUID_SEG = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Starter prompts tuned to the screen the user is on (falls back to the defaults). */
function suggestionsFor(path: string | null): Suggestion[] {
  if (!path) return DEFAULT_SUGGESTIONS;
  const onRecord = (base: string) => path.startsWith(base + '/') && UUID_SEG.test(path);
  if (onRecord('/invoices')) return [
    write('Payment received on this bill: ₹[amount] by [UPI / bank]'),
    write('Line [3] ka rate [32,000] karo'),
    write('Add a note to this bill: [goods sent via …]'),
    ask('How much is still due on this bill?'),
    ask('Open this bill as a PDF'),
  ];
  if (onRecord('/quotations')) return [
    write('Increase all rates on this quotation by [5]%'),
    write('Add a "[Steel grade]" column to this quotation'),
    write('Copy this quotation for [customer]'),
    write('Make a bill from this quotation'),
    ask('Open this quotation as a PDF'),
  ];
  if (onRecord('/orders')) return [
    write('Mark this order as In production'),
    write('Set the delivery date of this order to [next Friday]'),
    write('Make the bill for this order'),
    write('Mark this order as Delivered'),
  ];
  if (onRecord('/customers')) return [
    write('Quotation for this customer: [die] ₹[rate], [die] ₹[rate]'),
    write('Copy this customer’s last quotation with [5]% higher rates'),
    ask('Bills still due from this customer'),
    ask('What have we billed this customer this year?'),
  ];
  if (onRecord('/leads')) return [
    write('Add a call note to this enquiry: [what was discussed]'),
    write('Follow up on this enquiry next [Monday]'),
    write('Add this enquiry as a customer'),
  ];
  if (path.startsWith('/leads')) return [ask('Which follow-ups are due today?'), ENQUIRY_TEMPLATE, ask('Enquiries by source this month')];
  if (path.startsWith('/invoices')) return [
    ask('Kisne payment nahi di?'),
    ask('What did we bill this month?'),
    write('Change bill [INV/26-27/0012]: line [1] qty [2]'),
    ask('Overdue bills this year'),
  ];
  if (path.startsWith('/quotations')) return [
    QUOTE_TEMPLATE,
    write('Copy the last quotation for [customer] with [5]% higher rates'),
    ask('Quotations still waiting for a reply'),
    ask('How many quotations turned into bills this year?'),
  ];
  if (path.startsWith('/orders')) return [ask('Orders due for delivery this week'), ask('Open orders with no bill yet'), ask('Order value by category')];
  if (path.startsWith('/customers')) return [ask('Top 5 customers by billing this year'), ask('Customers with overdue bills'), ask('New customers added this month')];
  return DEFAULT_SUGGESTIONS;
}

/**
 * Open the assistant from anywhere. With a question it sends it; with
 * `fill: true` it only puts the text in the box (for templates the user
 * should finish first).
 */
export function openAssistant(question?: string, opts?: { fill?: boolean }) {
  window.dispatchEvent(new CustomEvent('ms-assistant', { detail: { question, fill: opts?.fill } }));
}

// ── Small render helpers ────────────────────────────────────────────────────

function fmtCell(v: Cell): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString('en-IN')
      : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** Minimal inline markdown: **bold** and `code`. */
function Inline({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<strong key={k++} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else nodes.push(<code key={k++} className="font-mono text-[0.8em] bg-surface-2 px-1 rounded">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

function TextPart({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-•]\s+/.test(line);
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className={bullet ? 'pl-4 relative before:content-["–"] before:absolute before:left-0 before:text-faint' : ''}>
            <Inline text={bullet ? line.replace(/^\s*[-•]\s+/, '') : line} />
          </p>
        );
      })}
    </div>
  );
}

/** snake_case SQL aliases → "Doc date". */
const headerLabel = (c: string) => { const t = c.replaceAll('_', ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

function TablePart({ title, columns, rows }: { title: string; columns: string[]; rows: Cell[][] }) {
  if (!columns.length) return <div className="text-xs text-faint italic">No rows.</div>;
  return (
    <div className="border border-line rounded-lg overflow-hidden bg-surface">
      <div className="px-3 py-1.5 text-[0.68rem] font-mono uppercase tracking-wider text-muted border-b border-line bg-surface-2/60">{title}</div>
      <div className="overflow-auto max-h-60 scroll-thin">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-left text-faint border-b border-line">
              {columns.map((c) => (
                <th key={c} className="px-3 py-1.5 font-medium whitespace-nowrap">{headerLabel(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((v, j) => (
                  <td key={j} className={`px-3 py-1.5 whitespace-nowrap ${typeof v === 'number' ? 'text-right tabular-nums font-mono' : ''}`}>
                    {fmtCell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 100 && <div className="px-3 py-1 text-[0.65rem] text-faint border-t border-line">Showing first 100 rows</div>}
    </div>
  );
}

function ChartPart({ spec }: { spec: ChartSpec }) {
  const max = Math.max(...spec.values.map((v) => Math.abs(v)), 1);
  return (
    <div className="border border-line rounded-lg bg-surface p-3">
      <div className="text-[0.68rem] font-mono uppercase tracking-wider text-muted mb-2">{spec.title}</div>
      <div className="space-y-1.5">
        {spec.labels.map((label, i) => {
          const v = spec.values[i] ?? 0;
          return (
            <div key={i} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs">
              <div className="truncate text-muted" title={label}>{label}</div>
              <div className="h-4 bg-surface-2 rounded-sm overflow-hidden">
                <div className="h-full bg-accent/80 rounded-sm" style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%` }} />
              </div>
              <div className="tabular-nums font-mono text-ink">{fmtCell(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Action confirmation card ────────────────────────────────────────────────

const PHASE_CHIP: Record<ActionPhase, { label: string; cls: string }> = {
  pending: { label: 'Needs your OK', cls: 'bg-accent-soft text-accent' },
  executing: { label: 'Saving…', cls: 'bg-accent-soft text-accent animate-pulse' },
  executed: { label: '✓ Saved', cls: 'bg-[#e4f1ea] text-ok' },
  cancelled: { label: 'Not saved', cls: 'bg-surface-2 text-muted' },
  failed: { label: 'Couldn’t save', cls: 'bg-[#f6e5e1] text-crit' },
};

// Totals the document preview already shows in its footer — don't repeat them.
const TOTAL_LABELS = new Set(['Subtotal (before GST)', 'IGST', 'CGST + SGST', 'Total', 'Order value (before GST)']);

/** The "Yes" button, worded for what the card does. */
function primaryLabel(kind: string, edited: boolean): string {
  if (edited) return 'Save my changes';
  if (kind.startsWith('delete_')) return 'Yes, delete';
  if (kind === 'record_payment') return 'Yes, record payment';
  if (kind === 'convert_lead_to_customer') return 'Yes, add customer';
  if (kind.startsWith('convert_')) return 'Yes, make it';
  if (kind.startsWith('create_') || kind === 'duplicate_quotation') return 'Yes, create it';
  if (kind.startsWith('update_') || kind.startsWith('set_')) return 'Yes, save changes';
  return 'Yes, save it';
}

const OPEN_LABEL: Record<string, string> = {
  quotation: 'Open quotation', invoice: 'Open bill', order: 'Open order', customer: 'Open customer', lead: 'Open enquiry',
};
/** Icon-only controls keep a 44px hit area on phones even though the glyph is small. */
const HIT = 'min-h-11 min-w-11 inline-flex items-center justify-center';
const AI_OFF = 'The AI assistant is switched off. Ask the person who set up the app to turn it on. Everything else works as normal.';

const columnsOf = (payload?: Record<string, unknown>): EditColumn[] => {
  const cd = payload?.columnDefs;
  if (!Array.isArray(cd)) return [];
  // Keep each field's display choice — the preview needs it to decide what is a
  // column and what prints under the item.
  return cd.map((raw) => {
    const c = raw as EditColumn;
    const display = c.display === 'column' || c.display === 'spec' ? c.display : undefined;
    return { id: String(c.id), label: String(c.label), ...(display ? { display } : {}) };
  });
};

/** Select options on the card read as labels, never stored keys. */
function optionLabel(fieldKey: string, value: string): string {
  if (fieldKey === 'stage') return LEAD_STAGE_LABELS[value as keyof typeof LEAD_STAGE_LABELS] ?? value;
  if (fieldKey === 'method') return PAYMENT_METHOD_LABELS[value as keyof typeof PAYMENT_METHOD_LABELS] ?? value;
  if (fieldKey === 'orderCategory') return ORDER_CATEGORY_LABELS[value as keyof typeof ORDER_CATEGORY_LABELS] ?? value;
  if (fieldKey === 'materialOwnership') return MATERIAL_OWNERSHIP_LABELS[value as keyof typeof MATERIAL_OWNERSHIP_LABELS] ?? value;
  if (fieldKey === 'regType') return value === 'registered' ? 'Registered' : 'Not registered';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ActionCard({
  part, busy, onDecide, onOpen, onReview,
}: {
  part: ActionPart;
  busy: boolean;
  onDecide: (actionId: string, decision: 'confirm' | 'cancel', edited?: Record<string, unknown>) => void;
  onOpen: (path: string) => void;
  onReview: (actionId: string) => void;
}) {
  const a = part.action;
  const chip = PHASE_CHIP[part.phase];
  const isDelete = a.kind.startsWith('delete_');
  const border =
    part.phase === 'executed' ? 'border-ok/40' :
    part.phase === 'failed' ? 'border-crit/40' :
    part.phase === 'cancelled' ? 'border-line' : 'border-accent/50';
  const pending = part.phase === 'pending';
  // Documents (quotation / invoice / order proposals) open the full editor;
  // simple records (customer, lead, payment) edit their fields inline.
  const isDoc = !!a.doc && Array.isArray(a.editItems);
  const canEdit = pending && !!a.editable?.length;

  const initialForm = () => {
    const f: Record<string, string> = {};
    for (const fld of a.editable ?? []) f[fld.key] = a.payload?.[fld.key] == null ? '' : String(a.payload[fld.key]);
    return f;
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(initialForm);
  const discard = () => { setForm(initialForm()); setEditing(false); };
  const submit = () => {
    if (!editing) { onDecide(a.actionId, 'confirm'); return; }
    onDecide(a.actionId, 'confirm', { ...(a.payload ?? {}), ...form });
  };

  const details = isDoc ? a.details.filter((d) => !TOTAL_LABELS.has(d.label)) : a.details;
  const showPreview = !editing || !pending;

  return (
    <div className={`border ${border} rounded-xl bg-surface overflow-hidden shadow-sm`}>
      <div className="px-3.5 py-2.5 flex items-center gap-2 border-b border-line bg-accent-soft/25">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="text-sm font-medium flex-1 min-w-0">{a.title}</span>
        <span className={`pill shrink-0 ${chip.cls}`}>{chip.label}</span>
      </div>

      {/* Read-only preview */}
      {showPreview && (details.length > 0 || a.items?.length || a.changes?.length || a.warning || isDoc) && (
        <div className="px-3.5 py-2.5 space-y-2">
          {details.length > 0 && (
            <dl className="text-xs space-y-1">
              {details.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <dt className="text-faint w-28 shrink-0">{d.label}</dt>
                  <dd className="text-ink min-w-0">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {a.changes && a.changes.length > 0 && <ChangeList changes={a.changes} />}
          {isDoc ? (
            <DocPreview lines={a.editItems!} columns={columnsOf(a.payload)} doc={a.doc!} />
          ) : a.items && a.items.length > 0 ? (
            <div className="border border-line rounded-lg bg-surface-2/50 px-3 py-2 text-xs space-y-1">
              {a.items.map((line, i) => <div key={i} className="text-ink">{line}</div>)}
            </div>
          ) : null}
          {a.warning && part.phase !== 'executed' && (
            <div className="text-xs text-crit flex gap-1.5"><span aria-hidden>⚠</span><span>{a.warning}</span></div>
          )}
        </div>
      )}

      {/* Inline edit for simple records */}
      {editing && pending && !isDoc && (
        <div className="px-3.5 py-2.5 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            {(a.editable ?? []).map((fld) => (
              <label key={fld.key} className={`text-xs ${fld.type === 'textarea' ? 'col-span-2' : ''}`}>
                <span className="text-muted">{fld.label}</span>
                {fld.type === 'textarea' ? (
                  <textarea value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))} rows={2} className="field sm:!py-1 mt-0.5" />
                ) : fld.type === 'select' ? (
                  <select value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))} className="field sm:!py-1 mt-0.5">
                    {(fld.options ?? []).map((o) => <option key={o} value={o}>{optionLabel(fld.key, o)}</option>)}
                  </select>
                ) : (
                  <input type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'}
                    value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))}
                    className="field sm:!py-1 mt-0.5" inputMode={fld.type === 'number' ? 'decimal' : undefined} />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <div className="border-t border-line bg-surface-2/40">
          {canEdit && (
            isDoc ? (
              <button onClick={() => onReview(a.actionId)} disabled={busy}
                className="w-full text-left px-3.5 py-2 min-h-11 sm:min-h-0 sm:pt-2 sm:pb-0 text-xs text-steel hover:underline disabled:opacity-50">
                ✎ Check or change the lines
              </button>
            ) : (
              <button onClick={() => (editing ? discard() : setEditing(true))} disabled={busy}
                className="w-full text-left px-3.5 py-2 min-h-11 sm:min-h-0 sm:pt-2 sm:pb-0 text-xs text-steel hover:underline disabled:opacity-50">
                {editing ? '↩ Undo my changes' : '✎ Change details'}
              </button>
            )
          )}
          <div className="flex gap-2 px-3.5 py-2.5">
            <button onClick={submit} disabled={busy}
              className={`btn-primary flex-1 sm:!py-1.5 sm:text-xs disabled:opacity-50 ${isDelete ? '!bg-crit' : ''}`}>
              {primaryLabel(a.kind, editing)}
            </button>
            <button onClick={() => onDecide(a.actionId, 'cancel')} disabled={busy} className="btn-ghost sm:!py-1.5 sm:text-xs disabled:opacity-50">
              Not now
            </button>
          </div>
        </div>
      )}
      {part.phase === 'executed' && part.result && (
        <div className="px-3.5 py-2.5 border-t border-line text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ok flex-1 min-w-[10rem]">{part.result}</span>
          {part.path && (
            <button onClick={() => onOpen(part.path!)} className="text-accent font-medium hover:underline shrink-0 min-h-11 sm:min-h-0">
              {(part.entityType && OPEN_LABEL[part.entityType]) ?? 'Open'} →
            </button>
          )}
          {part.printPath && (
            <a href={part.printPath} target="_blank" rel="noopener noreferrer"
              className="text-accent font-medium hover:underline shrink-0 inline-flex items-center min-h-11 sm:min-h-0">
              PDF ↗
            </a>
          )}
        </div>
      )}
      {part.phase === 'failed' && part.result && (
        <div className="px-3.5 py-2.5 border-t border-line text-xs text-crit" role="alert">{part.result}</div>
      )}
    </div>
  );
}

/** What the model sees of an earlier assistant turn (tables/charts are re-derivable). */
function serializeParts(parts: Part[]): string {
  const chunks = parts.map((p) => {
    if (p.kind === 'text') return p.text;
    if (p.kind === 'action') {
      const outcome =
        p.phase === 'executed' ? `executed — ${p.result ?? 'done'}` :
        p.phase === 'failed' ? `failed — ${p.result ?? ''}` : p.phase;
      return `[proposed action: ${p.action.title} → ${outcome}]`;
    }
    if (p.kind === 'nav') return `[opened ${p.label}]`;
    return '';
  }).filter((s) => s.trim());
  return chunks.join('\n') || '…';
}

// ── The panel ───────────────────────────────────────────────────────────────

export function AssistantPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [open, setOpen] = useState(false);
  // The closed drawer must leave the layout entirely: an off-canvas fixed panel
  // (translate-x-full) still widens document.scrollWidth on some browsers once
  // it holds a wide table, letting every page scroll sideways into blank space.
  // So: mount → next frame slide in; slide out → then display:none.
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setRendered(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setRendered(false), 220);
    return () => clearTimeout(t);
  }, [open]);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [micStop, setMicStop] = useState(0); // bump to force-stop voice dictation
  const dictationBase = useRef(''); // input text captured when voice dictation starts
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]); // staged attachments for the next send
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null); // actionId open in the document editor
  const reviewRef = useRef<string | null>(null);
  reviewRef.current = review;
  const abortRef = useRef<AbortController | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef<Msg[]>(msgs);

  // Single mutation path: the ref is authoritative and updated synchronously,
  // so interleaved async flows (stream patches, action decisions, follow-up
  // sends) never clobber each other's state.
  const updateMsgs = useCallback((fn: (cur: Msg[]) => Msg[]) => {
    msgsRef.current = fn(msgsRef.current);
    setMsgs(msgsRef.current);
  }, []);

  // Restore the thread + layout preference once on mount; persist afterwards.
  useEffect(() => {
    const saved = loadThread();
    if (saved.length) updateMsgs(() => saved);
    try { setWide(window.localStorage.getItem(WIDE_KEY) === '1'); } catch { /* ignore */ }
    setHydrated(true);
  }, [updateMsgs]);
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => saveThread(msgs), 400); // debounced — streaming patches msgs per token
    return () => clearTimeout(t);
  }, [msgs, hydrated]);
  const toggleWide = () => {
    setWide((w) => { try { window.localStorage.setItem(WIDE_KEY, w ? '0' : '1'); } catch { /* ignore */ } return !w; });
  };

  /** Update the action part with this id, wherever it is in the transcript. */
  const patchAction = useCallback((actionId: string, patch: Partial<ActionPart>) => {
    updateMsgs((cur) => cur.map((m) =>
      m.role === 'assistant'
        ? {
            ...m,
            parts: m.parts.map((p) =>
              p.kind === 'action' && p.action.actionId === actionId ? { ...p, ...patch } : p),
          }
        : m,
    ));
  }, [updateMsgs]);

  /** Insert a part right after the card with this id (e.g. the "nothing was saved" note). */
  const appendAfterAction = useCallback((actionId: string, part: Part) => {
    updateMsgs((cur) => cur.map((m) => {
      if (m.role !== 'assistant') return m;
      const idx = m.parts.findIndex((p) => p.kind === 'action' && p.action.actionId === actionId);
      if (idx < 0) return m;
      return { ...m, parts: [...m.parts.slice(0, idx + 1), part, ...m.parts.slice(idx + 1)] };
    }));
  }, [updateMsgs]);

  const navigate = useCallback((path: string, newTab = false) => {
    if (newTab || path.startsWith('/print/')) window.open(path, '_blank', 'noopener');
    else router.push(path);
  }, [router]);

  const send = useCallback(async (question: string, opts?: { hidden?: boolean; attachments?: Attachment[] }) => {
    const atts = opts?.attachments ?? [];
    const q = question.trim() || (atts.length ? 'Please read the attached document and pull out the details.' : '');
    if ((!q && !atts.length) || abortRef.current) return;
    setMicStop((n) => n + 1); // stop any live voice dictation on send
    setInput('');
    setBusy(true);
    setReview(null);

    // A pending card stays on screen while the user asks about it — the server
    // supersedes it only when a NEW proposal is staged (handled on 'action').

    const historyBase = msgsRef.current;
    updateMsgs((cur) => [...cur, {
      role: 'user', text: q, hidden: opts?.hidden,
      files: atts.length ? atts.map((a) => a.name ?? 'file') : undefined,
    }, { role: 'assistant', parts: [] }]);

    // Server sees text turns; tables/charts are re-derived, actions summarized.
    // Attachments ride only on this outgoing turn (transient — never re-sent).
    const turns = [...historyBase.map((m) =>
      m.role === 'user'
        ? { role: 'user' as const, content: m.text }
        : { role: 'assistant' as const, content: serializeParts(m.parts) },
    ), { role: 'user' as const, content: q, ...(atts.length ? { attachments: atts } : {}) }].slice(-20);

    const patch = (fn: (parts: Part[]) => Part[]) =>
      updateMsgs((cur) => {
        const next = [...cur];
        const lastIdx = next.length - 1;
        const last = next[lastIdx];
        if (last?.role === 'assistant') next[lastIdx] = { role: 'assistant', parts: fn(last.parts) };
        return next;
      });
    const settleTools = (parts: Part[]) => parts.map((p) => (p.kind === 'tool' ? { ...p, done: true } : p));

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: turns, context: { path: pathnameRef.current ?? '' } }),
        signal: ac.signal,
      });

      if (res.headers.get('content-type')?.includes('application/json')) {
        const j = await res.json();
        const note = j.disabled ? AI_OFF : (j.error ?? 'Something went wrong on our side — please try again.');
        patch(() => [{ kind: 'text', text: note }]);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type: string } & Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'text') {
            const delta = String(ev.delta ?? '');
            patch((parts) => {
              const last = parts[parts.length - 1];
              if (last?.kind === 'text') return [...parts.slice(0, -1), { kind: 'text', text: last.text + delta }];
              return [...settleTools(parts), { kind: 'text', text: delta }];
            });
          } else if (ev.type === 'tool') {
            patch((parts) => [...settleTools(parts), { kind: 'tool', label: String(ev.label ?? 'Working…'), done: false }]);
          } else if (ev.type === 'table') {
            patch((parts) => [...settleTools(parts), {
              kind: 'table', title: String(ev.title ?? 'Result'),
              columns: (ev.columns as string[]) ?? [], rows: (ev.rows as Cell[][]) ?? [],
            }]);
          } else if (ev.type === 'chart') {
            patch((parts) => [...settleTools(parts), { kind: 'chart', spec: ev.spec as ChartSpec }]);
          } else if (ev.type === 'action') {
            const action = ev.action as ActionInfo;
            // A fresh proposal supersedes older pending cards (server did too).
            updateMsgs((cur) => cur.map((m) =>
              m.role === 'assistant'
                ? { ...m, parts: m.parts.map((p) => (p.kind === 'action' && p.phase === 'pending' ? { ...p, phase: 'cancelled' as const } : p)) }
                : m,
            ));
            patch((parts) => [...settleTools(parts), { kind: 'action', action, phase: 'pending' }]);
          } else if (ev.type === 'nav') {
            const path = String(ev.path ?? '/dashboard');
            const label = String(ev.label ?? 'page');
            const newTab = Boolean(ev.newTab) || path.startsWith('/print/');
            // In-app pages navigate immediately; new-tab/print pages can't auto-open
            // (no user gesture → pop-up-blocked), so we render an explicit link to click.
            if (!newTab) navigate(path, false);
            patch((parts) => [...settleTools(parts), { kind: 'nav', label, path, newTab }]);
          } else if (ev.type === 'error') {
            patch((parts) => [...settleTools(parts), { kind: 'text', text: `⚠ ${String(ev.message ?? 'Error')}` }]);
          } else if (ev.type === 'done') {
            patch(settleTools);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        patch((parts) => [...settleTools(parts), { kind: 'text', text: '⚠ Connection problem — please try again.' }]);
      } else {
        patch((parts) => settleTools(parts));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [navigate, updateMsgs]);

  /** Confirm/cancel a staged action; on confirm, execute + let the model continue. */
  const decide = useCallback(async (actionId: string, decision: 'confirm' | 'cancel', edited?: Record<string, unknown>) => {
    setReview(null);
    patchAction(actionId, { phase: decision === 'confirm' ? 'executing' : 'cancelled' });
    if (decision === 'cancel') {
      // Tell them plainly, right under the card — no server round-trip needed for the words.
      appendAfterAction(actionId, { kind: 'text', text: 'Okay — nothing was saved. Tell me what to change, or ask something else.' });
    }
    try {
      const res = await fetch('/api/assistant/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId, decision, ...(edited ? { edited } : {}) }),
      });
      if (decision === 'cancel') return;
      const j = await res.json() as {
        ok?: boolean; message?: string; error?: string; path?: string; printPath?: string; entity?: { type: string; id: string };
      };
      if (j.ok) {
        patchAction(actionId, { phase: 'executed', result: j.message, path: j.path, printPath: j.printPath, entityType: j.entity?.type });
        router.refresh();
        void send(
          `[app note — not typed by the user] Saved: ${j.message}${j.entity ? ` (${j.entity.type} ${j.entity.id} — internal id, never show it to the user)` : ''}. ` +
          'Acknowledge in one short line; if a further step was agreed, continue with it now.',
          { hidden: true },
        );
      } else {
        patchAction(actionId, { phase: 'failed', result: j.error ?? 'Couldn’t save that — please try again.' });
        void send(`[app note — not typed by the user] Saving FAILED: ${j.error ?? 'unknown error'}. Tell the user in one plain sentence and suggest what to do next.`, { hidden: true });
      }
    } catch {
      if (decision === 'confirm') {
        patchAction(actionId, { phase: 'failed', result: 'Couldn’t reach the server — nothing was saved. Check your connection and tap Yes again.' });
      }
    }
  }, [appendAfterAction, patchAction, router, send]);

  /** Validate + read picked files into base64, enforcing type/size/count caps. */
  const onPickFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setAttachErr(null);
    const next: PendingFile[] = [];
    let err: string | null = null;
    let runningTotal = files.reduce((s, f) => s + f.size, 0);
    for (const file of Array.from(fileList)) {
      if (files.length + next.length >= MAX_FILES) { err = `Up to ${MAX_FILES} files at a time.`; break; }
      if (!ATTACH_MIMES.has(file.type)) { err = `${file.name || 'File'}: unsupported — attach a PDF or image.`; continue; }
      if (file.size > MAX_FILE_BYTES) { err = `${file.name}: too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`; continue; }
      if (runningTotal + file.size > MAX_FILES_TOTAL_BYTES) { err = 'Those attachments are too large together.'; break; }
      try {
        const data = await fileToBase64(file);
        next.push({ name: file.name || 'file', mimeType: file.type, size: file.size, data });
        runningTotal += file.size;
      } catch { err = `${file.name}: could not read the file.`; }
    }
    if (next.length) setFiles((cur) => [...cur, ...next].slice(0, MAX_FILES));
    if (err) setAttachErr(err);
  }, [files]);

  /** Put a template in the box (stripping the "✎ " marker) and let the user finish it. */
  const fillInput = useCallback((text: string) => {
    setInput(text.replace(/^✎\s*/, ''));
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      // Park the caret on the first [blank] so the user can type straight over it.
      const at = el.value.indexOf('[');
      if (at >= 0) el.setSelectionRange(at, el.value.indexOf(']', at) + 1 || at + 1);
    }, 150);
  }, []);

  // Global open events + ⌘K / Ctrl+K + Esc. While the line editor is open it
  // owns Escape (it asks before discarding edits); otherwise Esc closes the panel.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<{ question?: string; fill?: boolean }>).detail;
      setOpen(true);
      if (!d?.question) return;
      if (d.fill) fillInput(d.question);
      else setTimeout(() => send(d.question!), 60);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape' && !reviewRef.current) setOpen(false);
    };
    window.addEventListener('ms-assistant', onEvent);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('ms-assistant', onEvent); window.removeEventListener('keydown', onKey); };
  }, [fillInput, send]);

  // Focus moves into the drawer on open and back to whatever opened it on close.
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus();
  }, [open]);

  // Keep Tab inside the drawer while it is open (the line editor traps its own).
  const onAsideKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !asideRef.current) return;
    const focusables = Array.from(asideRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const stop = () => abortRef.current?.abort();
  const clearThread = () => { stop(); updateMsgs(() => []); setFiles([]); setAttachErr(null); setReview(null); };

  // The action currently open in the full-width editor (must still be pending).
  const reviewPart = review
    ? msgs.flatMap((m) => (m.role === 'assistant' ? m.parts : []))
        .find((p): p is ActionPart => p.kind === 'action' && p.action.actionId === review && p.phase === 'pending')
    : undefined;

  return (
    <>
      {open && <div className="fixed inset-0 bg-ink/25 z-40" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        ref={asideRef}
        onKeyDown={onAsideKeyDown}
        className={`fixed top-0 right-0 h-full w-full ${wide ? 'sm:w-[min(880px,100vw)]' : 'sm:w-[440px]'} bg-bg border-l border-line z-50 ${rendered ? 'flex' : 'hidden'} flex-col shadow-2xl
          transition-[transform,width] duration-200 ${shown ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="Ask AI"
        aria-hidden={!open}
        inert={!open || undefined}
      >
        <header className="flex items-center gap-2.5 px-4 min-h-[52px] border-b border-line bg-surface shrink-0">
          <span className="text-accent" aria-hidden>✦</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight flex items-center gap-2">Ask AI <ShortcutKbd /></div>
            <div className="text-xs text-muted leading-tight">Questions or work · English / हिन्दी</div>
          </div>
          {msgs.length > 0 && (
            <button onClick={clearThread} className="text-xs text-steel hover:underline min-h-11 px-1" disabled={busy}>
              New chat
            </button>
          )}
          <button onClick={toggleWide} className={`hidden sm:inline-flex ${HIT} text-muted hover:text-ink`}
            aria-label={wide ? 'Make the panel narrower' : 'Make the panel wider'} title={wide ? 'Make the panel narrower' : 'Make the panel wider'}>
            {wide ? '⇥' : '⇤'}
          </button>
          <button onClick={() => setOpen(false)} className={`${HIT} text-muted hover:text-ink -mr-2`} aria-label="Close Ask AI" title="Close">✕</button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4" aria-live="polite">
          {msgs.length === 0 && (
            <div className="pt-6">
              {!enabled && (
                <div className="card p-4 mb-4 text-sm">
                  <div className="font-medium text-ink mb-1">AI assistant is off</div>
                  <p className="text-muted">{AI_OFF}</p>
                </div>
              )}
              <p className="text-xs text-muted mb-2">Try asking — or tap a ✎ example and fill in the blanks</p>
              <div className="flex flex-col gap-1.5">
                {suggestionsFor(pathname).map((s) => (
                  <button
                    key={s.text}
                    onClick={() => (s.fill ? fillInput(s.text) : send(s.text))}
                    disabled={busy || !enabled}
                    className="text-left text-sm px-3 py-2.5 min-h-11 rounded-lg border border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40 transition-colors disabled:opacity-50"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
              <div className="mt-4 text-xs text-muted leading-relaxed space-y-1">
                <div>• Make a quotation, bill or order — type it, or attach a photo of a PO / price list.</div>
                <div>• Change a document: ‘line 3 ka rate 32,000 karo’.</div>
                <div>• Nothing is saved until you tap <b className="text-ink">Yes</b> on the card.</div>
              </div>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === 'user' ? (
              m.hidden ? null : (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] space-y-1">
                    {m.files && m.files.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {m.files.map((n, k) => (
                          <span key={k} className="inline-flex items-center gap-1 text-[0.7rem] text-accent bg-accent-soft/60 border border-accent/30 rounded-full px-2 py-0.5">
                            <span aria-hidden>📎</span>
                            <span className="truncate max-w-[9rem]" title={n}>{n}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="bg-accent text-white text-sm px-3.5 py-2 rounded-2xl rounded-br-sm whitespace-pre-wrap">{m.text}</div>
                  </div>
                </div>
              )
            ) : (
              <div key={i} className="space-y-2">
                {m.parts.map((p, j) => {
                  if (p.kind === 'text') return <TextPart key={j} text={p.text} />;
                  if (p.kind === 'tool') {
                    return (
                      <div key={j} className="inline-flex items-center gap-2 text-xs text-muted bg-surface border border-line rounded-full px-3 py-1">
                        <span className={p.done ? 'text-ok' : 'animate-pulse text-accent'}>{p.done ? '✓' : '◌'}</span>
                        {p.label}
                      </div>
                    );
                  }
                  if (p.kind === 'table') return <TablePart key={j} title={p.title} columns={p.columns} rows={p.rows} />;
                  if (p.kind === 'chart') return <ChartPart key={j} spec={p.spec} />;
                  if (p.kind === 'action') {
                    return (
                      <ActionCard key={p.action.actionId} part={p} busy={busy} onDecide={decide}
                        onOpen={(path) => navigate(path)} onReview={(id) => setReview(id)} />
                    );
                  }
                  return p.newTab ? (
                    <a key={j} href={p.path} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-medium text-accent bg-accent-soft/50 border border-accent/40 rounded-full px-3 py-1 hover:bg-accent-soft transition-colors">
                      <span aria-hidden>↗</span> Open {p.label}
                    </a>
                  ) : (
                    <button key={j} onClick={() => navigate(p.path)}
                      className="inline-flex items-center gap-2 text-xs text-muted bg-surface border border-line rounded-full px-3 py-1 hover:border-accent/50 hover:text-accent transition-colors">
                      <span aria-hidden>↗</span> Opened {p.label}
                    </button>
                  );
                })}
                {i === msgs.length - 1 && busy && m.parts.length === 0 && (
                  <div className="text-sm text-faint animate-pulse">Thinking…</div>
                )}
              </div>
            ),
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const atts: Attachment[] = files.map(({ name, mimeType, data }) => ({ name, mimeType, data }));
            send(input, atts.length ? { attachments: atts } : undefined);
            setFiles([]); setAttachErr(null);
          }}
          className="p-3 border-t border-line bg-surface shrink-0"
        >
          {(files.length > 0 || attachErr) && (
            <div className="mb-2 space-y-1.5">
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 max-w-[12rem] text-xs bg-surface-2 border border-line rounded-full pl-2 pr-1 py-1">
                      <span aria-hidden>{isImageMime(f.mimeType) ? '🖼' : '📄'}</span>
                      <span className="truncate text-muted" title={f.name}>{f.name}</span>
                      <button type="button" onClick={() => setFiles((cur) => cur.filter((_, x) => x !== i))} aria-label={`Remove ${f.name}`}
                        className={`${HIT} -my-2 text-muted hover:text-crit`}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {attachErr && <div className="text-xs text-crit" role="alert">{attachErr}</div>}
            </div>
          )}
          <div className="flex gap-2">
            {enabled && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ''; }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || files.length >= MAX_FILES}
                  className={`btn-ghost shrink-0 !px-3 ${HIT} disabled:opacity-50`}
                  aria-label="Attach a photo or PDF"
                  title="Attach a photo or PDF (PO, visiting card, price list)"
                >
                  📎
                </button>
              </>
            )}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={enabled ? 'Ask a question, or tell me what to do…' : 'The AI assistant is switched off'}
              disabled={!enabled || busy}
              className="field flex-1"
              aria-label="Ask a question, or tell me what to do"
            />
            {enabled && (
              <MicButton
                disabled={busy}
                stopSignal={micStop}
                onStart={() => { dictationBase.current = input.trim(); }}
                onInterim={(t) => setInput((dictationBase.current ? dictationBase.current + ' ' : '') + t)}
                onText={(t) => { const n = (dictationBase.current ? dictationBase.current + ' ' : '') + t; setInput(n); dictationBase.current = n; }}
              />
            )}
            {busy ? (
              <button type="button" onClick={stop} className="btn-ghost shrink-0" aria-label="Stop">■ Stop</button>
            ) : (
              <button type="submit" disabled={!enabled || (!input.trim() && files.length === 0)} className="btn-primary shrink-0 disabled:opacity-50">Send</button>
            )}
          </div>
          {enabled && msgs.length === 0 && (
            <div className="mt-2 text-xs text-muted">📎 Photo of a PO / visiting card · 🎤 Speak in हिन्दी or English</div>
          )}
        </form>
      </aside>

      {reviewPart && reviewPart.action.doc && reviewPart.action.editItems && (
        <DocumentReviewModal
          key={reviewPart.action.actionId}
          title={reviewPart.action.title}
          doc={reviewPart.action.doc}
          fields={reviewPart.action.editable ?? []}
          payload={reviewPart.action.payload ?? {}}
          items={reviewPart.action.editItems}
          warning={reviewPart.action.warning}
          busy={busy}
          onConfirm={(edited) => decide(reviewPart.action.actionId, 'confirm', edited)}
          onClose={() => setReview(null)}
        />
      )}
    </>
  );
}
