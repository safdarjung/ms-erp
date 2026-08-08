import 'server-only';

// Supabase Storage client (private bucket) via its REST API — no extra npm dep,
// just fetch + the service-role key (server-only). Degrades gracefully: if the
// env isn't set, uploads are skipped and the attachment is recorded without a path.

const BUCKET = 'lead-attachments';

function cfg(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function storageConfigured(): boolean {
  return cfg() !== null;
}

function safeName(name: string): string {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file';
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** Upload bytes to `<tenantId>/<folder>/<file>`; returns the stored object path. */
export async function uploadAttachment(
  tenantId: string, folder: string, name: string, mimeType: string, bytes: Buffer,
): Promise<string> {
  const c = cfg();
  if (!c) throw new Error('storage not configured');
  const path = `${tenantId}/${folder}/${safeName(name)}`;
  const res = await fetch(`${c.url}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${c.key}`,
      apikey: c.key,
      'content-type': mimeType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return path;
}

/** Time-limited URL to view/download a stored object (null if storage is off). */
export async function signedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const c = cfg();
  if (!c) return null;
  const res = await fetch(`${c.url}/storage/v1/object/sign/${BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.key}`, apikey: c.key, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { signedURL?: string };
  return j.signedURL ? `${c.url}/storage/v1${j.signedURL}` : null;
}
