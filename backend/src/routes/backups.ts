import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { backupListQuerySchema } from '../lib/crmValidation.js';
import { runSnapshot, verifySnapshot, BackupNotConfiguredError } from '../lib/backup/runner.js';
import { BACKUP_TABLES, EXCLUDED_TABLES } from '../lib/backup/tables.js';

export const backupRouter = Router();

backupRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Backup visibility and on-demand snapshots.
 *
 * Scope note: every route here is org-scoped. A member can see and trigger
 * backups of their own organization's data and nothing else — platform-wide
 * snapshots are an operator concern and are driven by the scheduler and the
 * CLI, never by an HTTP request carrying a tenant's session.
 *
 * There is also no download endpoint, on purpose. An archive is a decrypted
 * copy of every customer record an org holds; handing that to a browser on the
 * strength of a session cookie undoes the reason the data is encrypted at rest.
 * Exports for a customer leaving belongs in a separate, deliberate flow.
 */

/**
 * Snapshots are expensive — a full table walk plus compression and encryption.
 * The cap is per-IP and generous enough for real use, tight enough that a loop
 * in someone's script cannot turn the API into a backup denial-of-service.
 */
const snapshotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many backup requests. Try again later.', code: 'rate_limited' },
});

function camelSnapshot(row: Record<string, any>) {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    status: row.status,
    storageDriver: row.storage_driver,
    byteSize: row.byte_size,
    rowCount: row.row_count,
    tableCount: row.table_count,
    encryption: row.encryption,
    encryptionKeyId: row.encryption_key_id,
    contentSha256: row.content_sha256,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    verifyOk: row.verify_ok,
    error: row.error,
  };
}

/**
 * GET /api/backups/status
 *
 * Is our data actually being copied? Answers the question in one request:
 * configuration, the last successful snapshot, and whether it verified.
 */
backupRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data, error } = await supabase
      .from('backup_snapshots')
      .select('*')
      .eq('org_id', orgId)
      .order('started_at', { ascending: false })
      .limit(5);

    if (error) throw new HttpError(500, error.message, 'backup_status_failed');

    const snapshots = (data ?? []).map(camelSnapshot);
    const lastCompleted = snapshots.find((s) => s.status === 'completed') ?? null;

    res.json({
      configured: {
        enabled: config.backups.enabled,
        driver: config.backups.driver,
        intervalMinutes: config.backups.intervalMinutes,
        retentionDays: config.backups.retentionDays,
        // Whether, not which. The key never leaves the server.
        encrypted: Boolean(config.backups.encryptionKey),
      },
      lastCompleted,
      recent: snapshots,
      coverage: {
        tables: BACKUP_TABLES.map((t) => t.name),
        excluded: EXCLUDED_TABLES,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/backups — the org's snapshot history. */
backupRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset } = backupListQuerySchema.parse(req.query);

    const { data, error, count } = await supabase
      .from('backup_snapshots')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'backup_list_failed');

    res.json({ items: (data ?? []).map(camelSnapshot), total: count ?? 0, limit, offset });
  } catch (err) {
    next(err);
  }
});

/** GET /api/backups/:id — one snapshot with its per-table manifest. */
backupRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data, error } = await supabase
      .from('backup_snapshots')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message, 'backup_read_failed');
    if (!data) throw new HttpError(404, 'Not found', 'not_found');

    const [{ data: items }, { data: checks }] = await Promise.all([
      supabase
        .from('backup_snapshot_items')
        .select('table_name, row_count, byte_size, sha256')
        .eq('snapshot_id', req.params.id)
        .order('table_name'),
      supabase
        .from('backup_verifications')
        .select('verified_at, ok, method, rows_read, detail')
        .eq('snapshot_id', req.params.id)
        .order('verified_at', { ascending: false })
        .limit(10),
    ]);

    res.json({
      snapshot: camelSnapshot(data),
      tables: (items ?? []).map((i: any) => ({
        table: i.table_name,
        rowCount: i.row_count,
        byteSize: i.byte_size,
        sha256: i.sha256,
      })),
      verifications: (checks ?? []).map((c: any) => ({
        verifiedAt: c.verified_at,
        ok: c.ok,
        method: c.method,
        rowsRead: c.rows_read,
        detail: c.detail,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/backups
 *
 * Take a snapshot of the caller's organization now. Always org-scoped: `scope`
 * is not read from the body, because a tenant session must not be able to ask
 * for an archive spanning every tenant.
 */
backupRouter.post('/', snapshotLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId } = await requireOrgContext(req);

    const result = await runSnapshot({
      scope: 'org',
      orgId,
      kind: 'manual',
      createdBy: userId,
    });

    res.status(201).json({
      snapshot: {
        id: result.id,
        scope: result.scope,
        byteSize: result.byteSize,
        rowCount: result.rowCount,
        tableCount: result.tables.length,
        contentSha256: result.sha256,
        encryption: result.encryption,
        durationMs: result.durationMs,
      },
    });
  } catch (err) {
    if (err instanceof BackupNotConfiguredError) {
      next(new HttpError(503, err.message, 'backups_not_configured'));
      return;
    }
    next(err);
  }
});

/**
 * POST /api/backups/:id/verify
 *
 * Prove the archive is still readable. Defaults to a deep check — decrypt,
 * decompress, count every row — because a checksum only proves the bytes did
 * not rot, not that they still form a restorable backup.
 */
backupRouter.post('/:id/verify', snapshotLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    // Confirm ownership under the caller's own JWT before handing the id to the
    // service-role runner. Without this, the id in the URL would be the only
    // thing standing between a tenant and another tenant's archive.
    const { data, error } = await supabase
      .from('backup_snapshots')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message, 'backup_read_failed');
    if (!data) throw new HttpError(404, 'Not found', 'not_found');

    const method = req.query.method === 'checksum' ? 'checksum' : 'deep';
    const result = await verifySnapshot(req.params.id, method);

    res.json({ verification: result });
  } catch (err) {
    if (err instanceof BackupNotConfiguredError) {
      next(new HttpError(503, err.message, 'backups_not_configured'));
      return;
    }
    next(err);
  }
});
