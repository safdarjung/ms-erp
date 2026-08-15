import { gemini, GEMINI_MODELS, isGeminiRateLimit, usageFromGemini } from './gemini';
import { emptyUsage, type TokenUsage } from './models';

// Speech-to-text via Gemini (a "light" flash-lite model that handles Hindi /
// Hinglish well). The web layer records mic audio as 16-kHz mono WAV and posts
// it here; unlike the browser SpeechRecognition API, this works in an installed
// Android web-app because it only needs mic CAPTURE, not the recognition service.

/** Audio container types we accept (WAV is what the app records; others tolerated). */
export const TRANSCRIBE_MIME_TYPES = [
  'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/mpeg', 'audio/aac',
  'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm',
] as const;
export type TranscribeMime = (typeof TRANSCRIBE_MIME_TYPES)[number];

/** Raw audio byte cap (~4 MB ≈ a couple of minutes of 16-kHz mono WAV). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export type TranscribeResult = { text: string; usage: TokenUsage; model: string };

const PROMPT_HI =
  'Transcribe this audio VERBATIM. The speaker talks in Hindi or Hinglish (Hindi mixed with English), ' +
  'in the context of a manufacturing/engineering business. Write Hindi words in Devanagari and keep ' +
  'English words in the Latin alphabet, the way people normally type Hinglish. Do not translate. ' +
  'Output ONLY the transcript text — no quotes, labels, or commentary. If there is no clear speech, output nothing.';
const PROMPT_EN =
  'Transcribe this audio VERBATIM, in the context of a manufacturing/engineering business. The speaker ' +
  'may mix in some Hindi words (Hinglish) — keep them as spoken. Do not translate. Output ONLY the ' +
  'transcript text — no quotes, labels, or commentary. If there is no clear speech, output nothing.';

/**
 * Transcribe a base64 audio clip with Gemini. Uses the primary flash-lite model,
 * falling back to the secondary on a 429. Requires GEMINI_API_KEY (throws
 * AiDisabledError otherwise) — transcription always goes through Gemini even when
 * the assistant provider is Claude, since Claude has no audio input.
 */
export async function transcribeAudio(input: {
  audioBase64: string;
  mimeType: string;
  lang?: 'hi' | 'en';
}): Promise<TranscribeResult> {
  const ai = gemini();
  const prompt = input.lang === 'en' ? PROMPT_EN : PROMPT_HI;
  // Strip any codec suffix (e.g. "audio/webm;codecs=opus" → "audio/webm").
  const mimeType = input.mimeType.split(';')[0]!.trim() || 'audio/wav';

  const run = (model: string) =>
    ai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [{ text: prompt }, { inlineData: { mimeType, data: input.audioBase64 } }],
      }],
      config: { temperature: 0 },
    });

  let model: string = GEMINI_MODELS.primary;
  let res;
  try {
    res = await run(model);
  } catch (e) {
    if (!isGeminiRateLimit(e)) throw e;
    model = GEMINI_MODELS.fallback;
    res = await run(model);
  }

  const usage = usageFromGemini(res.usageMetadata) ?? emptyUsage();
  const text = (res.text ?? '').trim();
  return { text, usage, model };
}
