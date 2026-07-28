import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { createAdminClient } from '../supabase.js';
import { ArchiveWriter, readArchive, hashFile, type ArchiveHeader, type TableStat } from './archive.js';
import { createBackupStorage, stagingDir, type BackupStorage } from './storage.js';
import { BACKUP_TABLES, EXCLUDED_TABLES, type BackupTable } from './tables.js';

/**
 * The snapshot runner.
 *
 * Reads every table we own, streams it into an encrypted archive, hands the
 * archive to a storage driver, and records what happened in the catalog. Runs
 * with the service role because a backup that only captures what one user can
 * see is not a backup.
 *
 * Three properties are load-bearing:
 *
 *  - **Keyset pagination.** Rows are read in `id` order with a `>` cursor, not
 *    with OFFSET. Under concurrent writes an OFFSET walk skips and duplicates
 *    rows, which is exactly the kind of corruption you discover during a
 *    restore, when it is too late to do anything about it.
 *
 *  - **The catalog row is written first.** A snapshot that dies halfway leaves a
 *    `running` row that ages into a visible failure, rather than leaving no
 *    trace at all. Silence is the one thing a backup system must never report.
 *
 *  - **Checksums are computed over what storage receives**, not over what we
 *    meant to send, so verification can actually detect a bad write.
 */

export interface SnapshotOptions {
  scope: 'org' | 'platform';
  /** Required when scope is 'org'. */
  orgId?: string | null;
  kind?: 'scheduled' | 'manual' | 'pre_migration';
  createdBy?: string | null;
}

export interface SnapshotResult {
  id: string;
  scope: 'org' | 'platform';
  orgId: string | null;
  storagePath: string;
  byteSize: number;
  sha256: string;
  rowCount: number;
  tables: TableStat[];
  durationMs: number;
  encryption: 'none' | 'aes-256-gcm';
}

const PAGE_SIZE = 1000;

export class BackupNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupNotConfiguredError';
  }
}

function adminOrThrow(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) {
    throw new BackupNotConfiguredError(
      'Backups need SUPABASE_SERVICE_ROLE_KEY: a snapshot must read every org, ' +
        'which no user session can do.',
    );
  }
  return admin;
}

/** The user ids of an org's members — how `profiles` narrows to one tenant. */
async function memberIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin.from('org_members').select('user_id').eq('org_id', orgId);
  if (error) throw new Error(`Could not resolve org members: ${error.message}`);
  return (data ?? []).map((r) => r.user_id as string);
}

/**
 * Streams one table into the archive, page by page.
 *
 * Returns the number of rows written. `null` from the filter resolver means the
 * table has no rows for this org and is skipped without a query.
 */
