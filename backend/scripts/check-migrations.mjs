#!/usr/bin/env node
/**
 * Assert the two migration directories are a byte-identical mirror.
 *
 * Canonical content lives in both:
 *   - backend/supabase/migrations/  (BFF / CI / historical path)
 *   - supabase/migrations/          (Supabase CLI convention)
 *
 * They must stay identical. Apply either tree once — never both.
 *
 * Usage: node backend/scripts/check-migrations.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const backendDir = join(root, 'backend/supabase/migrations');
const rootDir = join(root, 'supabase/migrations');

function listSql(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const backend = listSql(backendDir);
const platform = listSql(rootDir);

let failed = false;

if (backend.length === 0) {
  console.error('ERROR: backend/supabase/migrations is empty');
  failed = true;
}

if (backend.length !== platform.length) {
  console.error(
    `ERROR: migration count mismatch — backend=${backend.length} supabase=${platform.length}`,
  );
  failed = true;
}

const backendSet = new Set(backend);
const platformSet = new Set(platform);
const onlyBackend = backend.filter((f) => !platformSet.has(f));
const onlyPlatform = platform.filter((f) => !backendSet.has(f));

if (onlyBackend.length || onlyPlatform.length) {
  console.error('ERROR: migration filename sets differ');
  for (const f of onlyBackend) console.error(`  only in backend: ${f}`);
  for (const f of onlyPlatform) console.error(`  only in supabase: ${f}`);
  failed = true;
}

let divergent = 0;
for (const name of backend) {
  if (!platformSet.has(name)) continue;
  if (sha(join(backendDir, name)) !== sha(join(rootDir, name))) {
    console.error(`ERROR: content drift: ${name}`);
    divergent += 1;
    failed = true;
  }
}

console.log('Atmosphere migration inventory');
console.log('==============================');
console.log(`mirrored files: ${backend.length}`);
console.log(`content drift:  ${divergent}`);
console.log('');
console.log('Apply once (either directory — they are identical):');
console.log('  backend/supabase/migrations/   OR   supabase/migrations/');
console.log('in filename order against the target Postgres.');
console.log('See docs/production.md.');

if (failed) process.exit(1);
console.log('OK — migration trees are identical mirrors.');
