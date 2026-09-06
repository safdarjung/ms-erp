'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { formatINR, stateLabel, type GstTotals } from '@ms/core';
import { SubmitButton } from './submit-button';
import { focusIssue, type ItemIssue } from './line-items-editor';

// Small UI pieces shared by the quotation / bill / order forms so all three
// say the same thing the same way (totals wording, draft banner, error boxes,
// sticky Save bar on phones).

export type DocWord = 'quotation' | 'bill' | 'order';

/** "06 — Haryana" → "Haryana" (falls back to the code, or '' when unknown). */
export const stateName = (code: string | null | undefined) => stateLabel(code).replace(/^\d{2} — /, '');

export function timeAgo(ts: number | null): string {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

type Cust = { id: string; name: string; stateCode: string | null };

export function CustomerSelect({ customers, value, onChange, returnTo }: {
  customers: Cust[]; value: string; onChange: (id: string) => void; returnTo: string;
}) {
  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="customerId" className="label">Customer *</label>
        <Link href={`/customers?new=1&return=${encodeURIComponent(returnTo)}`} className="text-xs text-accent hover:underline mb-1 whitespace-nowrap">+ New customer</Link>
      </div>
      <select id="customerId" name="customerId" required value={value} onChange={(e) => onChange(e.target.value)} className="field">
        <option value="">Choose a customer…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.stateCode ? ` — ${stateName(c.stateCode) || c.stateCode}` : ''}</option>
        ))}
      </select>
    </div>
  );
}

export function DraftBanner({ doc, customerName, savedAt, mismatch, onContinue, onFresh }: {
  doc: DocWord; customerName?: string | null; savedAt: number | null; mismatch: boolean;
  onContinue: () => void; onFresh: () => void;
}) {
  const when = timeAgo(savedAt);
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3 text-sm">
      <span aria-hidden>💾</span>
      <span className="flex-1 min-w-0">
        Unfinished {doc}{customerName ? <> for <b>{customerName}</b></> : ''}{when ? ` (${when})` : ''} — continue it?
        {mismatch && customerName && <span className="block text-xs text-muted mt-0.5">It was for {customerName}, not the customer you opened this page for.</span>}
      </span>
      <span className="flex gap-2">
        <button type="button" onClick={onContinue} className="btn-primary text-xs">Continue</button>
        <button type="button" onClick={onFresh} className="btn-ghost text-xs">Start fresh</button>
      </span>
    </div>
  );
}

export function TotalsCard({ totals, gstRates, interstate, hasCustomer, supplierStateCode, estimate = false, className = '' }: {
  totals: GstTotals; gstRates: number[]; interstate: boolean; hasCustomer: boolean;
  supplierStateCode: string; estimate?: boolean; className?: string;
}) {
  const rates = new Set(gstRates);
  const one = rates.size === 1 ? [...rates][0]! : null;
  const sup = stateName(supplierStateCode) || 'Haryana';
  const note = hasCustomer
    ? (interstate ? `Customer outside ${sup} → IGST` : `Customer in ${sup} → CGST + SGST`)
    : 'Choose a customer to see GST';
  const mono = 'tabular-nums font-mono';
  return (
    <div className={`card p-4 w-full md:w-72 text-sm self-start ${className}`}>
      <div className="flex justify-between py-1"><span className="text-muted">Subtotal (before GST)</span><span className={mono}>{formatINR(totals.subtotal)}</span></div>
      <div className="flex justify-between pt-1"><span className="text-muted">GST{one !== null ? ` ${one}%` : ''}</span><span className={mono}>{formatINR(totals.taxTotal)}</span></div>
      <div className="text-xs text-muted text-right pb-1">
        {interstate ? `IGST ${formatINR(totals.igst)}` : `CGST ${formatINR(totals.cgst)} + SGST ${formatINR(totals.sgst)}`}
      </div>
      <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold"><span>Total</span><span className={mono}>{formatINR(totals.grand)}</span></div>
      <div className="text-xs text-muted mt-1">{note}{estimate ? ' · final GST is on the bill' : ''}</div>
    </div>
  );
}

