import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  sourceCreateSchema,
  sourceUpdateSchema,
  sourceToRow,
  csvImportSchema,
  listQuerySchema,
  connectCrmSchema,
  pushCrmSchema,
} from '../lib/crmValidation.js';
import { catalogEntry, listCatalog } from '../lib/integrations/catalog.js';
import {
  integrationsVaultConfigured,
  sealIntegrationSecret,
  type IntegrationSecret,
} from '../lib/integrations/credentials.js';
import {
  syncSource,
  recordsFromCsv,
  IntegrationsNotConfiguredError,
  resolveSourceAuth,
} from '../lib/integrations/mirror.js';
import { promoteSourceToCrm } from '../lib/integrations/promote.js';
import { pushToCrm } from '../lib/integrations/push.js';
import { createAdminClient } from '../lib/supabase.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireOrgContext, requireGlobalAdmin } from '../lib/orgContext.js';
import { listGrants, loadGrant, saveGrant, deleteGrant } from '../lib/integrations/oauthVault.js';
import { authorizeUrl, exchangeCode, revoke } from '../lib/integrations/salesforce.js';
import { KNOWN_CRMS } from '../lib/integrations/browserCrm.js';

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Managing the copies we keep of other applications' data — and writing back.
 *
 * A source describes where data comes from; a sync pulls it; promote maps the
 * mirror into the native CRM; push sends notes/contacts into the vendor.
 * Credentials are either sealed (UI connect) or referenced by env name.
 */

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests. Try again shortly.', code: 'rate_limited' },
});

function serializeSource(row: Record<string, any>) {
  const sealed = Boolean(row.credential_ciphertext && row.credential_iv && row.credential_auth_tag);
  const envConfigured = Boolean(
    row.credential_ref &&
      process.env[`${config.integrations.credentialEnvPrefix}${row.credential_ref}`],
  );

  return {
    id: row.id,
    system: row.system,
    label: row.label,
    kind: row.kind,
    config: row.config,
    direction: row.direction ?? 'bidirectional',
    credentialRef: row.credential_ref,
    credentialConfigured: sealed || envConfigured,
    credentialFingerprint: row.credential_fingerprint ?? null,
    credentialStorage: sealed ? 'sealed' : envConfigured ? 'env' : 'none',
    enabled: row.enabled,
    syncIntervalMinutes: row.sync_interval_minutes,
    lastSyncAt: row.last_sync_at,
    lastPromoteAt: row.last_promote_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Connecting and syncing CRMs needs SUPABASE_SERVICE_ROLE_KEY on the server.',
      'integrations_not_configured',
    );
  }
  return admin;
}

/** GET /api/integrations/catalog — CRMs Atmosphere knows how to talk to. */
integrationsRouter.get('/catalog', async (_req: Request, res: Response) => {
  res.json({
    systems: listCatalog(),
    vaultConfigured: integrationsVaultConfigured(),
    envPrefix: config.integrations.credentialEnvPrefix,
  });
});

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

/**
 * POST /api/integrations/connect — connect a catalog CRM from the UI.
 *
 * Merges catalog defaults with the caller's base URL / sandbox flag, seals any
 * credentials, and creates the source row. Secrets are never returned.
 */
integrationsRouter.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const parsed = connectCrmSchema.parse(req.body);
    const entry = catalogEntry(parsed.system);

    if (!entry) {
      throw new HttpError(
        400,
        `Unknown CRM "${parsed.system}". Use GET /api/integrations/catalog for the list, or system "rest" / "csv".`,
        'unknown_crm',
      );
    }

    const label = parsed.label?.trim() || entry.name;
    const configRow: Record<string, unknown> = {
      ...entry.defaultConfig,
      ...(parsed.config ?? {}),
    };

    if (parsed.baseUrl) configRow.baseUrl = parsed.baseUrl;
    if (parsed.credentials?.baseUrl) configRow.baseUrl = parsed.credentials.baseUrl;
    if (parsed.credentials?.instanceUrl) {
      configRow.baseUrl = parsed.credentials.instanceUrl;
      configRow.instanceUrl = parsed.credentials.instanceUrl;
    }
    if (parsed.sandbox !== undefined) configRow.sandbox = parsed.sandbox;
    if (
      parsed.sandbox === undefined &&
      !parsed.credentials &&
      !parsed.credentialRef &&
      entry.supportsSandbox
    ) {
      configRow.sandbox = true;
    }

    const row: Record<string, unknown> = {
      org_id: orgId,
      created_by: userId,
      system: entry.id,
      label,
      kind: entry.kind,
      config: configRow,
      direction: parsed.direction,
      enabled: true,
      sync_interval_minutes: parsed.syncIntervalMinutes,
      credential_ref: parsed.credentialRef ?? null,
    };

    if (parsed.credentials) {
      const secret: IntegrationSecret = {};
      for (const [key, value] of Object.entries(parsed.credentials)) {
        if (typeof value === 'string' && value.trim()) {
          (secret as Record<string, string>)[key] = value.trim();
        }
      }
      if (Object.keys(secret).length > 0) {
        const sealed = sealIntegrationSecret(secret);
        row.credential_ciphertext = sealed.ciphertext;
        row.credential_iv = sealed.iv;
        row.credential_auth_tag = sealed.authTag;
        row.credential_fingerprint = sealed.fingerprint;
      }
    }

    const { data, error } = await supabase
      .from('crm_external_sources')
      .insert(row)
      .select('*')
      .single();

    if (error) throw new HttpError(400, error.message, 'connect_failed');
    res.status(201).json({ source: serializeSource(data), catalog: entry });
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
 * Cascades to the mirrored records. Requires `?purge=true` to delete the copy.
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

