#!/usr/bin/env node
/**
 * Build the migration manifest: for each migration, the database objects it
 * actually creates.
 *
 * Nothing here parses SQL. Regex over 136 files of DDL cannot be trusted —
 * 74 of them contain dollar-quoted function bodies and 16 build DDL inside
 * `execute format(...)`, so a parser reports objects that the migration never
 * creates and misses ones it does. Instead this replays the migrations against
 * a throwaway Postgres and snapshots the schema after each one. The difference
 * between two snapshots is exactly what that migration did, by construction.
 *
 * The manifest is what `reconcile-migrations.mjs` compares production against.
 * It is committed so the reconciler needs only read access to a database, and
 * regenerated whenever migrations are added.
 *
 * Usage:
 *   node scripts/migration-manifest.mjs --url postgresql://postgres@127.0.0.1:5432/postgres
 *
 * The URL must point at a Postgres this script may DROP AND RECREATE a database
 * on. It refuses anything that looks like a Supabase host.
 *
 * Requires: psql on PATH, and a Postgres the connecting user can create
 * databases on.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, psqlLines, owningTable, PsqlError } from './lib/schemaIntrospect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations');
const STUBS = [
  join(repoRoot, 'supabase/tests/00_local_stub.sql'),
  join(repoRoot, 'supabase/tests/00_supabase_platform_stub.sql'),
];
const MANIFEST_PATH = join(repoRoot, 'supabase/migration-manifest.json');
const SCRATCH_DB = 'atmosphere_migration_manifest';

function fail(message) {
  console.error(`\nmanifest: ${message}\n`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const adminUrl = arg('--url') || process.env.MANIFEST_DATABASE_URL || '';
if (!adminUrl) {
  fail('pass --url <postgres connection string> for a THROWAWAY local Postgres.');
}
if (/supabase\.(co|com|net)/i.test(adminUrl) || /pooler\./i.test(adminUrl)) {
  fail(
    'that URL looks like a Supabase project. This script drops and recreates a\n' +
      '  database; point it at a local throwaway Postgres instead.',
  );
}

function scratchUrl(base, db) {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

function runFile(url, path, { allowFailure = false } = {}) {
  const out = spawnSync(
    'psql',
    [url, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q', '-f', path],
    { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (out.status !== 0) {
    const detail = (out.stderr || out.stdout || 'psql failed').trim();
    if (allowFailure) return { ok: false, detail };
    throw new PsqlError(detail);
  }
  return { ok: true, detail: '' };
}

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) fail(`no migrations at ${MIGRATIONS_DIR}`);
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function diff(before, after) {
  const added = [];
  const removed = [];
  for (const o of after) if (!before.has(o)) added.push(o);
  for (const o of before) if (!after.has(o)) removed.push(o);
  added.sort();
  removed.sort();
  return { added, removed };
}

/* ------------------------------------------------------------------ main -- */

const files = migrationFiles();
console.log(`manifest: replaying ${files.length} migrations on ${SCRATCH_DB}`);

for (const stub of STUBS) {
  if (!existsSync(stub)) fail(`missing stub ${stub}`);
}

