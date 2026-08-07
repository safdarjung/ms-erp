'use client';
import { useEffect, useRef, useState } from 'react';

// Minimal Web Speech API typings (not in the default TS DOM lib).
type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Voice dictation for the assistant. Uses the browser's built-in speech engine
 * (Chrome/Edge: en-IN + hi-IN). The onInterim/onText interface is backend-neutral,
 * so this can later be swapped to stream mic audio to a self-hosted Nemotron
 * (nvidia/nemotron-3.5-asr-streaming-0.6b) WebSocket without touching the panel.
 */
export function MicButton({
  onStart, onInterim, onText, disabled,
}: {
  onStart?: () => void;
  onInterim?: (text: string) => void;
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<'en-IN' | 'hi-IN'>('en-IN');
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);

  useEffect(() => { setSupported(!!getCtor()); }, []);
  useEffect(() => () => recRef.current?.abort(), []);

  const stop = () => { recRef.current?.stop(); };

  const start = () => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setErr(null);
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) final += t; else interim += t;
      }
      if (interim && onInterim) onInterim(interim);
      if (final.trim()) onText(final.trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('Mic blocked — allow it in the browser.');
      else if (e.error === 'no-speech') setErr(null);
      else setErr('Voice error — try again.');
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    onStart?.();
    try { rec.start(); } catch { setListening(false); }
  };

  if (!supported) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
        className="text-[0.62rem] font-medium text-muted hover:text-ink border border-line-strong rounded px-1.5 leading-none self-stretch"
        title="Voice language (tap to switch)"
        aria-label={`Voice language: ${lang === 'en-IN' ? 'English' : 'Hindi'}`}
      >
        {lang === 'en-IN' ? 'EN' : 'हिं'}
      </button>
      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        disabled={disabled}
        title={err ?? (listening ? 'Stop dictation' : 'Speak')}
        aria-label={listening ? 'Stop dictation' : 'Dictate'}
        className={`btn-ghost shrink-0 !px-2.5 ${listening ? '!text-crit !border-crit/50 animate-pulse' : err ? '!text-crit' : ''}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    </div>
  );
}