async function assertOwnsSource(req: Request): Promise<{
  orgId: string;
  userId: string;
  source: Record<string, any>;
  supabase: any;
}> {
  const { orgId, userId, supabase } = await requireOrgContext(req);
  const { data, error } = await supabase
    .from('crm_external_sources')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'source_read_failed');
  if (!data) throw new HttpError(404, 'Not found', 'not_found');
  return { orgId, userId, source: data, supabase };
}

/** POST /api/integrations/sources/:id/sync — pull now. */
integrationsRouter.post(
  '/sources/:id/sync',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId } = await assertOwnsSource(req);
      const promote = req.query.promote === 'true' || req.body?.promote === true;

      const result = await syncSource({
        sourceId: req.params.id,
        trigger: 'manual',
        startedBy: userId,
      });

      let promotion = null;
      if (promote && result.status !== 'failed') {
        const admin = adminOrThrow();
        promotion = await promoteSourceToCrm({
          admin,
          orgId,
          sourceId: req.params.id,
          userId,
        });
      }

      res.status(result.status === 'failed' ? 502 : 200).json({ sync: result, promotion });
    } catch (err) {
      if (err instanceof IntegrationsNotConfiguredError) {
        next(new HttpError(503, err.message, 'integrations_not_configured'));
        return;
      }
      next(err);
    }
  },
);

/** POST /api/integrations/sources/:id/promote — map mirror → native CRM. */
integrationsRouter.post(
  '/sources/:id/promote',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId } = await assertOwnsSource(req);
      const admin = adminOrThrow();
      const stats = await promoteSourceToCrm({
        admin,
        orgId,
        sourceId: req.params.id,
        userId,
      });
      res.json({ promotion: stats });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/integrations/sources/:id/push — write into the connected CRM. */
integrationsRouter.post(
  '/sources/:id/push',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, source } = await assertOwnsSource(req);
      const input = pushCrmSchema.parse(req.body);
      const admin = adminOrThrow();
      const auth = resolveSourceAuth(source);

      const result = await pushToCrm({
        admin,
        orgId,
        sourceId: source.id,
        userId,
        system: String(source.system).toLowerCase(),
        config: (source.config ?? {}) as Record<string, unknown>,
        secret: auth.secret,
        token: auth.token,
        input: {
          operation: input.operation,
          entityType: input.entityType ?? undefined,
          externalId: input.externalId ?? undefined,
          contactId: input.contactId ?? undefined,
          subject: input.subject ?? undefined,
          body: input.body ?? undefined,
          fields: input.fields,
        },
      });

      res.status(result.status === 'failed' ? 502 : 200).json({ push: result });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/integrations/sources/:id/import — mirror a CSV export. */
