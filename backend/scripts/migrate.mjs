#!/usr/bin/env node
/**
 * Apply Atmosphere's database migrations, in order, exactly once each.
 *
 * This replaces the hand-written `applyXxx.mjs` scripts that were wired into
 * the deploy one at a time. Those scripts each applied a single named SQL file
 * and, crucially, exited 0 when every connection path failed — so a deploy
 * stayed green while the schema silently did not change. That is how
 * "the tables are not set up on this Supabase project yet" reached production.
 *
 * This runner:
 *   - keeps a ledger (public.atmosphere_migrations) of what has been applied,
 *   - applies only the files missing from that ledger, in filename order,
 *   - runs each file and its ledger row in one transaction,
 *   - refuses to run if an already-applied file has since been edited,
 *   - exits non-zero on any failure, so the deploy stops before shipping code
 *     that depends on schema that is not there.
 *
 * Modes
 *   node scripts/migrate.mjs              apply pending migrations
 *   node scripts/migrate.mjs --check      report drift, change nothing
 *   node scripts/migrate.mjs --baseline   record every current file as applied
 *                                         WITHOUT running it — one-time, for a
 *                                         database that was migrated by hand
 *   node scripts/migrate.mjs --baseline --versions-from <file>
 *                                         baseline only the versions listed in
 *                                         that file, one per line. Use with
 *                                         `reconcile-migrations.mjs --baseline-list`
 *                                         so migrations that never actually ran
 *                                         are left for the runner to apply.
 *   node scripts/migrate.mjs --dry-run    list what apply would do
 *
 * The baseline is deliberately a separate, explicit act. This runner will not
 * guess whether an un-ledgered production database is already at head; if the
 * ledger is missing, `apply` fails and tells the operator to baseline first.
 *
 * Connection (first that is configured wins):
 *   SUPABASE_ACCESS_TOKEN + SUPABASE_URL     Supabase Management API (preferred)
 *   DATABASE_URL / SUPABASE_DB_URL           psql, real transactions
 *   SUPABASE_DB_PASSWORD + SUPABASE_DB_HOST  psql via the session pooler
 *
 * SERVICE_ROLE_KEY is not a connection. The deploy copies a URL from the
 * Railway backend service when Keys does not have one.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDatabaseUrl,
  managementApiTarget,
  missingConnectionHelp,
} from './lib/migrateConnection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations');
const LEDGER = 'public.atmosphere_migrations';

const argv = process.argv.slice(2);
const args = new Set(argv);
const versionsFrom = (() => {
  const i = argv.indexOf('--versions-from');
  return i >= 0 ? argv[i + 1] : undefined;
})();
const MODE = args.has('--baseline')
  ? 'baseline'
  : args.has('--check')
    ? 'check'
    : args.has('--dry-run')
      ? 'dry-run'
      : 'apply';

function fail(message) {
  console.error(`\nmigrate: ${message}\n`);
  process.exit(1);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/* ---------------------------------------------------------------- files -- */

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) fail(`no migrations directory at ${MIGRATIONS_DIR}`);
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (names.length === 0) fail('migrations directory is empty');
  return names.map((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    return { version: name.replace(/\.sql$/, ''), name, sql, checksum: sha256(sql) };
  });
}

/* ----------------------------------------------------------- connection -- */

function hasPsql() {
  return spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
}

/**
 * A driver runs SQL and reads rows back. Both implementations throw on error —
 * nothing here is allowed to swallow a failure.
 *
 * Prefer the Management API when a personal access token is set. GitHub Actions
 * often cannot auth to Supavisor (ENOTFOUND tenant/user) even with the right
 * region; the Management API path avoids the pooler entirely.
 */
function makeDriver() {
  const api = managementApiTarget();
  if (api) return managementApiDriver(api.token, api.ref);

  const resolved = resolveDatabaseUrl();
  if (resolved) {
    if (!hasPsql()) {
      fail(
        `a ${resolved.source} connection is set but psql is not on PATH.\n` +
          '  Install postgresql-client in the deploy job, then retry.',
      );
    }
    return psqlDriver(resolved.url);
  }

  fail(missingConnectionHelp());
}

function psqlDriver(url) {
  const scratch = mkdtempSync(join(tmpdir(), 'atmosphere-migrate-'));
  const run = (sql, { transaction }) => {
    const file = join(scratch, `stmt-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
    writeFileSync(file, sql);
    const flags = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q'];
    if (transaction) flags.push('--single-transaction');
    const out = spawnSync('psql', [url, ...flags, '-f', file], { encoding: 'utf8' });
    if (out.status !== 0) {
      throw new Error((out.stderr || out.stdout || 'psql failed').trim());
    }
    return out.stdout ?? '';
  };
  return {
    label: 'psql',
    exec: (sql) => run(sql, { transaction: true }),
    // -A -t gives unaligned, tuples-only output: one value per line.
    query: (sql) => {
      const file = join(scratch, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
      writeFileSync(file, sql);
      const out = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-A', '-t', '-f', file], {
        encoding: 'utf8',
      });
      if (out.status !== 0) throw new Error((out.stderr || out.stdout || 'psql failed').trim());
      return out.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
  };
}

function managementApiDriver(token, ref) {
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  const send = async (query) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 800)}`);
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  };
  return {
    label: 'Supabase Management API',
    // The endpoint runs the whole string, so wrap it to keep it atomic.
    exec: (sql) => send(`begin;\n${sql}\ncommit;`),
    query: async (sql) => {
      const rows = await send(sql);
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => String(Object.values(r)[0] ?? '')).filter(Boolean);
    },
  };
}

