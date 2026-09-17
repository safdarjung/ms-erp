'use client';
import { useEffect, useState, useTransition } from 'react';
import { openAssistant } from '@/components/assistant/assistant-panel';
import { briefingAction } from './actions';

// "Today, in plain words" — loads after the page paints so the dashboard is
// never held up by the model; cached per day server-side.

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; generatedAt: string; cached: boolean }
  | { kind: 'off' }
  | { kind: 'error'; message: string };

const timeIST = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

export function BriefingCard({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'off' });
  const [pending, start] = useTransition();

  const load = (refresh: boolean) => start(async () => {
    const res = await briefingAction({ refresh });
    if (!res.ok) setState({ kind: 'error', message: res.error });
    else if ('disabled' in res) setState({ kind: 'off' });
    else setState({ kind: 'ready', text: res.text, generatedAt: res.generatedAt, cached: res.cached });
  });

  useEffect(() => {
    if (enabled) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (state.kind === 'off') return null;

  return (
    <div className="mt-3 pt-3 border-t border-line">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="text-xs font-medium text-muted flex-1">In plain words</span>
        {state.kind === 'ready' && (
          <span className="text-xs text-faint">{state.cached ? 'written' : 'updated'} {timeIST(state.generatedAt)}</span>
        )}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={pending || state.kind === 'loading'}
          className="text-xs text-steel hover:underline disabled:opacity-50 min-h-11 sm:min-h-0 px-1"
          aria-label="Write today's summary again"
        >
          {pending ? 'Writing…' : 'Refresh'}
        </button>
      </div>
      {state.kind === 'loading' && (
        <div className="space-y-1.5" aria-busy="true" aria-label="Writing today's summary">
          <div className="skeleton h-3.5 w-11/12" /><div className="skeleton h-3.5 w-3/4" /><div className="skeleton h-3.5 w-5/6" />
        </div>
      )}
      {state.kind === 'error' && <p className="text-xs text-muted">{state.message}</p>}
      {state.kind === 'ready' && (
        <>
          <ul className="text-sm text-ink space-y-1 leading-relaxed">
            {state.text.split('\n').filter(Boolean).map((line, i) => (
              <li key={i} className="pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">
                {line.replace(/^•\s*/, '')}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => openAssistant('What should I do first today, and why?')}
              className="text-xs px-2.5 py-1.5 min-h-11 sm:min-h-0 rounded-full border border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40 transition-colors">
              ✦ Ask what to do first
            </button>
            <button type="button" onClick={() => openAssistant('Kisne payment nahi di? Reminder message bhi bana do.')}
              className="text-xs px-2.5 py-1.5 min-h-11 sm:min-h-0 rounded-full border border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40 transition-colors">
              ✦ Draft payment reminders
            </button>
          </div>
        </>
      )}
    </div>
  );
}
