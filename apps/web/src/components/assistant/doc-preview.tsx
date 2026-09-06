'use client';
import { Fragment } from 'react';
import { computeGst, formatINR, formatSpecs, groupRuns, itemSpecs, splitColumns } from '@ms/core';

// Compact, read-only rendering of a proposed document for the assistant's
// confirmation card: lines grouped under their part (heading + note + subtotal),
// short extra fields as chips, the rest as one spec line under the description,
// and the totals the app will compute. The column/spec split and the part runs
// come from @ms/core, so the card, the on-screen tables and the PDF always agree.
// Client-side math mirrors @ms/core exactly (same computeGst), so the card never
// disagrees with what gets saved.

export type PreviewLine = {
  description: string; hsn?: string; qty: number; uom?: string; rate: number; gstRate: number;
  isToolingCharge?: boolean; groupLabel?: string; groupNote?: string; attributes?: Record<string, string>;
};
export type PreviewColumn = { id: string; label: string; display?: 'column' | 'spec' };
export type PreviewDocMeta = { type: 'quotation' | 'invoice' | 'order'; interstate: boolean; tooling?: boolean; number?: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-ink border-t border-line pt-1 mt-1' : 'text-muted'}`}>
    <span>{label}</span><span className="font-mono tabular-nums text-ink">{value}</span>
  </div>
);

export function DocTotals({ lines, doc, className = '' }: { lines: PreviewLine[]; doc: PreviewDocMeta; className?: string }) {
  const totals = computeGst(lines, doc.interstate);
  if (doc.type === 'order') {
    return (
      <div className={`text-xs space-y-0.5 ${className}`}>
        <Row label="Order value (before GST)" value={formatINR(totals.subtotal)} strong />
        <div className="text-xs text-muted">GST is worked out when the bill is made.</div>
      </div>
    );
  }
  return (
    <div className={`text-xs space-y-0.5 ${className}`}>
      <Row label="Subtotal (before GST)" value={formatINR(totals.subtotal)} />
      {doc.interstate
        ? <Row label="IGST" value={formatINR(totals.igst)} />
        : <><Row label="CGST" value={formatINR(totals.cgst)} /><Row label="SGST" value={formatINR(totals.sgst)} /></>}
      <Row label="Total" value={formatINR(totals.grand)} strong />
    </div>
  );
}

