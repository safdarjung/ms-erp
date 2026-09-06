'use client';
import { useEffect, useRef } from 'react';
import { useToast } from './toast';
import { clearFormDraft } from './use-form-draft';

/**
 * Lands on a document detail page after a save. When the page was reached with
 * `?created=1` / `?saved=1` it (1) drops the form's localStorage draft — the save
 * is now confirmed — (2) toasts "Quotation QT/… saved" and (3) tidies the URL.
 * Optionally shows a "Next: send it to the customer" strip with PDF / WhatsApp.
 */
export function DocumentSavedStrip({
  docLabel, number, justSaved, clearKeys, next, pdfHref, waHref, waDisabledReason,
}: {
  docLabel: 'Quotation' | 'Bill' | 'Order';
  number: string;
  justSaved: boolean;
  /** Draft keys to clear once the save is confirmed, e.g. ['quotation:new']. */
  clearKeys: string[];
  /** Strip text, e.g. "Next: send it to the customer →". Omit to show nothing. */
  next?: string;
  pdfHref?: string;
  waHref?: string | null;
  waDisabledReason?: string;
}) {
  const toast = useToast();
  const done = useRef(false);

  useEffect(() => {
    if (!justSaved || done.current) return;
    done.current = true;
    clearKeys.forEach(clearFormDraft);
    toast({ title: `${docLabel} ${number} saved`, variant: 'success' });
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('created'); url.searchParams.delete('saved');
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
    } catch { /* non-fatal */ }
  }, [justSaved, clearKeys, docLabel, number, toast]);

  if (!next) return null;
  return (
    <div role="status" className="mb-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 rounded-lg border border-ok/40 bg-[#e4f1ea]/60 px-4 py-3 text-sm">
      <span className="sm:flex-1 min-w-0">
        {justSaved && <b className="text-ok">{docLabel} {number} saved. </b>}
        {next}
      </span>
      <span className="flex flex-wrap gap-2">
        {pdfHref && <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-ghost text-xs">Download PDF</a>}
        {waHref
          ? <a href={waHref} target="_blank" rel="noreferrer" className="btn text-xs bg-[#25D366] hover:bg-[#20bd5a] text-white">Share on WhatsApp</a>
          : <button type="button" disabled className="btn text-xs bg-[#25D366]/50 text-white cursor-not-allowed" title={waDisabledReason ?? "Add the customer's phone to share"}>Share on WhatsApp</button>}
      </span>
    </div>
  );
}
