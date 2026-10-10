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

import { createClient } from '@supabase/supabase-js';
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

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let query = db
  .from('job_proofs')
  .select('id, org_id, job_id, duration_seconds, byte_size, storage_path, transcript_text, transcript_segments, created_at')
  .is('deleted_at', null)
  .not('duration_seconds', 'is', null)
  .gte('duration_seconds', minSeconds)
  .order('duration_seconds', { ascending: false })
  .limit(ids.length ? ids.length : longest);
if (ids.length) query = query.in('id', ids);
const { data, error } = await query;
if (error) throw new Error(error.message);

const items = [];
for (const p of data ?? []) {
  const signed = await db.storage.from('job-proofs').createSignedUrl(p.storage_path as string, ttl);
  if (signed.error || !signed.data?.signedUrl) {
    console.warn(`skip ${p.id}: ${signed.error?.message ?? 'no url'}`);
    continue;
  }
  items.push({ ...p, signedUrl: signed.data.signedUrl, signedUntil: new Date(Date.now() + ttl * 1000).toISOString() });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 2));
const hours = items.reduce((a, p) => a + Number(p.duration_seconds), 0) / 3600;
console.log(`manifest: ${items.length} recordings, ${hours.toFixed(2)} h total → ${join(out, 'manifest.json')}`);
if (!items.some((p) => Number(p.duration_seconds) >= 4 * 3600)) console.log('NOTE: no recording ≥ 4 h yet; an 8 h shift is still needed for the full eval.');
