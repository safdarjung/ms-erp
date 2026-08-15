'use client';
import { useEffect, useRef, useState } from 'react';
import { startRecording, isRecordingSupported, type AudioRecorder } from '@/lib/audio-recorder';

// Voice dictation for the assistant. Records mic audio and transcribes it with a
// light Gemini model (good at Hindi/Hinglish) via /api/assistant/transcribe.
// Unlike the browser SpeechRecognition API this works inside an installed Android
// web-app, because it only needs mic capture — not the recognition service.

const MAX_SECONDS = 60;

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
      if (samples < 1600) { setErr('Too short — hold the button and speak.'); setMode('idle'); return; }
      const res = await fetch('/api/assistant/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType, lang: langRef.current === 'hi-IN' ? 'hi' : 'en' }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        setErr(j.error ?? 'Voice typing failed — try again.');
      } else {
        const text = (j.text ?? '').trim();
        if (text) { setErr(null); onText(text); }
        else setErr('Didn’t catch that — try again.');
      }
    } catch {
      setErr('Voice typing failed — check your connection.');
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
          ? 'Mic blocked — allow microphone for this site (tap the lock/ⓘ in the address bar), then retry.'
          : name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : 'Couldn’t start the mic — try again.',
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
        title="Voice input needs microphone access (unavailable in this browser)."
        aria-label="Voice input not available in this browser"
        className="btn-ghost shrink-0 !px-2.5 opacity-40 cursor-not-allowed"
      >
        <MicIcon />
      </button>
    );
  }

  const busy = mode === 'transcribing';
  return (
    <div className="flex items-center gap-1 shrink-0">
      {mode === 'recording' && <span className="text-[0.62rem] tabular-nums text-crit font-medium">{mmss(elapsed)}</span>}
      {err && mode === 'idle' && (
        <span className="text-[0.62rem] text-crit max-w-[11rem] leading-tight" role="status">{err}</span>
      )}
      <button
        type="button"
        onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
        disabled={mode !== 'idle'}
        className="text-[0.62rem] font-medium text-muted hover:text-ink border border-line-strong rounded px-1.5 leading-none self-stretch disabled:opacity-40"
        title="Voice language (tap to switch)"
        aria-label={`Voice language: ${lang === 'en-IN' ? 'English' : 'Hindi'}`}
      >
        {lang === 'en-IN' ? 'EN' : 'हिं'}
      </button>
      <button
        type="button"
        onClick={onMic}
        disabled={disabled || busy}
        title={busy ? 'Transcribing…' : mode === 'recording' ? 'Stop & insert text' : 'Speak (voice typing)'}
        aria-label={busy ? 'Transcribing' : mode === 'recording' ? 'Stop and transcribe' : 'Start voice typing'}
        className={`btn-ghost shrink-0 !px-2.5 ${mode === 'recording' ? '!text-crit !border-crit/50 animate-pulse' : err ? '!text-crit' : ''}`}
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
