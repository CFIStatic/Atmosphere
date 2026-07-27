/**
 * Self-check for the backup archive format.
 *
 *   npm run check:backup                              plaintext archives
 *   BACKUP_ENCRYPTION_KEY=… npm run check:backup      encrypted archives
 *
 * Needs no database and no test framework, so it can run anywhere — including
 * as a pre-deploy sanity check on a machine that has the production key, which
 * is exactly where you want to find out that archives cannot be read back.
 *
 * The corruption cases are the ones that matter. An archive that fails to
 * verify is recoverable; an archive that reads back *wrong*, or that crashes
 * the verifier, is how a restore silently produces a half-empty database.
 */
import { mkdtemp, rm, writeFile, readFile, stat, truncate, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveWriter, readArchive, hashFile, type ArchiveHeader } from '../lib/backup/archive.js';

/* eslint-disable no-console */

const header: ArchiveHeader = {
  format: 'atmosphere-backup',
  version: 1,
  scope: 'platform',
  orgId: null,
  createdAt: new Date().toISOString(),
  tables: ['crm_jobs', 'crm_contacts'],
};

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

/** Runs `fn`, returning true when it rejected (rather than crashing the process). */
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function roundTrip(label: string): Promise<void> {
  console.log(`\n[${label}]`);
  const dir = await mkdtemp(join(tmpdir(), 'atmbak-'));
  const path = join(dir, 'test.atmbak');

  const writer = new ArchiveWriter(path, header);
  for (let i = 0; i < 5000; i += 1) {
    await writer.writeRow('crm_jobs', { id: `job-${i}`, title: `Job ${i}`, note: 'x'.repeat(200) });
  }
  for (let i = 0; i < 100; i += 1) {
    await writer.writeRow('crm_contacts', { id: `c-${i}`, last_name: `Contact ${i}`, unicode: 'café ☂ 中文 🙂' });
  }
  writer.noteEmptyTable('crm_leads');
  const result = await writer.finish();

  const contents = await readArchive(path);
  const counts = Object.fromEntries(contents.counts);

  check('row count round-trips', contents.totalRows === 5100);
  check('per-table counts round-trip', counts.crm_jobs === 5000 && counts.crm_contacts === 100);
  check('reported sha256 matches the file', (await hashFile(path)) === result.sha256);
  check('empty table appears in the manifest', result.tables.find((t) => t.table === 'crm_leads')?.rowCount === 0);
  check('header round-trips', contents.header.scope === 'platform' && contents.header.version === 1);
  check('encryption mode as expected', result.encryption === (process.env.BACKUP_ENCRYPTION_KEY ? 'aes-256-gcm' : 'none'));

  let sampleOk = false;
  await readArchive(path, (table, row) => {
    const r = row as Record<string, unknown>;
    if (table === 'crm_contacts' && r.id === 'c-42' && r.unicode === 'café ☂ 中文 🙂') sampleOk = true;
  });
  check('multibyte payload survives verbatim', sampleOk);

  // --- corruption must be DETECTED, and detected as a thrown error rather
  // --- than an uncaught stream event that would take the process down.
  const flipped = join(dir, 'flipped.atmbak');
  const buf = await readFile(path);
  buf[Math.floor(buf.length / 2)] ^= 0xff;
  await writeFile(flipped, buf);
  check('bit-flip is rejected', await rejects(() => readArchive(flipped)));

  const truncated = join(dir, 'truncated.atmbak');
  await copyFile(path, truncated);
  const { size } = await stat(truncated);
  await truncate(truncated, Math.floor(size * 0.8));
  check('truncation is rejected', await rejects(() => readArchive(truncated)));

  await rm(dir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await roundTrip(process.env.BACKUP_ENCRYPTION_KEY ? 'encrypted' : 'plaintext');
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(1);
});
