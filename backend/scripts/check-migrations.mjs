#!/usr/bin/env node
/**
 * Inventory the two Supabase migration trees and fail if they drift in ways
 * that make production apply order ambiguous.
 *
 * Canonical product / verification path: backend/supabase/migrations/
 * Broader platform (PM, billing, sales, cyber, …): supabase/migrations/
 *
 * Overlapping filenames MUST be byte-identical. Unique files are reported so
 * operators know both trees must be applied for a full platform schema.
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

const backendSet = new Set(backend);
const platformSet = new Set(platform);
const overlap = backend.filter((f) => platformSet.has(f));
const backendOnly = backend.filter((f) => !platformSet.has(f));
const platformOnly = platform.filter((f) => !backendSet.has(f));

let drift = 0;
const identical = [];
const divergent = [];

for (const name of overlap) {
  const a = sha(join(backendDir, name));
  const b = sha(join(rootDir, name));
  if (a === b) identical.push(name);
  else {
    divergent.push(name);
    drift += 1;
  }
}

console.log('Atmosphere migration inventory');
console.log('==============================');
console.log(`backend/supabase/migrations: ${backend.length} files`);
console.log(`supabase/migrations:         ${platform.length} files`);
console.log(`overlap:                     ${overlap.length} (${identical.length} identical, ${divergent.length} divergent)`);
console.log(`backend-only:                ${backendOnly.length}`);
console.log(`platform-only:               ${platformOnly.length}`);
console.log('');

if (divergent.length) {
  console.error('ERROR: overlapping migrations differ in content:');
  for (const name of divergent) console.error(`  - ${name}`);
  console.error('Resolve by making the files identical or renaming one side.');
}

console.log('Apply guidance (Work Verification path)');
console.log('---------------------------------------');
console.log('1. Apply ALL of backend/supabase/migrations/ in filename order');
console.log('   (jobs, proof, field identity, media, twins, storage bucket).');
console.log('2. If you also ship PM / billing / sales / cyber, additionally');
console.log('   apply supabase/migrations/ files that are NOT in the overlap');
console.log('   list — never re-apply an overlapping file twice.');
console.log('3. Create Storage bucket job-proofs if the storage migration is');
console.log('   not enough for your Supabase project settings.');
console.log('');
console.log('See docs/production.md for the full production checklist.');

if (drift > 0) process.exit(1);

// Soft signal: empty trees would be catastrophic.
if (backend.length === 0) {
  console.error('ERROR: backend/supabase/migrations is empty');
  process.exit(1);
}

console.log('OK — no divergent overlaps.');
