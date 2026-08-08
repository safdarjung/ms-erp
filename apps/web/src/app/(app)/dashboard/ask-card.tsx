'use client';
import { openAssistant } from '@/components/assistant/assistant-panel';

const QUESTIONS = [
  'Top 5 customers by invoiced value',
  'How much do customers owe us right now?',
  'इस महीने कितनी बिक्री हुई?',
  'Leads with no follow-up scheduled',
];

/** Prominent "Ask AI" button — reusable in the dashboard header. */
export function AskAiButton({ className = '' }: { className?: string }) {
  return (
    <button onClick={() => openAssistant()} className={`btn-primary ${className}`}>
      <span aria-hidden>✦</span> Ask AI
    </button>
  );
}

export function AskCard({ enabled }: { enabled: boolean }) {
  return (
    <div className="card p-5 border-accent/40 bg-gradient-to-br from-accent-soft/60 to-surface">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent text-lg" aria-hidden>✦</span>
        <span className="font-semibold text-base">Ask AI</span>
        <kbd className="kbd ml-auto">⌘K</kbd>
      </div>
      <p className="text-xs text-muted mb-3">
        Ask about your business in English or हिन्दी — <b>and</b> tell it to create quotes, record payments or log
        leads (you confirm every change). Tap the 🎤 to speak.
      </p>
      {enabled ? (
        <>
          <button onClick={() => openAssistant()} className="btn-primary w-full mb-3 justify-center">
            <span aria-hidden>✦</span> Ask AI anything
          </button>
          <div className="text-[0.62rem] font-mono uppercase tracking-wider text-faint mb-1.5">Try asking</div>
          <div className="flex flex-col gap-1.5">
            {QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => openAssistant(q)}
                className="text-left text-sm px-3 py-2 rounded-lg border border-line bg-surface/70 hover:border-accent/50 hover:bg-accent-soft/40 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </>
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
