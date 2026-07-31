import { z } from 'zod';
import { aiEnabled, runAssistant, type AssistantEvent, type ChatTurn } from '@ms/ai';
import { withTenant, tenant } from '@ms/db';
import { getCurrentUser } from '@/lib/auth';
import { checkAiRateLimit, executeAnalyticsQuery, recordAiUsage } from '@/lib/ai';
import { stageAction } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Multi-round tool loops (query → stage → narrate) regularly run 20–60s;
// without this, Vercel's default function timeout can cut the stream short.
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(6000),
  })).min(1).max(40),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.permissions.has('dashboard.view')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!aiEnabled()) return Response.json({ disabled: true });

  let history: ChatTurn[];
  try {
    history = bodySchema.parse(await req.json()).messages;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!checkAiRateLimit(user.tenantId)) {
    return Response.json({ error: 'Too many AI requests — try again in a minute.' }, { status: 429 });
  }

  const [t] = await withTenant(user.tenantId, user.userId, (tx) =>
    tx.select({ name: tenant.name }).from(tenant).limit(1),
  );

  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
      try {
        const events = runAssistant(history, {
          tenantName: t?.name ?? 'MS Enterprises',
          userName: user.name,
          today: new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'Asia/Kolkata' }).format(new Date()),
          permissions: user.permissions,
          executeQuery: (wrapped) => executeAnalyticsQuery(user.tenantId, user.userId, wrapped),
          stageAction: (kind, input) => stageAction(user, kind, input),
          signal: abort.signal,
        });
        for await (const ev of events) {
          send(ev);
          if (ev.type === 'done') {
            recordAiUsage(user.tenantId, user.userId, 'assistant', ev.model, ev.usage);
          }
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('assistant stream error:', e);
          send({ type: 'error', message: 'The assistant hit a problem — please try again.' });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
