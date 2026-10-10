/**
 * READ-ONLY fetch for the long-recording eval. The only process that sees the
 * service key. It performs SELECTs and createSignedUrl, nothing else, and
 * writes a manifest to a local directory. It never inserts, updates, deletes
 * or uploads. The eval itself (run-eval.ts) refuses to start with the key set.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/eval/fetch-signed-urls.ts --longest 5 --out /workspace/video-cost/eval
 *   (or --ids <uuid,uuid>) [--min-seconds 0] [--ttl 21600]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the read-only fetch.');
const out = arg('out', '/workspace/video-cost/eval')!;
const ttl = Number(arg('ttl', '21600'));
const minSeconds = Number(arg('min-seconds', '0'));
const ids = (arg('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const longest = Number(arg('longest', '5'));

// Plain HTTP (no supabase-js): one PostgREST GET and one storage sign POST per
// clip. Both are reads; nothing here can insert, update, delete or upload.
const headers = { apikey: key, authorization: `Bearer ${key}` };
const params = new URLSearchParams({
  select: 'id,org_id,job_id,duration_seconds,byte_size,storage_path,transcript_text,transcript_segments,created_at',
  deleted_at: 'is.null',
  duration_seconds: `gte.${minSeconds}`,
  order: 'duration_seconds.desc',
  limit: String(ids.length ? ids.length : longest),
});
if (ids.length) params.set('id', `in.(${ids.join(',')})`);
const res = await fetch(`${url}/rest/v1/job_proofs?${params}`, { headers });
if (!res.ok) throw new Error(`select failed: ${res.status}`);
const data = (await res.json()) as Array<Record<string, unknown>>;

const items = [];
for (const p of data) {
  const path = String(p.storage_path).split('/').map(encodeURIComponent).join('/');
  const signed = await fetch(`${url}/storage/v1/object/sign/job-proofs/${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: ttl }),
  });
  const body = (await signed.json().catch(() => ({}))) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL ?? body.signedUrl;
  if (!signed.ok || !rel) {
    console.warn(`skip ${String(p.id)}: sign ${signed.status}`);
    continue;
  }
  items.push({ ...p, signedUrl: `${url}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`, signedUntil: new Date(Date.now() + ttl * 1000).toISOString() });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 2));
const hours = items.reduce((a, p) => a + Number(p.duration_seconds), 0) / 3600;
console.log(`manifest: ${items.length} recordings, ${hours.toFixed(2)} h total → ${join(out, 'manifest.json')}`);
if (!items.some((p) => Number(p.duration_seconds) >= 4 * 3600)) console.log('NOTE: no recording ≥ 4 h yet; an 8 h shift is still needed for the full eval.');