export function IssuesBox({ issues }: { issues: ItemIssue[] }) {
  if (!issues.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-crit/40 bg-[#f6e5e1]/40 px-4 py-2.5 text-sm">
      <div className="font-medium text-crit mb-1">Please fix {issues.length === 1 ? 'this' : 'these'} before saving:</div>
      <ul className="list-disc pl-5 text-crit/90 space-y-0.5">
        {issues.map((iss, i) => (
          <li key={i}><button type="button" className="text-left hover:underline" onClick={() => focusIssue(iss)}>{iss.message}</button></li>
        ))}
      </ul>
    </div>
  );
}

export function WarningsBox({ warnings, acknowledged }: { warnings: ItemIssue[]; acknowledged: boolean }) {
  if (!warnings.length) return null;
  return (
    <div role="status" className="rounded-lg border border-warn/40 bg-[#f6efd9]/50 px-4 py-2.5 text-sm">
      <div className="font-medium text-warn mb-1">Please check — you can still save:</div>
      <ul className="list-disc pl-5 text-ink/80 space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i}><button type="button" className="text-left hover:underline" onClick={() => focusIssue({ ...w, field: 'description' })}>{w.message}</button></li>
        ))}
      </ul>
      {acknowledged && <div className="text-xs text-muted mt-1">If these are right, tap <b>Save anyway</b>.</div>}
    </div>
  );
}

export function ServerError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-crit/50 bg-[#f6e5e1]/60 px-4 py-2.5 text-sm text-crit">
      <b>Couldn&apos;t save:</b> {message} <span className="text-crit/70">— your entries are still here; fix and try again.</span>
    </div>
  );
}

/** Terms tucked into a <details>; opens itself when they differ from the standard ones. */
export function TermsField({ value, defaultTerms, onChange, children }: {
  value: string; defaultTerms: string; onChange: (v: string) => void; children?: ReactNode;
}) {
  const isStandard = value.trim() === defaultTerms.trim();
  const lines = value.split('\n').filter((l) => l.trim()).length;
  const [open, setOpen] = useState(!isStandard);
  useEffect(() => { if (!isStandard) setOpen(true); }, [isStandard]);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="reveal">
      <summary className="text-sm cursor-pointer min-h-11 flex items-center gap-2 text-ink">
        <span className="chev" aria-hidden>▸</span>
        <span>Terms &amp; conditions — {isStandard ? 'standard' : 'customised'} ({lines} {lines === 1 ? 'line' : 'lines'})</span>
        <span className="text-xs text-steel">· Edit</span>
      </summary>
      <label htmlFor="terms" className="sr-only-text">Terms &amp; conditions</label>
      <textarea id="terms" name="terms" rows={6} value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1" />
      {children}
    </details>
  );
}

/** Save button: inline on desktop, a sticky bottom bar with the total on phones. */
export function SaveBar({ total, label, hint }: { total: number; label: string; hint?: string }) {
  return (
    <>
      <div className="hidden md:flex items-center gap-3">
        <SubmitButton className="btn-primary" pendingLabel="Saving…">{label}</SubmitButton>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {/* The app has a fixed bottom nav (h-14, z-30) on phones — sit above it, not behind. */}
      <div className="md:hidden sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 sm:-mx-6 bg-surface border-t border-line px-4 py-3 flex items-center gap-3 z-40 shadow-[0_-2px_8px_rgba(20,30,40,0.06)]">
        <div className="min-w-0">
          <div className="text-xs text-muted">Total</div>
          <div className="font-mono font-semibold tabular-nums">{formatINR(total)}</div>
        </div>
        <SubmitButton className="btn-primary ml-auto" pendingLabel="Saving…">{label}</SubmitButton>
      </div>
    </>
  );
}
