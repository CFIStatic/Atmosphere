import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  sourceCreateSchema,
  sourceUpdateSchema,
  sourceToRow,
  csvImportSchema,
  listQuerySchema,
} from '../lib/crmValidation.js';
import { syncSource, recordsFromCsv, IntegrationsNotConfiguredError } from '../lib/integrations/mirror.js';

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Managing the copies we keep of other applications' data.
 *
 * A source describes where data comes from; a sync pulls it; the mirror stores
 * it verbatim and forever. Everything is org-scoped through the caller's JWT.
 *
 * One thing is deliberately absent: any way to read a credential back out.
 * Sources store the *name* of a secret and nothing else, so there is nothing to
 * leak here even by accident.
 */

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests. Try again shortly.', code: 'rate_limited' },
});

function serializeSource(row: Record<string, any>) {
  return {
    id: row.id,
    system: row.system,
    label: row.label,
    kind: row.kind,
    config: row.config,
    // The name of the secret, never its value.
    credentialRef: row.credential_ref,
    credentialConfigured: Boolean(
      row.credential_ref && process.env[`${config.integrations.credentialEnvPrefix}${row.credential_ref}`],
    ),
    enabled: row.enabled,
    syncIntervalMinutes: row.sync_interval_minutes,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/integrations/sources */
integrationsRouter.get('/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('crm_external_sources')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) throw new HttpError(500, error.message, 'sources_list_failed');
    res.json({ sources: (data ?? []).map(serializeSource) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/integrations/sources — register an application to mirror. */
integrationsRouter.post('/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const parsed = sourceCreateSchema.parse(req.body);

    const { data, error } = await supabase
      .from('crm_external_sources')
      .insert({ ...sourceToRow(parsed), org_id: orgId, created_by: userId })
      .select('*')
      .single();

    if (error) throw new HttpError(400, error.message, 'source_create_failed');
    res.status(201).json({ source: serializeSource(data) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/integrations/sources/:id */
integrationsRouter.patch('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const row = sourceToRow(sourceUpdateSchema.parse(req.body));

    if (Object.keys(row).length === 0) throw new HttpError(400, 'Nothing to update', 'empty_update');

    const { data, error } = await supabase
      .from('crm_external_sources')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();

    if (error) throw new HttpError(400, error.message, 'source_update_failed');
    if (!data) throw new HttpError(404, 'Not found', 'not_found');

    res.json({ source: serializeSource(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/integrations/sources/:id
 *
 * Cascades to the mirrored records. This is the ONLY way mirrored data is ever
 * removed — the append-only trigger refuses everything else — so it is a
 * genuinely destructive act and requires `?purge=true` to be spelled out.
 */
integrationsRouter.delete('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    if (req.query.purge !== 'true') {
      const { data, error } = await supabase
        .from('crm_external_sources')
        .update({ enabled: false })
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .select('id')
        .maybeSingle();

      if (error) throw new HttpError(400, error.message, 'source_disable_failed');
      if (!data) throw new HttpError(404, 'Not found', 'not_found');

      res.json({
        disabled: true,
        id: req.params.id,
        note: 'Source disabled; mirrored records kept. Add ?purge=true to delete the copy as well.',
      });
      return;
    }

    const { data, error } = await supabase
      .from('crm_external_sources')
      .delete()
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (error) throw new HttpError(400, error.message, 'source_delete_failed');
    if (!data) throw new HttpError(404, 'Not found', 'not_found');

    res.json({ deleted: true, purged: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

/** Confirms a source belongs to the caller's org before the service role touches it. */
async function assertOwnsSource(req: Request): Promise<{ orgId: string; userId: string }> {
  const { orgId, userId, supabase } = await requireOrgContext(req);
  const { data, error } = await supabase
    .from('crm_external_sources')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'source_read_failed');
  if (!data) throw new HttpError(404, 'Not found', 'not_found');
  return { orgId, userId };
}

/** POST /api/integrations/sources/:id/sync — pull now. */
integrationsRouter.post(
  '/sources/:id/sync',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = await assertOwnsSource(req);

      const result = await syncSource({
        sourceId: req.params.id,
        trigger: 'manual',
        startedBy: userId,
      });

      // A failed pull is a real outcome, not a server fault — report it with
      // detail rather than a 500 that says nothing about which vendor broke.
      res.status(result.status === 'failed' ? 502 : 200).json({ sync: result });
    } catch (err) {
      if (err instanceof IntegrationsNotConfiguredError) {
        next(new HttpError(503, err.message, 'integrations_not_configured'));
        return;
      }
      next(err);
    }
  },
);

/**
 * POST /api/integrations/sources/:id/import — mirror a CSV export.
 *
 * The path that works when a vendor has no API: export from their UI, drop the
 * file here, and we hold the copy. This route's larger body limit is applied in
 * app.ts, where the parser is selected — see the comment there for why it
 * cannot be raised from here.
 */
integrationsRouter.post(
  '/sources/:id/import',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = await assertOwnsSource(req);
      const { entityType, csv, idColumn, delimiter } = csvImportSchema.parse(req.body);

      const parsed = recordsFromCsv(csv, { entityType, idColumn, delimiter });

      const result = await syncSource({
        sourceId: req.params.id,
        trigger: 'manual',
        startedBy: userId,
        manualRecords: parsed.records,
      });

      res.status(result.status === 'failed' ? 502 : 200).json({
        sync: result,
        parsed: {
          rows: parsed.records.length,
          skippedWithoutId: parsed.skipped,
          truncated: parsed.truncated,
        },
      });
    } catch (err) {
      if (err instanceof IntegrationsNotConfiguredError) {
        next(new HttpError(503, err.message, 'integrations_not_configured'));
        return;
      }
      next(err);
    }
  },
);

/** GET /api/integrations/sources/:id/runs — the sync history for one source. */
integrationsRouter.get('/sources/:id/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset } = listQuerySchema.parse(req.query);

    const { data, error, count } = await supabase
      .from('crm_sync_runs')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('source_id', req.params.id)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'runs_failed');

    res.json({
      runs: (data ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger_kind,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        recordsSeen: r.records_seen,
        recordsNew: r.records_new,
        recordsChanged: r.records_changed,
        recordsFailed: r.records_failed,
        error: r.error,
      })),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/records — the mirror itself.
 *
 * Defaults to current versions. `?history=true` with an `externalId` returns
 * every version we have ever held of one record, which is what makes the mirror
 * a history rather than a cache.
 */
integrationsRouter.get('/records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset } = listQuerySchema.parse(req.query);

    const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined;
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const externalId = typeof req.query.externalId === 'string' ? req.query.externalId : undefined;
    const history = req.query.history === 'true';

    if (history && !externalId) {
      throw new HttpError(400, 'history=true needs an externalId', 'external_id_required');
    }

    let query = supabase
      .from('crm_external_records')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);

    if (!history) query = query.eq('is_current', true);
    if (sourceId) query = query.eq('source_id', sourceId);
    if (entityType) query = query.eq('entity_type', entityType);
    if (externalId) query = query.eq('external_id', externalId);

    const { data, error, count } = await query
      .order(history ? 'version' : 'fetched_at', { ascending: history })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'records_failed');

    res.json({
      records: (data ?? []).map((r: any) => ({
        id: r.id,
        sourceId: r.source_id,
        entityType: r.entity_type,
        externalId: r.external_id,
        version: r.version,
        isCurrent: r.is_current,
        payload: r.payload,
        payloadHash: r.payload_hash,
        sourceUpdatedAt: r.source_updated_at,
        fetchedAt: r.fetched_at,
        linkedTable: r.linked_table,
        linkedId: r.linked_id,
      })),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});