/* -------------------------------------------------------------- ledger --- */

const CREATE_LEDGER = `
create table if not exists ${LEDGER} (
  version     text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  baselined   boolean not null default false
);
comment on table ${LEDGER} is
  'Applied Atmosphere migrations. Written only by backend/scripts/migrate.mjs.';
`;

async function ledgerExists(db) {
  const rows = await db.query(`select to_regclass('${LEDGER}') is not null;`);
  return rows[0] === 't' || rows[0] === 'true';
}

async function ledgerRows(db) {
  const rows = await db.query(
    `select version || ' ' || checksum from ${LEDGER} order by version;`,
  );
  const map = new Map();
  for (const line of rows) {
    const [version, checksum] = line.split(' ');
    if (version) map.set(version, checksum ?? '');
  }
  return map;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/* ---------------------------------------------------------------- modes -- */

async function main() {
  const files = migrationFiles();
  const db = makeDriver();
  console.log(`migrate: ${files.length} migration files, connected via ${db.label}`);

  const exists = await ledgerExists(db);

  if (MODE === 'baseline') {
    let toRecord = files;
    if (versionsFrom) {
      if (!existsSync(versionsFrom)) fail(`no such file: ${versionsFrom}`);
      const allowed = new Set(
        readFileSync(versionsFrom, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#')),
      );
      toRecord = files.filter((f) => allowed.has(f.version));
      const held = files.filter((f) => !allowed.has(f.version));
      if (toRecord.length === 0) fail(`${versionsFrom} matched none of the migrations in the tree.`);
      console.log(`migrate: baselining ${toRecord.length} of ${files.length} migrations from ${versionsFrom}`);
      if (held.length > 0) {
        console.log(`migrate: leaving ${held.length} for the runner to apply on the next deploy:`);
        for (const f of held) console.log(`      ${f.name}`);
      }
    }

    await db.exec(CREATE_LEDGER);
    const values = toRecord
      .map((f) => `(${sqlLiteral(f.version)}, ${sqlLiteral(f.checksum)}, true)`)
      .join(',\n  ');
    await db.exec(
      `insert into ${LEDGER} (version, checksum, baselined) values\n  ${values}\n` +
        `on conflict (version) do nothing;`,
    );
    console.log(`migrate: baselined ${toRecord.length} migrations as already applied.`);
    console.log('migrate: nothing was run against the database. Future migrations will apply normally.');
    return;
  }

  if (!exists) {
    fail(
      `the migration ledger ${LEDGER} does not exist.\n` +
        '  This database has never been managed by this runner.\n' +
        '  If it is already at head (migrated by hand), record that once with:\n' +
        '      node scripts/migrate.mjs --baseline\n' +
        '  Refusing to apply 136 migrations over an unknown schema.',
    );
  }

  const applied = await ledgerRows(db);

  // An applied migration whose file has since changed means history was
  // rewritten. The database and the tree disagree and no automatic action is
  // safe, so stop.
  const edited = files.filter((f) => applied.has(f.version) && applied.get(f.version) !== f.checksum);
  if (edited.length > 0) {
    fail(
      'these migrations were already applied but their files have changed:\n' +
        edited.map((f) => `      ${f.name}`).join('\n') +
        '\n  Add a new migration instead of editing an applied one.',
    );
  }

  const pending = files.filter((f) => !applied.has(f.version));
  const orphans = [...applied.keys()].filter((v) => !files.some((f) => f.version === v));

  if (orphans.length > 0) {
    console.warn(`migrate: ${orphans.length} migration(s) applied but no longer in the tree:`);
    for (const v of orphans) console.warn(`      ${v}`);
  }

  if (MODE === 'check') {
    if (pending.length === 0) {
      console.log('migrate: no drift — every migration in the tree is applied.');
      return;
    }
    console.error(`migrate: ${pending.length} migration(s) committed but not applied:`);
    for (const f of pending) console.error(`      ${f.name}`);
    process.exit(1);
  }

  if (pending.length === 0) {
    console.log('migrate: up to date, nothing to apply.');
    return;
  }

  if (MODE === 'dry-run') {
    console.log(`migrate: would apply ${pending.length} migration(s):`);
    for (const f of pending) console.log(`      ${f.name}`);
    return;
  }

  console.log(`migrate: applying ${pending.length} migration(s)...`);
  for (const f of pending) {
    process.stdout.write(`  ${f.name} ... `);
    // The migration and its ledger row go in together: a migration that runs
    // but is not recorded would be re-run on the next deploy.
    const statement =
      `${f.sql}\n\ninsert into ${LEDGER} (version, checksum) values ` +
      `(${sqlLiteral(f.version)}, ${sqlLiteral(f.checksum)});`;
    try {
      await db.exec(statement);
    } catch (err) {
      console.log('FAILED');
      fail(`${f.name} failed and was rolled back:\n\n${err instanceof Error ? err.message : String(err)}`);
    }
    console.log('ok');
  }
  console.log(`migrate: applied ${pending.length} migration(s).`);
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
