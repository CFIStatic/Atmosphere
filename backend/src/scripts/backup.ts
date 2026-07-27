/**
 * Operator CLI for backups.
 *
 *   npm run backup                          platform-wide snapshot
 *   npm run backup -- --org <uuid>          one organization
 *   npm run backup:verify -- <snapshotId>   prove an archive is restorable
 *   npm run backup:list                     recent snapshots and their health
 *   npm run backup:restore -- <snapshotId> --tables crm_jobs,crm_contacts [--confirm]
 *
 * Restore is a dry run unless `--confirm` is passed. Writing over live data is
 * the most destructive thing this system can do, so it takes a deliberate act
 * rather than the absence of a flag.
 */

import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { runSnapshot, verifySnapshot, restoreSnapshot, applyRetention } from '../lib/backup/runner.js';
import { BACKUP_TABLES } from '../lib/backup/tables.js';

/* eslint-disable no-console */

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function cmdSnapshot(): Promise<void> {
  const org = flag('org');

  console.log(
    `Taking a ${org ? `snapshot of org ${org}` : 'platform-wide snapshot'} ` +
      `(driver=${config.backups.driver}, encrypted=${Boolean(config.backups.encryptionKey)})…`,
  );

  const result = await runSnapshot({
    scope: org ? 'org' : 'platform',
    orgId: org ?? null,
    kind: 'manual',
  });

  console.log(`\n✓ snapshot ${result.id}`);
  console.log(`  path      ${result.storagePath}`);
  console.log(`  size      ${mb(result.byteSize)}`);
  console.log(`  rows      ${result.rowCount} across ${result.tables.length} tables`);
  console.log(`  sha256    ${result.sha256}`);
  console.log(`  encrypted ${result.encryption}`);
  console.log(`  duration  ${result.durationMs}ms\n`);

  for (const t of result.tables.filter((x) => x.rowCount > 0)) {
    console.log(`    ${t.table.padEnd(24)} ${String(t.rowCount).padStart(8)} rows`);
  }

  if (!has('skip-verify')) {
    console.log('\nVerifying…');
    const verdict = await verifySnapshot(result.id, 'deep');
    console.log(verdict.ok ? `✓ ${verdict.detail}` : `✗ ${verdict.detail}`);
    if (!verdict.ok) process.exitCode = 1;
  }
}

async function cmdVerify(): Promise<void> {
  const id = process.argv[3];
  if (!id || id.startsWith('--')) throw new Error('Usage: npm run backup:verify -- <snapshotId>');

  const result = await verifySnapshot(id, has('checksum') ? 'checksum' : 'deep');
  console.log(result.ok ? `✓ ${result.detail}` : `✗ ${result.detail}`);
  if (!result.ok) process.exitCode = 1;
}

async function cmdList(): Promise<void> {
  const admin = createAdminClient();
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to inspect backups.');

  const { data, error } = await admin
    .from('backup_snapshots')
    .select('id, scope, org_id, status, row_count, byte_size, started_at, verify_ok, error')
    .order('started_at', { ascending: false })
    .limit(25);

  if (error) throw new Error(error.message);
  if (!data?.length) {
    console.log('No snapshots yet.');
    return;
  }

  console.log('started              status     scope     rows      size      verified  id');
  for (const s of data) {
    const verified = s.verify_ok === null ? '—' : s.verify_ok ? 'ok' : 'FAILED';
    console.log(
      `${String(s.started_at).slice(0, 19)}  ${String(s.status).padEnd(10)} ` +
        `${String(s.scope).padEnd(9)} ${String(s.row_count ?? 0).padStart(8)}  ` +
        `${mb(Number(s.byte_size ?? 0)).padStart(9)}  ${verified.padEnd(8)}  ${s.id}`,
    );
    if (s.error) console.log(`    error: ${s.error}`);
  }
}

async function cmdRestore(): Promise<void> {
  const id = process.argv[3];
  if (!id || id.startsWith('--')) {
    throw new Error(
      'Usage: npm run backup:restore -- <snapshotId> --tables a,b [--confirm]\n' +
        `Restorable tables: ${BACKUP_TABLES.map((t) => t.name).join(', ')}`,
    );
  }

  const tables = (flag('tables') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (tables.length === 0) throw new Error('Name the tables to restore with --tables a,b');

  const confirm = has('confirm');
  if (!confirm) {
    console.log('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n');
  } else {
    console.log('APPLYING restore. Rows are upserted by primary key.\n');
  }

  const result = await restoreSnapshot({ snapshotId: id, tables, confirm });

  for (const [table, count] of Object.entries(result.tables)) {
    console.log(`  ${table.padEnd(24)} ${String(count).padStart(8)} rows`);
  }
  console.log(`\n${result.dryRun ? 'Would restore' : 'Restored'} ${result.totalRows} rows.`);
}

async function cmdRetention(): Promise<void> {
  const result = await applyRetention();
  console.log(`Expired ${result.expired}, removed ${result.removed}, failed ${result.failed}.`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'snapshot';

  switch (command) {
    case 'snapshot':
      await cmdSnapshot();
      break;
    case 'verify':
      await cmdVerify();
      break;
    case 'list':
      await cmdList();
      break;
    case 'restore':
      await cmdRestore();
      break;
    case 'retention':
      await cmdRetention();
      break;
    default:
      throw new Error(`Unknown command: ${command} (expected snapshot | verify | list | restore | retention)`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
