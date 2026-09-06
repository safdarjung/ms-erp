import { z } from 'zod';
import {
  geminiEnabled, transcribeAudio, TRANSCRIBE_MIME_TYPES, MAX_AUDIO_BYTES, base64LenCap,
} from '@ms/ai';
import { getCurrentUser } from '@/lib/auth';
import { checkAiRateLimit, recordAiUsage } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  // base64 (no data: prefix), length-capped to the raw byte limit.
  audio: z.string().min(16).max(base64LenCap(MAX_AUDIO_BYTES)),
  mimeType: z.enum(TRANSCRIBE_MIME_TYPES),
  lang: z.enum(['hi', 'en']).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Your session has ended — please log in again.' }, { status: 401 });
  if (!user.permissions.has('dashboard.view')) {
    return Response.json({ error: 'Your login doesn’t include the AI assistant — ask the owner.' }, { status: 403 });
  }
  // Transcription always uses Gemini (Claude has no audio input).
  if (!geminiEnabled()) {
    return Response.json({ error: 'Voice typing isn’t switched on for this app yet.' }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: 'Couldn’t send that recording — please try again.' }, { status: 400 });
  }

  if (!checkAiRateLimit(user.tenantId)) {
    return Response.json({ error: 'Too many requests — wait a minute and try again.' }, { status: 429 });
  }

  try {
    const { text, usage, model } = await transcribeAudio({
      audioBase64: body.audio, mimeType: body.mimeType, lang: body.lang,
    });
    recordAiUsage(user.tenantId, user.userId, 'transcribe', model, usage);
    return Response.json({ text });
  } catch (e) {
    console.error('transcribe error:', e);
    return Response.json({ error: 'Couldn’t make out the recording — please try again.' }, { status: 502 });
  }
}