integrationsRouter.post(
  '/sources/:id/import',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId } = await assertOwnsSource(req);
      const { entityType, csv, idColumn, delimiter } = csvImportSchema.parse(req.body);

      const parsed = recordsFromCsv(csv, { entityType, idColumn, delimiter });

      const result = await syncSource({
        sourceId: req.params.id,
        trigger: 'manual',
        startedBy: userId,
        manualRecords: parsed.records,
      });

      const promote = req.query.promote === 'true' || req.body?.promote === true;
      let promotion = null;
      if (promote && result.status !== 'failed') {
        const admin = adminOrThrow();
        promotion = await promoteSourceToCrm({
          admin,
          orgId,
          sourceId: req.params.id,
          userId,
        });
      }

      res.status(result.status === 'failed' ? 502 : 200).json({
        sync: result,
        promotion,
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

/** GET /api/integrations/sources/:id/runs */
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

/** GET /api/integrations/sources/:id/pushes */
integrationsRouter.get(
  '/sources/:id/pushes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { limit, offset } = listQuerySchema.parse(req.query);

      const { data, error, count } = await supabase
        .from('crm_push_runs')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('source_id', req.params.id)
        .order('started_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw new HttpError(500, error.message, 'pushes_failed');

      res.json({
        pushes: (data ?? []).map((r: any) => ({
          id: r.id,
          status: r.status,
          operation: r.operation,
          entityType: r.entity_type,
          externalId: r.external_id,
          error: r.error,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        })),
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/integrations/records — the mirror itself. */
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

/* ---- Connecting a customer's own CRM ------------------------------------- */

/**
 * The OAuth dance, and why it is worth the extra endpoints.
 *
 * The alternative — take the customer's Salesforce password and drive a
 * browser with it — is one form field and no callback. It is also their entire
 * Salesforce org in our database, their MFA defeated, and a credential that
 * breaks the next time they rotate it. OAuth costs three endpoints and gives a
 * scoped grant they can revoke from their own admin screen without telling us.
 *
 * `state` is the load-bearing part. It ties the callback to the org that
 * started the flow and expires quickly; without it, anyone who could reach the
 * callback URL could attach their own Salesforce to somebody else's
 * organization and start reading what syncs back.
 */

/** Pending flows, held in memory: short-lived by design and fine to lose. */
const pendingStates = new Map<string, { orgId: string; userId: string; expiresAt: number }>();

function newState(orgId: string, userId: string): string {
  // Sweep on write — the map is small and this avoids a timer that would keep
  // a process alive purely to tidy up.
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (value.expiresAt < now) pendingStates.delete(key);
  }
  const state = randomBytes(24).toString('base64url');
  pendingStates.set(state, { orgId, userId, expiresAt: now + 10 * 60_000 });
  return state;
}

function redirectUri(): string {
  return `${config.frontendOrigins[0]}/settings?section=integrations&oauth=salesforce`;
}

/** GET /api/integrations/crm — what is connected, and what could be. */
integrationsRouter.get('/crm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const connected = config.integrations.oauthKey ? await listGrants(orgId) : [];
    res.json({
      available: KNOWN_CRMS,
      connected,
      // The UI has to be able to explain *why* a button is disabled rather
      // than just disabling it.
      salesforceConfigured: Boolean(config.integrations.salesforce.clientId),
      browserCrmEnabled: config.integrations.browserCrmEnabled,
      vaultConfigured: Boolean(config.integrations.oauthKey),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/integrations/crm/salesforce/connect — begin authorisation. */
integrationsRouter.post(
  '/crm/salesforce/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId } = await requireGlobalAdmin(req);

      if (!config.integrations.salesforce.clientId) {
        throw new HttpError(
          503,
          'Salesforce is not configured on this deployment.',
          'salesforce_not_configured',
        );
      }
      if (!config.integrations.oauthKey) {
        // Better to refuse than to store a refresh token we cannot seal.
        throw new HttpError(
          503,
          'Connecting a CRM needs INTEGRATIONS_OAUTH_KEY so the grant can be encrypted at rest.',
          'vault_not_configured',
        );
      }

      res.json({ url: authorizeUrl(newState(orgId, userId), redirectUri()) });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/integrations/crm/salesforce/callback — finish authorisation. */
integrationsRouter.post(
  '/crm/salesforce/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requireGlobalAdmin(req);
      const { code, state } = z
        .object({ code: z.string().min(1), state: z.string().min(1) })
        .parse(req.body ?? {});

      const pending = pendingStates.get(state);
      pendingStates.delete(state);
      if (!pending || pending.expiresAt < Date.now()) {
        throw new HttpError(
          400,
          'That authorization has expired. Start again from Settings.',
          'state_expired',
        );
      }

      const grant = await exchangeCode(code, redirectUri());
      await saveGrant(pending.orgId, pending.userId, { system: 'salesforce', ...grant });

      // A source row is what the sync scheduler walks; without one the grant
      // exists and nothing ever pulls anything through it.
      const admin = createAdminClient();
      if (admin) {
        await admin.from('crm_integration_sources').upsert(
          {
            org_id: pending.orgId,
            system: 'salesforce',
            kind: 'salesforce',
            config: { orgId: pending.orgId },
            enabled: true,
          },
          { onConflict: 'org_id,system' },
        );
      }

      res.json({ connected: true, accountLabel: grant.accountLabel });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/integrations/crm/salesforce — revoke, then forget. */
integrationsRouter.delete(
  '/crm/salesforce',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireGlobalAdmin(req);

      // Revoke at Salesforce first. Deleting our copy stops us using it; only
      // revocation stops it working, and a disconnect that skipped this would
      // leave a live grant in their org with our name on it.
      const grant = await loadGrant(orgId, 'salesforce');
      let revoked = false;
      if (grant) revoked = await revoke(grant.refreshToken);

      await deleteGrant(orgId, 'salesforce');

      const admin = createAdminClient();
      if (admin) {
        await admin
          .from('crm_integration_sources')
          .update({ enabled: false })
          .eq('org_id', orgId)
          .eq('system', 'salesforce');
      }

      // Reported honestly: if revocation failed the customer should revoke it
      // themselves rather than assume we handled it.
      res.json({ disconnected: true, revokedAtSalesforce: revoked });
    } catch (err) {
      next(err);
    }
  },
);
