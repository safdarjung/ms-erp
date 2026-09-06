'use client';
import { openAssistant } from '@/components/assistant/assistant-panel';
import { ShortcutKbd } from '@/components/shortcut-kbd';

// Questions send straight away; "✎" examples are things the AI will DO — they
// fill the box so the user can change the name/amount before sending.
const EXAMPLES: { text: string; fill?: boolean }[] = [
  { text: 'Kisne payment nahi di?' },
  { text: 'How much do customers owe us right now?' },
  { text: 'इस महीने कितनी बिक्री हुई?' },
  { text: 'Top 5 customers by billing this year' },
  { text: '✎ Sharma Auto ke liye quotation banao', fill: true },
  { text: 'Enquiries with no follow-up planned' },
];

const AI_OFF = 'The AI assistant is switched off. Ask the person who set up the app to turn it on. Everything else works as normal.';

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
        <ShortcutKbd className="ml-auto" />
      </div>
      <p className="text-xs text-muted mb-3">
        Ask about your business in English or हिन्दी — or tell it to make a quotation, record a payment or add an
        enquiry. Nothing is saved until you tap <b>Yes</b> on the card. Tap 🎤 to speak.
      </p>
      {enabled ? (
        <>
          <button onClick={() => openAssistant()} className="btn-primary w-full mb-3 justify-center">
            <span aria-hidden>✦</span> Ask AI anything
          </button>
          <div className="text-xs text-muted mb-1.5">Try asking</div>
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.text}
                onClick={() => openAssistant(ex.fill ? ex.text.replace(/^✎\s*/, '') : ex.text, { fill: ex.fill })}
                className="text-left text-sm px-3 py-2.5 min-h-11 rounded-lg border border-line bg-surface/70 hover:border-accent/50 hover:bg-accent-soft/40 transition-colors"
              >
                {ex.text}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted bg-surface-2/60 border border-line rounded-lg p-3">{AI_OFF}</div>
      )}
    </div>
  );
}
