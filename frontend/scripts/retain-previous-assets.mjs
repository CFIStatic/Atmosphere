#!/usr/bin/env node
/**
 * Keep the previous deploys' hashed /assets files servable.
 *
 * A tab opened before a deploy still asks for the old hashed page files
 * (e.g. /assets/LoginsPage-<oldhash>.js). Each image only contains its own
 * build, so those 404 and the page fails to load. At image build time we read
 * the live site's /assets-manifest.json, download every file it still lists
 * that this build doesn't have, and write a new manifest carrying them
 * forward. Files are dropped RETAIN_DAYS after they last shipped in a live
 * build, so the image doesn't grow forever.
 *
 * Fail-soft by design: no origin, a network error, or a missing manifest
 * (first deploy with this script) just means nothing is carried over.
 *
 * Usage: node scripts/retain-previous-assets.mjs <distDir> [previousOrigin]
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RETAIN_DAYS = Number(process.env.ASSET_RETAIN_DAYS || 14);
const MAX_FILES = 3000;
const CONCURRENCY = 8;
const TIMEOUT_MS = 15_000;
const SAFE_NAME = /^[\w.-]+$/;

const distDir = path.resolve(process.argv[2] || 'dist');
const origin = (process.argv[3] || '').trim().replace(/\/+$/, '');
const assetsDir = path.join(distDir, 'assets');
const now = new Date();
const log = (...a) => console.log('[retain-assets]', ...a);

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const current = new Set((await readdir(assetsDir)).filter((f) => SAFE_NAME.test(f)));
const files = {};
for (const f of current) files[f] = now.toISOString();

let carried = 0;
let dropped = 0;
if (/^https?:\/\/[^/]+$/.test(origin)) {
  const raw = await get(`${origin}/assets-manifest.json?t=${now.getTime()}`);
  let prev = null;
  try {
    prev = raw ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    prev = null;
  }
  if (prev && prev.files && typeof prev.files === 'object') {
    const cutoff = now.getTime() - RETAIN_DAYS * 86_400_000;
    const wanted = Object.entries(prev.files)
      .filter(([name, lastLive]) => SAFE_NAME.test(name) && !current.has(name) && Date.parse(lastLive) >= cutoff)
      .slice(0, MAX_FILES);
    dropped = Object.keys(prev.files).length - wanted.length - Object.keys(prev.files).filter((n) => current.has(n)).length;
    let i = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < wanted.length) {
          const [name, lastLive] = wanted[i++];
          const body = await get(`${origin}/assets/${encodeURIComponent(name)}`);
          if (!body) continue;
          await writeFile(path.join(assetsDir, name), body);
          files[name] = lastLive;
          carried++;
        }
      }),
    );
  } else {
    log(`no previous manifest at ${origin}; nothing to carry over`);
  }
} else {
  log('no previous origin set; nothing to carry over');
}

await mkdir(distDir, { recursive: true });
await writeFile(
  path.join(distDir, 'assets-manifest.json'),
  JSON.stringify({ generatedAt: now.toISOString(), retainDays: RETAIN_DAYS, files }, null, 0),
);
log(`current ${current.size}, carried over ${carried}, expired ${Math.max(0, dropped)}`);
