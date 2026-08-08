'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MicButton } from './mic-button';

// ── Types mirrored from the NDJSON protocol of /api/assistant ───────────────

type ChartSpec = { title: string; kind: 'bar'; labels: string[]; values: number[] };
type Cell = string | number | boolean | null;
type EditField = { key: string; label: string; type: 'text' | 'number' | 'date' | 'textarea' | 'select'; options?: string[] };
type EditItem = { description: string; hsn?: string; qty: number; uom?: string; rate: number; gstRate: number; isToolingCharge?: boolean };
type ActionInfo = {
  actionId: string;
  kind: string;
  title: string;
  details: { label: string; value: string }[];
  items?: string[];
  warning?: string;
  editable?: EditField[];
  payload?: Record<string, unknown>;
  editItems?: EditItem[];
};
type ActionPhase = 'pending' | 'executing' | 'executed' | 'cancelled' | 'failed';
type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; label: string; done: boolean }
  | { kind: 'table'; title: string; columns: string[]; rows: Cell[][] }
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'action'; action: ActionInfo; phase: ActionPhase; result?: string; path?: string }
  | { kind: 'nav'; label: string; path: string; newTab?: boolean };
type Msg =
  | { role: 'user'; text: string; hidden?: boolean }
  | { role: 'assistant'; parts: Part[] };

const SUGGESTIONS = [
  'Top 5 customers by invoiced value',
  'Record a lead: Bharat Pumps — VMC job work enquiry, approx ₹1.2L',
  'Sharma Auto ke liye pichhle rate pe ek quotation banao',
  'Mark the latest quotation as sent',
  'इस महीने कितनी बिक्री हुई?',
];

/** Open the assistant from anywhere: window.dispatchEvent(new CustomEvent('ms-assistant', {detail:{question}})) */
export function openAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent('ms-assistant', { detail: { question } }));
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
                <th key={c} className="px-3 py-1.5 font-medium whitespace-nowrap">{c.replaceAll('_', ' ')}</th>
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
  pending: { label: 'Awaiting confirmation', cls: 'bg-accent-soft text-accent' },
  executing: { label: 'Running…', cls: 'bg-accent-soft text-accent animate-pulse' },
  executed: { label: '✓ Done', cls: 'bg-[#e4f1ea] text-ok' },
  cancelled: { label: 'Cancelled', cls: 'bg-surface-2 text-muted' },
  failed: { label: 'Failed', cls: 'bg-[#f6e5e1] text-crit' },
};

type CardRow = { description: string; hsn?: string; qty: string; uom?: string; rate: string; gstRate: string; isToolingCharge?: boolean };

