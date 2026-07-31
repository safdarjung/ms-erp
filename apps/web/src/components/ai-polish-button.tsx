'use client';
import { useState, useTransition } from 'react';
import { polishProseAction } from '@/app/(app)/quotations/ai-actions';

/**
 * "✦ Polish" for prose fields (terms/notes). Sends the current text to the AI
 * gateway and offers the result for one-click apply — never auto-applies.
 */
export function AiPolishButton({
  kind,
  docType,
  value,
  onApply,
  context,
  enabled,
}: {
  kind: 'terms' | 'notes';
  docType: 'quotation' | 'invoice';
  value: string;
  onApply: (text: string) => void;
  context?: string;
  enabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  const run = () =>
    start(async () => {
      setError(null);
      const res = await polishProseAction({ kind, docType, text: value, context });
      if (res.ok) setSuggestion(res.text);
      else setError(res.error);
    });

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="text-xs text-accent hover:underline disabled:opacity-50 inline-flex items-center gap-1"
        >
          <span aria-hidden>✦</span>
          {pending ? 'Polishing…' : value.trim() ? `Polish ${kind} with AI` : `Draft ${kind} with AI`}
        </button>
        {error && <span className="text-xs text-crit">{error}</span>}
      </div>
      {suggestion !== null && (
        <div className="mt-2 border border-accent/40 bg-accent-soft/30 rounded-lg p-3">
          <div className="text-[0.65rem] font-mono uppercase tracking-wider text-accent mb-1.5">AI suggestion — review before applying</div>
          <div className="text-xs whitespace-pre-wrap text-ink max-h-40 overflow-y-auto scroll-thin">{suggestion}</div>
          <div className="flex gap-3 mt-2">
            <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => { onApply(suggestion); setSuggestion(null); }}>
              Apply
            </button>
            <button type="button" className="text-xs text-muted hover:underline" onClick={() => setSuggestion(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