export function DocPreview({
  lines, columns, doc, maxHeight = true,
}: {
  lines: PreviewLine[];
  columns?: PreviewColumn[];
  doc: PreviewDocMeta;
  /** Cap the table height (card) or let it grow (modal preview). */
  maxHeight?: boolean;
}) {
  const cols = (columns ?? []).filter((c) => c.label?.trim());
  // Short fields stay chips next to the description; the rest print as one
  // "Material: D2 · Hardness: 58–60 HRC" line, exactly like the PDF.
  const { tableCols } = splitColumns(cols);
  const runs = groupRuns(lines.map((line, i) => ({ ...line, sn: i + 1 })));
  const mixedGst = new Set(lines.map((l) => l.gstRate)).size > 1;

  const row = (line: PreviewLine & { sn: number }) => {
    const chips = tableCols.map((c) => [c.label, line.attributes?.[c.id]?.trim()] as const).filter(([, v]) => v);
    const specs = formatSpecs(itemSpecs(cols, line.attributes));
    return (
      <tr key={line.sn} className="border-b border-line last:border-0 align-top">
        <td className="pl-3 pr-1 py-1.5 text-muted tabular-nums">{line.sn}</td>
        <td className="px-1 py-1.5 min-w-0">
          <div className="text-ink break-words">{line.description}</div>
          {specs && <div className="text-xs text-muted leading-snug break-words mt-0.5">{specs}</div>}
          {(chips.length > 0 || line.isToolingCharge || mixedGst || line.hsn) && (
            <div className="flex flex-wrap gap-1 mt-0.5 text-xs">
              {line.isToolingCharge && <span className="pill !px-1.5 !py-0 bg-accent-soft text-accent text-xs">One-time charge</span>}
              {chips.map(([k, v]) => (
                <span key={k} className="pill !px-1.5 !py-0 bg-surface-2 text-muted text-xs max-w-full break-words"><span className="text-muted">{k}:</span> <span className="text-ink">{v}</span></span>
              ))}
              {mixedGst && <span className="pill !px-1.5 !py-0 bg-surface-2 text-muted text-xs">GST {line.gstRate}%</span>}
              {line.hsn && <span className="text-xs text-muted font-mono self-center">HSN {line.hsn}</span>}
            </div>
          )}
        </td>
        <td className="px-1 py-1.5 text-right whitespace-nowrap text-muted tabular-nums">
          {line.qty} {line.uom ?? 'NOS'} × {formatINR(line.rate)}
        </td>
        <td className="pl-1 pr-3 py-1.5 text-right whitespace-nowrap font-mono tabular-nums text-ink">{formatINR(r2(line.qty * line.rate))}</td>
      </tr>
    );
  };

  const count = `${lines.length} item${lines.length === 1 ? '' : 's'}${cols.length ? ` · ${cols.length} extra field${cols.length === 1 ? '' : 's'}` : ''}`;

  return (
    <div className="border border-line rounded-lg bg-surface overflow-hidden">
      <div className={`overflow-auto scroll-thin ${maxHeight ? 'max-h-72' : ''}`}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2/90 backdrop-blur">
            <tr className="text-left text-muted text-xs border-b border-line">
              <th className="pl-3 pr-1 py-1.5 font-medium" aria-label="Line number">#</th>
              <th className="px-1 py-1.5 font-medium">Item / description</th>
              <th className="px-1 py-1.5 font-medium text-right">Qty × Rate (₹)</th>
              <th className="pl-1 pr-3 py-1.5 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((seg, si) => {
              if (!seg.label) return <Fragment key={si}>{seg.items.map(row)}</Fragment>;
              const sub = seg.items.reduce((s, line) => s + line.qty * line.rate, 0);
              return (
                <Fragment key={si}>
                  <tr className="bg-surface-2/70 border-b border-line">
                    <td colSpan={4} className="px-3 py-1.5">
                      <span className="font-semibold text-ink break-words"><span className="text-accent" aria-hidden>▸</span> {seg.label}</span>
                      {seg.note && <span className="text-xs text-muted break-words"> · {seg.note}</span>}
                    </td>
                  </tr>
                  {seg.items.map(row)}
                  <tr className="bg-surface-2/40 border-b border-line">
                    <td colSpan={3} className="px-3 py-1 text-right text-muted text-xs">Subtotal — {seg.label}</td>
                    <td className="pl-1 pr-3 py-1 text-right font-mono tabular-nums font-semibold text-xs">{formatINR(r2(sub))}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t border-line bg-surface-2/40 flex flex-wrap items-end justify-between gap-3">
        <div className="text-xs text-muted min-w-0">
          {count}
          {doc.type !== 'order' && <div>{doc.interstate ? 'Other state · IGST' : 'Same state · CGST + SGST'}</div>}
        </div>
        <DocTotals lines={lines} doc={doc} className="min-w-[11rem]" />
      </div>
    </div>
  );
}

/** Change list for edits of an existing document (+ added / − removed / · detail). */
export function ChangeList({ changes }: { changes: string[] }) {
  if (!changes.length) return null;
  return (
    <div className="border border-line rounded-lg bg-surface px-3 py-2">
      <div className="text-xs text-muted mb-1">What changes</div>
      <ul className="text-xs space-y-0.5">
        {changes.map((c, i) => {
          const add = c.startsWith('+'), rem = c.startsWith('−') || c.startsWith('-'), sub = c.startsWith('  ·');
          return (
            <li key={i} className={`${add ? 'text-ok' : rem ? 'text-crit' : sub ? 'text-muted pl-3' : 'text-ink'} leading-snug`}>
              {sub ? c.trim() : c}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