async function exportTable(
  admin: SupabaseClient,
  writer: ArchiveWriter,
  table: BackupTable,
  orgId: string | null,
  ids: string[] | null,
): Promise<number> {
  writer.noteEmptyTable(table.name);

  let cursor: string | number | null = null;
  let written = 0;

  for (;;) {
    let query = admin.from(table.name).select('*').order(table.cursor, { ascending: true }).limit(PAGE_SIZE);

    if (orgId) {
      switch (table.orgFilter.kind) {
        case 'org_id':
          query = query.eq('org_id', orgId);
          break;
        case 'id':
          query = query.eq('id', orgId);
          break;
        case 'member_ids':
          if (!ids || ids.length === 0) return 0;
          query = query.in(table.orgFilter.column, ids);
          break;
        case 'platform_only':
          return 0;
      }
    }

    if (cursor !== null) query = query.gt(table.cursor, cursor);

    const { data, error } = await query;
    if (error) throw new Error(`Export of ${table.name} failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) await writer.writeRow(table.name, row);
    written += data.length;

    const last = data[data.length - 1] as Record<string, unknown>;
    cursor = last[table.cursor] as string | number;

    // A cursor column that is not actually unique would loop forever. Fail
    // loudly instead: a backup process that spins is worse than one that stops.
    if (cursor === null || cursor === undefined) {
      throw new Error(`Cursor column ${table.name}.${table.cursor} contained a null; cannot paginate safely.`);
    }
    if (data.length < PAGE_SIZE) break;
  }

  return written;
}

/**
 * Warns when the database has public tables the backup does not know about.
 *
 * This is the check that keeps the system honest over time. Adding a table and
 * forgetting to back it up produces no error anywhere else — the snapshot just
 * quietly stops being complete.
 */
async function findUnknownTables(admin: SupabaseClient): Promise<string[]> {
  const known = new Set([...BACKUP_TABLES.map((t) => t.name), ...Object.keys(EXCLUDED_TABLES)]);

  // information_schema is not exposed through PostgREST, so this is best-effort:
  // if the helper view is absent we skip the check rather than fail the backup.
  const { data, error } = await admin.rpc('backup_public_tables');
  if (error || !Array.isArray(data)) return [];

  return (data as Array<{ table_name: string }>)
    .map((r) => r.table_name)
    .filter((name) => !known.has(name));
}

export async function runSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const admin = adminOrThrow();
  const scope = options.scope;
  const orgId = scope === 'org' ? (options.orgId ?? null) : null;

  if (scope === 'org' && !orgId) {
    throw new Error('An org-scoped snapshot needs an orgId.');
  }

  const startedAt = Date.now();
  const storage = createBackupStorage();

  const expiresAt =
    config.backups.retentionDays > 0
      ? new Date(startedAt + config.backups.retentionDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  // Catalog row first, so a crash mid-run is visible rather than silent.
  const { data: created, error: createErr } = await admin
    .from('backup_snapshots')
    .insert({
      org_id: orgId,
      scope,
      kind: options.kind ?? 'manual',
      status: 'running',
      storage_driver: storage.driver,
      encryption: config.backups.encryptionKey ? 'aes-256-gcm' : 'none',
      encryption_key_id: config.backups.encryptionKey ? config.backups.encryptionKeyId : null,
      expires_at: expiresAt,
      created_by: options.createdBy ?? null,
    })
    .select('id')
    .single();

  if (createErr || !created) {
    throw new Error(`Could not open a backup record: ${createErr?.message ?? 'unknown error'}`);
  }

  const snapshotId = created.id as string;
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const storageKey = `${scope}/${stamp}__${snapshotId}.atmbak`;

  const staging = stagingDir();
  await mkdir(staging, { recursive: true });
  const stagePath = join(staging, `${snapshotId}-${randomUUID()}.tmp`);

  try {
    const unknown = await findUnknownTables(admin);
    if (unknown.length > 0) {
      console.warn(
        `[backup] ${unknown.length} table(s) are not covered by the backup manifest and will NOT ` +
          `be included: ${unknown.join(', ')}. Add them to src/lib/backup/tables.ts.`,
      );
    }

    const header: ArchiveHeader = {
      format: 'atmosphere-backup',
      version: 1,
      scope,
      orgId,
      createdAt: new Date(startedAt).toISOString(),
      tables: BACKUP_TABLES.map((t) => t.name),
    };

    const writer = new ArchiveWriter(stagePath, header);
    const ids = orgId ? await memberIds(admin, orgId) : null;

    for (const table of BACKUP_TABLES) {
      await exportTable(admin, writer, table, orgId, ids);
    }

    const result = await writer.finish();

    await storage.put(storageKey, stagePath);

    const durationMs = Date.now() - startedAt;

    await admin
      .from('backup_snapshots')
      .update({
        status: 'completed',
        storage_path: storageKey,
        byte_size: result.byteSize,
        content_sha256: result.sha256,
        row_count: result.rowCount,
        table_count: result.tables.length,
        encryption: result.encryption,
        encryption_key_id: result.encryptionKeyId,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq('id', snapshotId);

    if (result.tables.length > 0) {
      await admin.from('backup_snapshot_items').insert(
        result.tables.map((t) => ({
          snapshot_id: snapshotId,
          table_name: t.table,
          row_count: t.rowCount,
          byte_size: t.byteSize,
          sha256: t.sha256,
        })),
      );
    }

    return {
      id: snapshotId,
      scope,
      orgId,
      storagePath: storageKey,
      byteSize: result.byteSize,
      sha256: result.sha256,
      rowCount: result.rowCount,
      tables: result.tables,
      durationMs,
      encryption: result.encryption,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from('backup_snapshots')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', snapshotId);
    throw err;
  } finally {
    await rm(stagePath, { force: true });
  }
}

/* ------------------------------------------------------------- verification */

export interface VerifyResult {
  ok: boolean;
  method: 'checksum' | 'deep';
  bytesRead: number;
  rowsRead: number;
  detail: string;
}

/**
 * Checks that a snapshot is still restorable.
 *
 * `checksum` re-hashes the stored bytes. `deep` additionally decrypts,
 * decompresses, and counts every row back out against the manifest — the only
 * check that proves the archive is a backup rather than merely intact.
 *
 * Untested backups are the industry's most reliable way to discover, during an
 * outage, that there were no backups. This is what turns that into a scheduled
 * disappointment instead.
 */
export async function verifySnapshot(snapshotId: string, method: 'checksum' | 'deep' = 'deep'): Promise<VerifyResult> {
  const admin = adminOrThrow();
  const storage = createBackupStorage();

  const { data: snap, error } = await admin
    .from('backup_snapshots')
    .select('id, storage_path, content_sha256, row_count, status')
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) throw new Error(`Could not read snapshot: ${error.message}`);
  if (!snap) throw new Error(`No such snapshot: ${snapshotId}`);
  if (!snap.storage_path) throw new Error('Snapshot has no stored archive (it never completed).');

  const staging = stagingDir();
  await mkdir(staging, { recursive: true });
  const localPath = join(staging, `verify-${snapshotId}-${randomUUID()}.tmp`);

  let result: VerifyResult;

  try {
    await storage.get(snap.storage_path as string, localPath);

    const actualHash = await hashFile(localPath);
    const expected = snap.content_sha256 as string | null;

    if (expected && actualHash !== expected) {
      result = {
        ok: false,
        method,
        bytesRead: 0,
        rowsRead: 0,
        detail: `Checksum mismatch: stored archive hashes to ${actualHash}, catalog expects ${expected}.`,
      };
    } else if (method === 'checksum') {
      result = { ok: true, method, bytesRead: 0, rowsRead: 0, detail: 'Checksum matches.' };
    } else {
      const contents = await readArchive(localPath);
      const expectedRows = Number(snap.row_count ?? 0);
      const ok = contents.totalRows === expectedRows;
      result = {
        ok,
        method,
        bytesRead: 0,
        rowsRead: contents.totalRows,
        detail: ok
          ? `Read ${contents.totalRows} rows across ${contents.counts.size} tables; matches the manifest.`
          : `Row-count mismatch: archive holds ${contents.totalRows}, catalog expects ${expectedRows}.`,
      };
    }
  } catch (err) {
    result = {
      ok: false,
      method,
      bytesRead: 0,
      rowsRead: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(localPath, { force: true });
  }

  await admin.from('backup_verifications').insert({
    snapshot_id: snapshotId,
    ok: result.ok,
    method: result.method,
    rows_read: result.rowsRead,
    detail: result.detail,
  });

  await admin
    .from('backup_snapshots')
    .update({ verified_at: new Date().toISOString(), verify_ok: result.ok })
    .eq('id', snapshotId);

  return result;
}

/* --------------------------------------------------------------- retention */

/**
 * Deletes archives past their retention window.
 *
 * Storage is emptied first and the catalog updated after, so a failed delete
 * leaves a row still pointing at real data. The opposite order produces a
 * catalog that lies — the worst possible state for a backup system, because it
 * reports health it does not have.
 */
export async function applyRetention(): Promise<{ expired: number; removed: number; failed: number }> {
  const admin = adminOrThrow();
  const storage: BackupStorage = createBackupStorage();

  const cutoff = new Date().toISOString();
  const { data, error } = await admin
    .from('backup_snapshots')
    .select('id, storage_path')
    .eq('status', 'completed')
    .not('expires_at', 'is', null)
    .lt('expires_at', cutoff)
    .limit(200);

  if (error) throw new Error(`Retention scan failed: ${error.message}`);

  let removed = 0;
  let failed = 0;

  for (const snap of data ?? []) {
    const path = snap.storage_path as string | null;
    try {
      if (path) await storage.remove(path);
      await admin
        .from('backup_snapshots')
        .update({ status: 'expired', storage_path: null })
        .eq('id', snap.id as string);
      removed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[backup] could not expire snapshot ${String(snap.id)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { expired: (data ?? []).length, removed, failed };
}

/* ----------------------------------------------------------------- restore */

export interface RestoreOptions {
  snapshotId: string;
  /** Only these tables are touched. Restoring everything is never the default. */
  tables: string[];
  /**
   * Without this the restore reports what it *would* write and changes nothing.
   * Restoring over live data is the most destructive operation in the system,
   * so it takes an explicit act rather than an omission.
   */
  confirm: boolean;
}

export interface RestoreResult {
  dryRun: boolean;
  tables: Record<string, number>;
  totalRows: number;
}

/**
 * Replays an archive back into the database.
 *
 * Upserts by primary key rather than truncating: rows written since the
 * snapshot survive, and a restore aimed at one table cannot cascade into
 * others. Recovering a specific loss is the common case; wholesale rollback is
 * rare and deserves a deliberate, separate procedure.
 */
export async function restoreSnapshot(options: RestoreOptions): Promise<RestoreResult> {
  const admin = adminOrThrow();
  const storage = createBackupStorage();

  const allowed = new Set(BACKUP_TABLES.map((t) => t.name));
  for (const table of options.tables) {
    if (!allowed.has(table)) throw new Error(`Refusing to restore unknown table: ${table}`);
  }
  if (options.tables.length === 0) throw new Error('Name at least one table to restore.');

  const { data: snap, error } = await admin
    .from('backup_snapshots')
    .select('id, storage_path')
    .eq('id', options.snapshotId)
    .maybeSingle();

  if (error) throw new Error(`Could not read snapshot: ${error.message}`);
  if (!snap?.storage_path) throw new Error('Snapshot has no stored archive.');

  const staging = stagingDir();
  await mkdir(staging, { recursive: true });
  const localPath = join(staging, `restore-${options.snapshotId}-${randomUUID()}.tmp`);

  const wanted = new Set(options.tables);
  const counts: Record<string, number> = {};
  let total = 0;

  // Batched per table so a large restore does not become one enormous request.
  const buffers = new Map<string, Record<string, unknown>[]>();

  const flush = async (table: string, force = false) => {
    const buf = buffers.get(table);
    if (!buf || (!force && buf.length < 500)) return;
    if (options.confirm && buf.length > 0) {
      const { error: upsertErr } = await admin.from(table).upsert(buf, { onConflict: 'id' });
      if (upsertErr) throw new Error(`Restore into ${table} failed: ${upsertErr.message}`);
    }
    buffers.set(table, []);
  };

  try {
    await storage.get(snap.storage_path as string, localPath);

    await readArchive(localPath, async (table, row) => {
      if (!wanted.has(table)) return;
      counts[table] = (counts[table] ?? 0) + 1;
      total += 1;

      const buf = buffers.get(table) ?? [];
      buf.push(row as Record<string, unknown>);
      buffers.set(table, buf);
      await flush(table);
    });

    for (const table of wanted) await flush(table, true);
  } finally {
    await rm(localPath, { force: true });
  }

  return { dryRun: !options.confirm, tables: counts, totalRows: total };
}
