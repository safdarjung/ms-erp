'use client';
import { openAssistant } from '@/components/assistant/assistant-panel';

const QUESTIONS = [
  'Top 5 customers by invoiced value',
  'Monthly invoiced totals, last 6 months',
  'इस महीने कितनी बिक्री हुई?',
  'Leads with no follow-up scheduled',
];

export function AskCard({ enabled }: { enabled: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="font-medium">Ask your data</span>
      </div>
      <p className="text-xs text-muted mb-3">
        Plain English or हिन्दी — answers come from live ERP data, with tables and charts.
      </p>
      {enabled ? (
        <div className="flex flex-col gap-1.5">
          {QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => openAssistant(q)}
              className="text-left text-sm px-3 py-2 rounded-lg border border-line bg-surface-2/50 hover:border-accent/50 hover:bg-accent-soft/40 transition-colors"
            >
              {q}
            </button>
          ))}
          <button onClick={() => openAssistant()} className="text-xs text-steel hover:underline mt-1 text-left">
            Open assistant (⌘K) →
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted bg-surface-2/60 border border-line rounded-lg p-3">
          Add <code className="font-mono bg-surface px-1 rounded">ANTHROPIC_API_KEY</code> or{' '}
          <code className="font-mono bg-surface px-1 rounded">GEMINI_API_KEY</code> to the server environment to
          enable the AI assistant, smart quotation drafting, and terms polishing. Everything else works without it.
        </div>
      )}
    </div>
  );
}
