'use client';
import { useState, useTransition } from 'react';
import { polishProseAction } from '@/app/(app)/quotations/ai-actions';

/**
 * "✦ Improve wording with AI" for prose fields (terms/notes). Sends the current
 * text to the AI gateway and offers the result for one-tap use — never
 * auto-applies.
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

  const idle = value.trim() ? `Improve wording with AI` : `Write ${kind} with AI`;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          aria-busy={pending}
          className="text-xs text-accent hover:underline disabled:opacity-50 inline-flex items-center gap-1 min-h-11 sm:min-h-0"
        >
          <span aria-hidden>✦</span>
          {pending ? 'Working…' : idle}
        </button>
        {error && <span role="alert" className="text-xs text-crit">{error}</span>}
      </div>
      {suggestion !== null && (
        <div className="mt-2 border border-accent/40 bg-accent-soft/30 rounded-lg p-3" role="region" aria-label="AI suggestion">
          <div className="text-xs text-accent font-medium mb-1.5">AI suggestion — read it before using</div>
          <div className="text-xs whitespace-pre-wrap text-ink max-h-40 overflow-y-auto scroll-thin">{suggestion}</div>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn-primary text-xs !py-1" onClick={() => { onApply(suggestion); setSuggestion(null); }}>
              Use this
            </button>
            <button type="button" className="btn-ghost text-xs !py-1" onClick={() => setSuggestion(null)}>
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
