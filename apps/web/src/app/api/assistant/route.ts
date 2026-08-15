import { z } from 'zod';
import {
  aiEnabled, runAssistant, ATTACH_MIME_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES, base64LenCap, type AssistantEvent, type ChatTurn,
} from '@ms/ai';
import { withTenant, tenant } from '@ms/db';
import { getCurrentUser } from '@/lib/auth';
import { checkAiRateLimit, executeAnalyticsQuery, recordAiUsage } from '@/lib/ai';
import { stageAction } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Multi-round tool loops (query → stage → narrate) regularly run 20–60s;
// without this, Vercel's default function timeout can cut the stream short.
export const maxDuration = 60;

const attachmentSchema = z.object({
  name: z.string().max(200).optional(),
  mimeType: z.enum(ATTACH_MIME_TYPES),
  // base64 (no data: prefix); length-capped to the per-file byte limit.
  data: z.string().min(1).max(base64LenCap(MAX_ATTACHMENT_BYTES)),
});

const messagesSchema = z.array(z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(6000),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
}).refine((m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0, {
  message: 'A message must have text or an attachment',
})).min(1).max(40)
  // Guard total attachment payload across the whole request.
  .refine(
    (msgs) => msgs.reduce((sum, m) => sum + (m.attachments ?? []).reduce((s, a) => s + a.data.length, 0), 0)
      <= base64LenCap(MAX_ATTACHMENTS_TOTAL_BYTES),
    { message: 'Attachments are too large' },
  );

const bodySchema = z.object({
  messages: messagesSchema,
  // The app path the user is on, so the assistant can resolve "this record".
  context: z.object({ path: z.string().max(300) }).optional(),
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL_PAGES: { re: RegExp; entity: string }[] = [
  { re: new RegExp(`^/invoices/(${UUID})`), entity: 'invoice (tax invoice / bill)' },
  { re: new RegExp(`^/quotations/(${UUID})`), entity: 'quotation' },
  { re: new RegExp(`^/orders/(${UUID})`), entity: 'sales order' },
  { re: new RegExp(`^/customers/(${UUID})`), entity: 'customer' },
  { re: new RegExp(`^/leads/(${UUID})`), entity: 'lead' },
];
const LIST_PAGES: Record<string, string> = {
  '/invoices': 'the Invoices list', '/quotations': 'the Quotations list', '/orders': 'the Order book',
  '/customers': 'the Customers list', '/leads': 'the Leads list', '/leads/inbox': 'the Lead inbox',
  '/dashboard': 'the Dashboard', '/analytics': 'the Analytics page',
};

/** Turn the current app path into one trusted context line for the assistant. */
function describePage(path?: string): string | undefined {
  if (!path) return undefined;
  const clean = path.split('?')[0]!;
  for (const d of DETAIL_PAGES) {
    const m = clean.match(d.re);
    if (m) return `the ${d.entity} detail page — its ${d.entity.split(' ')[0]} id is ${m[1]!.toLowerCase()}. If the user says "this", "current", "it" or "here", act on that record.`;
  }
  return LIST_PAGES[clean];
}

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.permissions.has('dashboard.view')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!aiEnabled()) return Response.json({ disabled: true });

  let history: ChatTurn[];
  let pageContext: string | undefined;
  try {
    const body = bodySchema.parse(await req.json());
    history = body.messages;
    pageContext = describePage(body.context?.path);
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
          pageContext,
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
