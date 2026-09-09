#!/usr/bin/env node
/**
 * Compare a live database against the migration manifest and report which
 * migrations look like they were never applied.
 *
 * Why this exists: production was migrated by hand for its whole life. Nothing
 * recorded what ran. `migrate.mjs --baseline` writes "all 136 applied" into the
 * ledger and, from then on, never revisits them — so if one never actually ran,
 * baselining buries it permanently. This is the check to run first.
 *
 * It only reads. It creates nothing, changes nothing, and needs no more than
 * SELECT on the catalogs.
 *
 * Usage:
 *   node scripts/reconcile-migrations.mjs                    # DATABASE_URL
 *   node scripts/reconcile-migrations.mjs --url <conn>
 *   node scripts/reconcile-migrations.mjs --json             # machine-readable
 *   node scripts/reconcile-migrations.mjs --baseline-list    # safe --baseline set
 *
 * Exit codes:
 *   0  every structurally verifiable migration is present
 *   1  at least one looks missing or partial — do not baseline yet
 *   2  could not run (no connection, no manifest)
 *
 * What it cannot tell you: a good third of the migrations leave no trace that
 * can be attributed to them. They only grant, only write data, only comment,
 * create something a later migration dropped, or create a table that another
 * migration also creates with `if not exists`. Nothing in the schema
 * distinguishes "ran" from "did not run" for those, and this reports them as
 * unverifiable rather than guessing. The summary counts them separately.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, groupByKind, collapseImplied, PsqlError } from './lib/schemaIntrospect.mjs';
import {
  classify,
  summarize,
  safeBaselineVersions,
  isClean,
  APPLIED,
  MISSING,
  PARTIAL,
  UNVERIFIABLE,
} from './lib/reconcile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const MANIFEST_PATH = join(repoRoot, 'supabase/migration-manifest.json');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const AS_JSON = has('--json');
const BASELINE_LIST = has('--baseline-list');

function die(code, message) {
  console.error(`\nreconcile: ${message}\n`);
  process.exit(code);
}

function poolerUrl() {
  const ref = process.env.SUPABASE_PROJECT_REF || refFromUrl(process.env.SUPABASE_URL || '');
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';
  if (!ref || !password) return '';
  const user = process.env.SUPABASE_DB_USER || `postgres.${ref}`;
  const host = process.env.SUPABASE_DB_HOST || 'aws-0-us-east-1.pooler.supabase.com';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:6543/postgres`;
}

function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url || '');
  return m ? m[1] : '';
}

const url = valueOf('--url') || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || poolerUrl();
if (!url) {
  die(
    2,
    'no database connection. Pass --url, or set DATABASE_URL, or set\n' +
      '  SUPABASE_DB_PASSWORD + SUPABASE_PROJECT_REF to use the pooler.\n' +
      '  This reads the catalogs only; it writes nothing.',
  );
}

if (!existsSync(MANIFEST_PATH)) {
  die(
    2,
    `no manifest at ${MANIFEST_PATH.replace(`${repoRoot}/`, '')}.\n` +
      '  Generate it against a throwaway Postgres first:\n' +
      '      node scripts/migration-manifest.mjs --url postgresql://postgres@127.0.0.1:5432/postgres',
  );
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

let live;
try {
  live = snapshot(url);
} catch (err) {
  die(2, err instanceof PsqlError ? `cannot read the database:\n  ${err.message}` : String(err));
}

/* ------------------------------------------------------------- classify -- */

const results = classify(manifest, live);
const counts = summarize(results);
const by = (s) => results.filter((r) => r.status === s);
const missing = by(MISSING);
const partial = by(PARTIAL);
const applied = by(APPLIED);
const unverifiable = by(UNVERIFIABLE);

/* ---------------------------------------------------------------- output -- */

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        summary: counts,
        missing: missing.map((m) => ({ version: m.version, expected: m.expect })),
        partial: partial.map((m) => ({ version: m.version, absent: m.absent, present: m.present.length })),
        unverifiable: unverifiable.map((m) => ({ version: m.version, reason: m.indistinguishableReason })),
      },
      null,
      2,
    ),
  );
  process.exit(missing.length + partial.length > 0 ? 1 : 0);
}

if (BASELINE_LIST) {
  for (const v of safeBaselineVersions(results)) console.log(v);
  process.exit(isClean(results) ? 0 : 1);
}

const pad = (n) => String(n).padStart(3, ' ');
console.log('');
console.log(`Reconciling ${results.length} migrations against the live schema.`);
console.log('');
console.log(`  ${pad(applied.length)}  applied        every object they create is present`);
console.log(`  ${pad(partial.length)}  partial        some objects present, some absent`);
console.log(`  ${pad(missing.length)}  missing        none of their objects exist`);
console.log(`  ${pad(unverifiable.length)}  unverifiable   create nothing durable; cannot be checked either way`);
console.log('');

function report(list, heading, explain) {
  if (list.length === 0) return;
  console.log(heading);
  console.log(explain);
  console.log('');
  for (const r of list) {
    console.log(`  ${r.file}`);
    const shown = collapseImplied(r.absent);
    const groups = groupByKind(shown);
    for (const [kind, ids] of groups) {
      const head = ids.slice(0, 6);
      const more = ids.length - head.length;
      console.log(`      missing ${kind}: ${head.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`);
    }
    if (r.status === PARTIAL) {
      console.log(`      present: ${r.present.length} of ${r.expect.length} objects`);
    }
    console.log('');
  }
}

report(
  missing,
  'NOT APPLIED',
  '  None of the objects these migrations create exist. Apply them before baselining,\n' +
    '  or leave them out of the baseline so the runner applies them on the next deploy.',
);

report(
  partial,
  'PARTIALLY APPLIED',
  '  Some of their objects exist and some do not. That is either a migration that failed\n' +
    '  halfway, or one whose objects a later hand-run change removed. Look at each before\n' +
    '  deciding — re-running is not automatically safe.',
);

if (unverifiable.length > 0) {
  console.log('NOT CHECKABLE');
  console.log('  These create no durable object, so the schema cannot show whether they ran.');
  console.log('  Most are grants, data backfills, comments, or objects a later migration dropped.');
  const reasons = new Map();
  for (const u of unverifiable) {
    const r = u.indistinguishableReason || 'creates no durable object';
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(3, ' ')}  ${reason}`);
  }
  console.log('  Run with --json to list them all.');
  console.log('');
}

if (manifest.outOfOrder?.length) {
  console.log('APPLY-ORDER WARNING');
  for (const o of manifest.outOfOrder) {
    console.log(`  ${o.file} cannot run in filename order.`);
    console.log(`      ${o.firstError}`);
  }
  console.log('  The runner applies in filename order, so a fresh database cannot be built from');
  console.log('  these files as they stand. It does not affect an existing database.');
  console.log('');
}

if (isClean(results)) {
  console.log('Every migration that can be checked is present.');
  console.log('Safe to run: node scripts/migrate.mjs --baseline');
  process.exit(0);
}

console.log('Do NOT baseline yet.');
console.log(`${missing.length + partial.length} migration(s) need a decision first.`);
console.log('');
console.log('Once each is resolved, the safe set to record is:');
console.log('  node scripts/reconcile-migrations.mjs --baseline-list');
process.exit(1);
