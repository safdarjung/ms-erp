'use client';
import { useEffect, useRef, useState } from 'react';
import { startRecording, isRecordingSupported, type AudioRecorder } from '@/lib/audio-recorder';

// Voice dictation for the assistant. Records mic audio and transcribes it with a
// light Gemini model (good at Hindi/Hinglish) via /api/assistant/transcribe.
// Unlike the browser SpeechRecognition API this works inside an installed Android
// web-app, because it only needs mic capture — not the recognition service.
// Tap to start, tap again to stop (no press-and-hold — that fails on phones).

const MAX_SECONDS = 60;
/** Fewer samples than this is a stray tap, not speech. */
const MIN_SAMPLES = 1600;
/** Icon-only controls keep a 44px hit area on phones even though the glyph is small. */
const HIT = 'min-h-11 min-w-11 inline-flex items-center justify-center';

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MicButton({
  onStart, onText, disabled, stopSignal,
}: {
  onStart?: () => void;
  /** Kept for API compatibility with the live-dictation variant; unused here. */
  onInterim?: (text: string) => void;
  onText: (text: string) => void;
  disabled?: boolean;
  /** Bump this to force-stop (discard) recording, e.g. when the message is sent. */
  stopSignal?: number;
}) {
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [lang, setLang] = useState<'en-IN' | 'hi-IN'>('hi-IN');
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<AudioRecorder | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setSupported(isRecordingSupported()); }, []);

  const clearTimers = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (maxRef.current) { clearTimeout(maxRef.current); maxRef.current = null; }
  };

  // Cleanup on unmount.
  useEffect(() => () => { recRef.current?.cancel(); clearTimers(); }, []);

  // Force-stop and DISCARD when the parent signals (the message was sent).
  useEffect(() => {
    if (recRef.current) {
      recRef.current.cancel();
      recRef.current = null;
      clearTimers();
      setElapsed(0);
      setMode('idle');
    }
  }, [stopSignal]);

  const finalize = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearTimers();
    setElapsed(0);
    setMode('transcribing');
    try {
      const { base64, mimeType, samples } = await rec.stop();
      if (samples < MIN_SAMPLES) { setErr('Too short — tap the mic, speak, then tap it again.'); setMode('idle'); return; }
      const res = await fetch('/api/assistant/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType, lang: langRef.current === 'hi-IN' ? 'hi' : 'en' }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        setErr(j.error ?? 'Voice typing didn’t work — please try again.');
      } else {
        const text = (j.text ?? '').trim();
        if (text) { setErr(null); onText(text); }
        else setErr('Didn’t catch that — try again, a little closer to the mic.');
      }
    } catch {
      setErr('Couldn’t reach the server — check your connection and try again.');
    } finally {
      setMode('idle');
    }
  };

  const begin = async () => {
    setErr(null);
    try {
      const rec = await startRecording();
      recRef.current = rec;
      onStart?.();
      setElapsed(0);
      setMode('recording');
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      maxRef.current = setTimeout(() => { void finalize(); }, MAX_SECONDS * 1000);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setErr(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Mic is blocked. Tap 🔒 in the address bar → Microphone → Allow.'
          : name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : 'Couldn’t start the mic — please try again.',
      );
    }
  };

  const onMic = () => {
    if (mode === 'recording') void finalize();
    else if (mode === 'idle') void begin();
  };

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice typing isn’t available in this browser."
        aria-label="Voice typing isn’t available in this browser"
        className={`btn-ghost shrink-0 !px-2.5 opacity-40 cursor-not-allowed ${HIT}`}
      >
        <MicIcon />
      </button>
    );
  }

  const busy = mode === 'transcribing';
  const langLabel = lang === 'en-IN' ? 'EN' : 'हिं';
  const langName = lang === 'en-IN' ? 'English' : 'Hindi';
  return (
    <div className="flex items-center gap-1 shrink-0">
      {mode === 'recording' && (
        <span className="text-xs text-crit font-medium whitespace-nowrap" role="status" aria-live="polite">
          <span className="animate-pulse" aria-hidden>●</span> Listening… tap to stop <span className="tabular-nums">{mmss(elapsed)}</span>
        </span>
      )}
      {busy && <span className="text-xs text-muted whitespace-nowrap" role="status" aria-live="polite">Writing it down…</span>}
      {err && mode === 'idle' && (
        <span className="text-xs text-crit max-w-[12rem] leading-tight" role="alert">{err}</span>
      )}
      <button
        type="button"
        onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
        disabled={mode !== 'idle'}
        className={`${HIT} rounded-full border border-line-strong px-2.5 text-xs font-medium text-muted hover:text-ink hover:border-accent/50 disabled:opacity-40 whitespace-nowrap`}
        title={`Speaking ${langName} — tap to switch`}
        aria-label={`Voice language: ${langName}. Tap to switch.`}
      >
        <span aria-hidden>🎤</span> {langLabel}
      </button>
      <button
        type="button"
        onClick={onMic}
        disabled={disabled || busy}
        title={busy ? 'Writing it down…' : mode === 'recording' ? 'Tap to stop' : 'Speak (हिन्दी / English)'}
        aria-label={busy ? 'Writing it down' : mode === 'recording' ? 'Stop listening' : 'Speak instead of typing'}
        aria-pressed={mode === 'recording'}
        className={`btn-ghost shrink-0 !px-2.5 ${HIT} ${mode === 'recording' ? '!text-crit !border-crit/50 animate-pulse' : err ? '!text-crit' : ''}`}
      >
        {busy ? <Spinner /> : <MicIcon />}
      </button>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  );
}