function ActionCard({
  part,
  busy,
  onDecide,
  onOpen,
}: {
  part: Extract<Part, { kind: 'action' }>;
  busy: boolean;
  onDecide: (actionId: string, decision: 'confirm' | 'cancel', edited?: Record<string, unknown>) => void;
  onOpen: (path: string) => void;
}) {
  const a = part.action;
  const chip = PHASE_CHIP[part.phase];
  const border =
    part.phase === 'executed' ? 'border-ok/40' :
    part.phase === 'failed' ? 'border-crit/40' :
    part.phase === 'cancelled' ? 'border-line' : 'border-accent/50';
  const canEdit = part.phase === 'pending' && !!a.editable?.length;

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const fld of a.editable ?? []) f[fld.key] = a.payload?.[fld.key] == null ? '' : String(a.payload[fld.key]);
    return f;
  });
  const [rows, setRows] = useState<CardRow[]>(() =>
    (a.editItems ?? []).map((it) => ({
      description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom,
      rate: String(it.rate), gstRate: String(it.gstRate), isToolingCharge: it.isToolingCharge,
    })),
  );
  const updateRow = (i: number, patch: Partial<CardRow>) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const hasTooling = (a.editItems ?? []).some((it) => it.isToolingCharge !== undefined);

  const discard = () => {
    const f: Record<string, string> = {};
    for (const fld of a.editable ?? []) f[fld.key] = a.payload?.[fld.key] == null ? '' : String(a.payload[fld.key]);
    setForm(f);
    setRows((a.editItems ?? []).map((it) => ({ description: it.description, hsn: it.hsn, qty: String(it.qty), uom: it.uom, rate: String(it.rate), gstRate: String(it.gstRate), isToolingCharge: it.isToolingCharge })));
    setEditing(false);
  };
  const submit = () => {
    if (!editing) { onDecide(a.actionId, 'confirm'); return; }
    const edited: Record<string, unknown> = { ...(a.payload ?? {}), ...form };
    if (a.editItems) {
      edited.items = rows.filter((r) => r.description.trim()).map((r) => ({
        description: r.description, hsn: r.hsn, qty: Number(r.qty) || 0, uom: r.uom,
        rate: Number(r.rate) || 0, gstRate: Number(r.gstRate) || 0,
        ...(hasTooling ? { isToolingCharge: !!r.isToolingCharge } : {}),
      }));
    }
    onDecide(a.actionId, 'confirm', edited);
  };

  return (
    <div className={`border ${border} rounded-xl bg-surface overflow-hidden shadow-sm`}>
      <div className="px-3.5 py-2.5 flex items-center gap-2 border-b border-line bg-accent-soft/25">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="text-sm font-medium flex-1 min-w-0">{a.title}</span>
        <span className={`pill shrink-0 ${chip.cls}`}>{chip.label}</span>
      </div>

      {/* Read-only preview */}
      {(!editing || part.phase !== 'pending') && (a.details.length > 0 || a.items?.length || a.warning) && (
        <div className="px-3.5 py-2.5 space-y-2">
          {a.details.length > 0 && (
            <dl className="text-xs space-y-1">
              {a.details.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <dt className="text-faint w-28 shrink-0">{d.label}</dt>
                  <dd className="text-ink min-w-0">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {a.items && a.items.length > 0 && (
            <div className="border border-line rounded-lg bg-surface-2/50 px-3 py-2 text-xs space-y-1">
              {a.items.map((line, i) => <div key={i} className="text-ink">{line}</div>)}
            </div>
          )}
          {a.warning && part.phase !== 'executed' && (
            <div className="text-xs text-crit flex gap-1.5"><span aria-hidden>⚠</span><span>{a.warning}</span></div>
          )}
        </div>
      )}

      {/* Edit mode */}
      {editing && part.phase === 'pending' && (
        <div className="px-3.5 py-2.5 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            {(a.editable ?? []).map((fld) => (
              <label key={fld.key} className={`text-xs ${fld.type === 'textarea' ? 'col-span-2' : ''}`}>
                <span className="text-faint">{fld.label}</span>
                {fld.type === 'textarea' ? (
                  <textarea value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))} rows={2} className="field !py-1 mt-0.5" />
                ) : fld.type === 'select' ? (
                  <select value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))} className="field !py-1 mt-0.5 capitalize">
                    {(fld.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                  </select>
                ) : (
                  <input type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'}
                    value={form[fld.key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [fld.key]: e.target.value }))}
                    className="field !py-1 mt-0.5" inputMode={fld.type === 'number' ? 'decimal' : undefined} />
                )}
              </label>
            ))}
          </div>
          {a.editItems && (
            <div className="space-y-2">
              <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint">Line items</div>
              {rows.map((r, i) => (
                <div key={i} className="border border-line rounded-lg p-2 space-y-1.5 bg-surface-2/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.6rem] font-mono uppercase text-faint">Line {i + 1}</span>
                    <button type="button" onClick={() => setRows((rs) => rs.filter((_, x) => x !== i))} className="text-crit text-[0.7rem]">Remove</button>
                  </div>
                  <input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} className="field !py-1 text-xs" placeholder="Description" />
                  <div className="grid grid-cols-3 gap-1.5">
                    <input value={r.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} className="field !py-1 text-xs" inputMode="decimal" placeholder="Qty" aria-label="Qty" />
                    <input value={r.rate} onChange={(e) => updateRow(i, { rate: e.target.value })} className="field !py-1 text-xs" inputMode="decimal" placeholder="Rate" aria-label="Rate" />
                    <input value={r.gstRate} onChange={(e) => updateRow(i, { gstRate: e.target.value })} className="field !py-1 text-xs" inputMode="decimal" placeholder="GST%" aria-label="GST %" />
                  </div>
                  {hasTooling && (
                    <label className="flex items-center gap-1.5 text-[0.7rem] text-muted"><input type="checkbox" checked={!!r.isToolingCharge} onChange={(e) => updateRow(i, { isToolingCharge: e.target.checked })} /> Tooling / NRE</label>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setRows((rs) => [...rs, { description: '', hsn: '84807100', qty: '1', uom: 'NOS', rate: '', gstRate: '18', ...(hasTooling ? { isToolingCharge: false } : {}) }])} className="text-xs text-accent">+ Add line</button>
            </div>
          )}
          <p className="text-[0.7rem] text-faint">Totals &amp; GST are recomputed after you save.</p>
        </div>
      )}

      {part.phase === 'pending' && (
        <div className="border-t border-line bg-surface-2/40">
          {canEdit && (
            <button onClick={() => (editing ? discard() : setEditing(true))} disabled={busy}
              className="w-full text-left px-3.5 pt-2 text-xs text-steel hover:underline disabled:opacity-50">
              {editing ? '↩ Discard edits' : '✎ Edit before confirming'}
            </button>
          )}
          <div className="flex gap-2 px-3.5 py-2.5">
            <button onClick={submit} disabled={busy} className="btn-primary !py-1.5 text-xs flex-1 disabled:opacity-50">
              {editing ? 'Save & run' : 'Confirm & run'}
            </button>
            <button onClick={() => onDecide(a.actionId, 'cancel')} disabled={busy} className="btn-ghost !py-1.5 text-xs disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}
      {part.phase === 'executed' && part.result && (
        <div className="px-3.5 py-2.5 border-t border-line text-xs flex items-center gap-2">
          <span className="text-ok flex-1">{part.result}</span>
          {part.path && (
            <button onClick={() => onOpen(part.path!)} className="text-accent font-medium hover:underline shrink-0">
              Open →
            </button>
          )}
        </div>
      )}
      {part.phase === 'failed' && part.result && (
        <div className="px-3.5 py-2.5 border-t border-line text-xs text-crit">{part.result}</div>
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [micStop, setMicStop] = useState(0); // bump to force-stop voice dictation
  const dictationBase = useRef(''); // input text captured when voice dictation starts
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef<Msg[]>(msgs);

  // Single mutation path: the ref is authoritative and updated synchronously,
  // so interleaved async flows (stream patches, action decisions, follow-up
  // sends) never clobber each other's state.
  const updateMsgs = useCallback((fn: (cur: Msg[]) => Msg[]) => {
    msgsRef.current = fn(msgsRef.current);
    setMsgs(msgsRef.current);
  }, []);

  /** Update the action part with this id, wherever it is in the transcript. */
  const patchAction = useCallback((actionId: string, patch: Partial<Extract<Part, { kind: 'action' }>>) => {
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

  const navigate = useCallback((path: string, newTab = false) => {
    if (newTab || path.startsWith('/print/')) window.open(path, '_blank', 'noopener');
    else router.push(path);
  }, [router]);

  const send = useCallback(async (question: string, opts?: { hidden?: boolean }) => {
    const q = question.trim();
    if (!q || abortRef.current) return;
    setMicStop((n) => n + 1); // stop any live voice dictation on send
    setInput('');
    setBusy(true);

    // A new message supersedes any proposal still on the table.
    for (const m of msgsRef.current) {
      if (m.role !== 'assistant') continue;
      for (const p of m.parts) {
        if (p.kind === 'action' && p.phase === 'pending') {
          patchAction(p.action.actionId, { phase: 'cancelled' });
          fetch('/api/assistant/action', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ actionId: p.action.actionId, decision: 'cancel' }),
          }).catch(() => {});
        }
      }
    }

    const historyBase = msgsRef.current;
    updateMsgs((cur) => [...cur, { role: 'user', text: q, hidden: opts?.hidden }, { role: 'assistant', parts: [] }]);

    // Server sees text turns; tables/charts are re-derived, actions summarized.
    const turns = [...historyBase.map((m) =>
      m.role === 'user'
        ? { role: 'user' as const, content: m.text }
        : { role: 'assistant' as const, content: serializeParts(m.parts) },
    ), { role: 'user' as const, content: q }].slice(-20);

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
        body: JSON.stringify({ messages: turns }),
        signal: ac.signal,
      });

      if (res.headers.get('content-type')?.includes('application/json')) {
        const j = await res.json();
        const note = j.disabled
          ? 'AI is not configured yet. Add ANTHROPIC_API_KEY or GEMINI_API_KEY to the server environment and restart to enable the assistant.'
          : (j.error ?? 'Something went wrong.');
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
  }, [navigate, patchAction, updateMsgs]);

  /** Confirm/cancel a staged action; on confirm, execute + let the model continue. */
  const decide = useCallback(async (actionId: string, decision: 'confirm' | 'cancel', edited?: Record<string, unknown>) => {
    patchAction(actionId, { phase: decision === 'confirm' ? 'executing' : 'cancelled' });
    try {
      const res = await fetch('/api/assistant/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId, decision, ...(edited ? { edited } : {}) }),
      });
      if (decision === 'cancel') return;
      const j = await res.json() as { ok?: boolean; message?: string; error?: string; path?: string; entity?: { type: string; id: string } };
      if (j.ok) {
        patchAction(actionId, { phase: 'executed', result: j.message, path: j.path });
        router.refresh();
        void send(
          `[app note — not typed by the user] Confirmed and executed: ${j.message}${j.entity ? ` (${j.entity.type} id: ${j.entity.id})` : ''}. ` +
          'Acknowledge in one short line; if a further step was agreed, continue with it now.',
          { hidden: true },
        );
      } else {
        patchAction(actionId, { phase: 'failed', result: j.error ?? 'The action failed.' });
        void send(`[app note — not typed by the user] The confirmed action FAILED: ${j.error ?? 'unknown error'}. Tell the user briefly and suggest what to do.`, { hidden: true });
      }
    } catch {
      if (decision === 'confirm') {
        patchAction(actionId, { phase: 'failed', result: 'Network problem — the action did not run. Try again.' });
      }
    }
  }, [patchAction, router, send]);

  // Global open events + ⌘K / Ctrl+K + Esc
  useEffect(() => {
    const onEvent = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q) setTimeout(() => send(q), 60);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('ms-assistant', onEvent);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('ms-assistant', onEvent); window.removeEventListener('keydown', onKey); };
  }, [send]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const stop = () => abortRef.current?.abort();

  return (
    <>
      {open && <div className="fixed inset-0 bg-ink/25 z-40" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={`fixed top-0 right-0 h-full w-full sm:w-[440px] bg-bg border-l border-line z-50 flex flex-col shadow-2xl
          transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-label="AI assistant"
        aria-hidden={!open}
      >
        <header className="flex items-center gap-2.5 px-4 h-[52px] border-b border-line bg-surface shrink-0">
          <span className="text-accent" aria-hidden>✦</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight">Assistant</div>
            <div className="text-[0.65rem] text-faint leading-tight">Ask &amp; act on your ERP · English / हिन्दी</div>
          </div>
          {msgs.length > 0 && (
            <button onClick={() => { stop(); updateMsgs(() => []); }} className="text-xs text-steel hover:underline" disabled={busy}>
              Clear
            </button>
          )}
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink px-1" aria-label="Close assistant">✕</button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4">
          {msgs.length === 0 && (
            <div className="pt-6">
              {!enabled && (
                <div className="card p-4 mb-4 text-sm">
                  <div className="font-medium text-ink mb-1">AI is not configured</div>
                  <p className="text-muted">
                    Set <code className="font-mono text-xs bg-surface-2 px-1 rounded">ANTHROPIC_API_KEY</code> or{' '}
                    <code className="font-mono text-xs bg-surface-2 px-1 rounded">GEMINI_API_KEY</code> in the
                    server environment and restart the app. Everything else in the ERP works without it.
                  </p>
                </div>
              )}
              <p className="eyebrow mb-2">Try asking</p>
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy || !enabled}
                    className="text-left text-sm px-3 py-2 rounded-lg border border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40 transition-colors disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[0.68rem] text-faint mt-4 leading-relaxed">
                The assistant reads your live ERP data and can create leads, customers, quotations and invoices,
                move statuses and open screens — every change is shown to you first and runs only after you confirm.
                It can make mistakes; review before confirming.
              </p>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === 'user' ? (
              m.hidden ? null : (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-accent text-white text-sm px-3.5 py-2 rounded-2xl rounded-br-sm whitespace-pre-wrap">{m.text}</div>
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
                  if (p.kind === 'action') return <ActionCard key={j} part={p} busy={busy} onDecide={decide} onOpen={(path) => navigate(path)} />;
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
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="p-3 border-t border-line bg-surface shrink-0"
        >
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={enabled ? 'Ask, or tell me what to do…' : 'AI not configured'}
              disabled={!enabled || busy}
              className="field flex-1"
              aria-label="Ask the assistant"
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
              <button type="submit" disabled={!enabled || !input.trim()} className="btn-primary shrink-0 disabled:opacity-50">Ask</button>
            )}
          </div>
        </form>
      </aside>
    </>
  );
}