// Fresh scratch database.
try {
  psqlLines(adminUrl, `select 1`);
} catch (err) {
  fail(`cannot connect: ${err.message}`);
}
spawnSync('psql', [adminUrl, '--no-psqlrc', '-q', '-c', `drop database if exists ${SCRATCH_DB}`], {
  encoding: 'utf8',
});
const created = spawnSync(
  'psql',
  [adminUrl, '--no-psqlrc', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${SCRATCH_DB}`],
  { encoding: 'utf8' },
);
if (created.status !== 0) fail(`could not create ${SCRATCH_DB}: ${created.stderr.trim()}`);

const url = scratchUrl(adminUrl, SCRATCH_DB);

for (const stub of STUBS) {
  try {
    runFile(url, stub);
  } catch (err) {
    fail(`stub ${stub} failed:\n${err.message}`);
  }
}
console.log('manifest: Supabase stand-in applied');

// Everything the stubs created belongs to no migration.
let current = snapshot(url);
const baselineSize = current.size;
console.log(`manifest: baseline is ${baselineSize} objects`);

const entries = [];
const applyOrder = [];
let deferred = [];

/**
 * Apply one migration and record what it changed.
 *
 * Returns false when it cannot run yet — its dependency is created by a
 * migration that sorts later. Those are retried after the rest, and the
 * manifest records that the file cannot be applied in filename order.
 */
function applyOne(file, { deferrable }) {
  const path = join(MIGRATIONS_DIR, file);
  const result = runFile(url, path, { allowFailure: deferrable });
  if (!result.ok) return { deferred: true, detail: result.detail };

  const after = snapshot(url);
  const { added, removed } = diff(current, after);
  current = after;
  applyOrder.push(file);
  entries.push({
    version: file.replace(/\.sql$/, ''),
    file,
    creates: added,
    drops: removed,
    // A migration that adds no object cannot be detected in a live schema.
    // GRANT/REVOKE-only, data-only, comment-only and no-op placeholders land
    // here, and the reconciler must never call one of them "missing".
    structurallyVerifiable: added.length > 0,
  });
  return { deferred: false, detail: '' };
}

for (const file of files) {
  process.stdout.write(`  ${file} ... `);
  let outcome;
  try {
    outcome = applyOne(file, { deferrable: true });
  } catch (err) {
    fail(`${file} failed and is not a dependency-ordering problem:\n\n${err.message}`);
  }
  if (outcome.deferred) {
    console.log('deferred (dependency not created yet)');
    deferred.push({ file, firstError: outcome.detail.split('\n')[0] });
  } else {
    const e = entries[entries.length - 1];
    console.log(`${e.creates.length} created, ${e.drops.length} dropped`);
  }
}

// Retry deferred migrations now that every other migration has run. A file that
// still fails here is broken, not merely out of order.
const outOfOrder = [];
for (const { file, firstError } of deferred) {
  process.stdout.write(`  retry ${file} ... `);
  let outcome;
  try {
    outcome = applyOne(file, { deferrable: false });
  } catch (err) {
    fail(`${file} fails even after every other migration:\n\n${err.message}`);
  }
  const e = entries[entries.length - 1];
  console.log(`${e.creates.length} created, ${e.drops.length} dropped`);
  outOfOrder.push({ file, firstError });
}

// Objects that exist at the end. The reconciler only expects these — an object
// a migration created and a later one dropped must not be looked for.
const finalObjects = [...current].sort();
const finalSet = new Set(finalObjects);

/**
 * Which migrations could each object have come from?
 *
 * The replay attributes an object to the FIRST migration that creates it,
 * because that is the only one whose snapshot diff shows it. But several
 * migrations here re-create the same table with `if not exists` — the terms
 * acceptance table is created by both 20260907190000 and 20260907200000. If
 * only the later one ran, the object is still there, and no amount of schema
 * introspection can tell you the earlier one was skipped.
 *
 * Text-scanning is unreliable for deciding what a migration creates, which is
 * why the manifest is built by replay. It is reliable enough for this narrower
 * question, because a false hit only downgrades a migration to "cannot
 * distinguish" — it never produces a confident wrong answer.
 */
function creatableNames(sql) {
  // Function bodies contain DDL that is not executed at migration time, and
  // `execute format(...)` builds statements dynamically. Drop both first.
  const stripped = sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, ' ')
    .replace(/--[^\n]*/g, ' ');
  const names = new Set();
  const patterns = [
    /\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:materialized\s+)?(?:table|index|view|type|schema|function|trigger|policy)\s+(?:if\s+not\s+exists\s+)?([A-Za-z_"][\w".]*)/gi,
    /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([A-Za-z_"][\w"]*)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) {
      const raw = m[1].replace(/"/g, '').toLowerCase();
      names.add(raw.includes('.') ? raw.split('.').pop() : raw);
    }
  }
  return names;
}

const mentions = new Map(); // bare object name -> Set(version)
for (const file of files) {
  const version = file.replace(/\.sql$/, '');
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  for (const name of creatableNames(sql)) {
    if (!mentions.has(name)) mentions.set(name, new Set());
    mentions.get(name).add(version);
  }
}

/** The bare (unqualified, un-prefixed) name inside an object identifier. */
function bareName(entry) {
  const id = entry.slice(entry.indexOf('|') + 1);
  const parts = id.split('.');
  return parts[parts.length - 1].toLowerCase();
}

/** How many migrations create something by this name. */
function mentionCount(name) {
  const set = mentions.get(name);
  return set ? set.size : 0;
}

for (const e of entries) {
  e.survives = e.creates.filter((o) => finalSet.has(o));
  e.supersededCreates = e.creates.filter((o) => !finalSet.has(o));

  // An object another migration also creates cannot prove THIS migration ran.
  //
  // Check the owning table as well as the object's own name. A primary-key
  // index appears in no migration text at all, so on its own name it looks
  // unique to this migration; but if two migrations both `create table if not
  // exists` its table, either could have produced it.
  e.exclusive = e.survives.filter((o) => {
    if (mentionCount(bareName(o)) > 1) return false;
    const parent = owningTable(o);
    if (parent && mentionCount(parent.split('.').pop().toLowerCase()) > 1) return false;
    return true;
  });
  e.shared = e.survives.filter((o) => !e.exclusive.includes(o));

  // Verifiable only when at least one surviving object is created here and
  // nowhere else. A migration whose every object was later dropped, or is also
  // created elsewhere, is indistinguishable from one that never ran.
  e.structurallyVerifiable = e.exclusive.length > 0;
  e.indistinguishableReason =
    e.creates.length === 0
      ? 'creates no durable object'
      : e.survives.length === 0
        ? 'every object it created was dropped by a later migration'
        : e.exclusive.length === 0
          ? 'every object it creates is also created by another migration'
          : null;
}

const manifest = {
  generatedFrom: {
    migrationCount: files.length,
    stubs: STUBS.map((s) => s.replace(`${repoRoot}/`, '')),
    baselineObjects: baselineSize,
    finalObjects: finalObjects.length,
  },
  // Filename order is the order the runner applies in. Where that is not a
  // valid dependency order, this records it rather than hiding it.
  outOfOrder,
  applyOrder,
  migrations: entries.map((e) => ({
    version: e.version,
    file: e.file,
    structurallyVerifiable: e.structurallyVerifiable,
    indistinguishableReason: e.indistinguishableReason,
    // Objects created here and nowhere else. Their absence is proof this
    // migration did not run; the reconciler checks only these.
    expect: e.exclusive,
    // Created here, but also created by another migration. Present or absent,
    // they say nothing about this migration, so the reconciler ignores them.
    sharedWithOtherMigrations: e.shared,
    // Counts only. The full lists are large and nothing reads them; re-run the
    // generator when you need the detail.
    createdThenDroppedCount: e.supersededCreates.length,
    dropsCount: e.drops.length,
  })),
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const verifiable = entries.filter((e) => e.structurallyVerifiable).length;
console.log('');
console.log(`manifest: wrote ${MANIFEST_PATH.replace(`${repoRoot}/`, '')}`);
console.log(`manifest: ${verifiable}/${entries.length} migrations are structurally verifiable`);
console.log(`manifest: ${entries.length - verifiable} leave no detectable trace (grants, data, comments, or later dropped)`);
if (outOfOrder.length > 0) {
  console.log('');
  console.log(`manifest: ${outOfOrder.length} migration(s) cannot be applied in filename order:`);
  for (const o of outOfOrder) console.log(`      ${o.file}\n        ${o.firstError}`);
}
