import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { webAccessEnabled } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { toOrgProductRole } from '../lib/productRoles.js';
import {
  connectAppConnectorSchema,
  startConnectorRunSchema,
  updateAppConnectorSchema,
} from '../lib/validation.js';
import {
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_CATEGORY_ORDER,
  CONNECTOR_ACCESS_MODE_LABELS,
  filterCatalogForContractorType,
  getConnectorDefinition,
  listConnectorCatalog,
  type ConnectorAccessMode,
  type ConnectorDefinition,
} from '../lib/connectors/catalog.js';
import { assertUsableSiteUrl } from '../lib/webUrlGuard.js';
import { sealSecret } from '../lib/webVault.js';
import { hasRunCapacity, startRun, type ConnectionRecord } from '../lib/webRunner.js';
import { credentialStorageAvailable } from '../estimator/credentials.js';
import * as estimatorStore from '../estimator/store.js';

/**
 * App Connectors — curated third-party apps for restoration, roofing, and
 * contractor teams. Connecting an app either creates a Web Access login, marks
 * a Computer Use target, or stores an Estimator API credential — then records
 * the link in `app_connectors` so the catalog UI can show what is connected.
 */

export const connectorsRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

connectorsRouter.use(requireAuth);

const runLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many connector runs started. Wait a few minutes and try again.',
    code: 'rate_limited',
  },
});

async function callerOrgContext(req: Request): Promise<{
  orgId: string;
  role: string;
  contractorType: string | null;
  supabase: ReturnType<typeof createUserClient>;
}> {
  const supabase = createUserClient(req.accessToken!);
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role, orgs(contractor_type)')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new HttpError(500, error.message, 'connectors_org_lookup_failed');
  const row = data?.[0] as
    | {
        org_id: string;
        role: string;
        orgs: { contractor_type: string | null } | { contractor_type: string | null }[] | null;
      }
    | undefined;
  if (!row?.org_id) {
    throw new HttpError(400, 'Join an organization before using Connectors.', 'connectors_no_org');
  }

  const org = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs;

  return {
    orgId: row.org_id,
    role: row.role,
    contractorType: org?.contractor_type ?? null,
    supabase,
  };
}

function serializeDefinition(def: ConnectorDefinition) {
  return {
    key: def.key,
    name: def.name,
    blurb: def.blurb,
    category: def.category,
    accessModes: def.accessModes,
    contractorTypes: def.contractorTypes,
    siteUrl: def.siteUrl ?? null,
    loginUrl: def.loginUrl ?? null,
    estimatorProvider: def.estimatorProvider ?? null,
    computerAppHint: def.computerAppHint ?? null,
    taskTemplates: def.taskTemplates,
  };
}

function serializeConnection(row: any, def?: ConnectorDefinition) {
  return {
    id: row.id,
    connectorKey: row.connector_key,
    accessMode: row.access_mode as ConnectorAccessMode,
    label: row.label,
    status: row.status,
    webConnectionId: row.web_connection_id ?? null,
    estimatorProvider: row.estimator_provider ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    definition: def ? serializeDefinition(def) : null,
  };
}

function canManageApiCredentials(role: string): boolean {
  const seat = toOrgProductRole(role);
  return seat === 'global_admin' || seat === 'employee';
}

/**
 * GET /api/connectors/catalog
 * Curated apps, optionally filtered to the caller's contractor type.
 * Pass ?all=1 to see every entry regardless of industry.
 */
connectorsRouter.get('/catalog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contractorType } = await callerOrgContext(req);
    const showAll = req.query.all === '1' || req.query.all === 'true';
    const catalog = showAll
      ? listConnectorCatalog()
      : filterCatalogForContractorType(contractorType);

    res.json({
      categories: CONNECTOR_CATEGORY_ORDER.map((id) => ({
        id,
        label: CONNECTOR_CATEGORY_LABELS[id],
      })),
      accessModes: (['web', 'computer', 'api'] as const).map((id) => ({
        id,
        label: CONNECTOR_ACCESS_MODE_LABELS[id],
      })),
      contractorType,
      capabilities: {
        webAccessEnabled,
        computerUseAvailable: true,
        estimatorCredentialStorageAvailable: credentialStorageAvailable(),
      },
      connectors: catalog.map(serializeDefinition),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/connectors/connections
 * Every catalog app this organization has connected.
 */
connectorsRouter.get('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await callerOrgContext(req);
    const { data, error } = await supabase
      .from('app_connectors')
      .select(
        'id, connector_key, access_mode, label, status, web_connection_id, estimator_provider, notes, created_at, updated_at',
      )
      .order('created_at', { ascending: false });

    if (error) throw new HttpError(500, error.message, 'connectors_list_failed');

    res.json({
      connections: (data ?? []).map((row) =>
        serializeConnection(row, getConnectorDefinition(row.connector_key as string)),
      ),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connectors/connections
 * Connect a catalog app. Mode determines what else is created:
 *   • web — creates a Web Access connection (username/password required)
 *   • api — stores Estimator credentials (api key or username/password)
 *   • computer — records the link; runs happen on a paired machine
 */
connectorsRouter.post('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = connectAppConnectorSchema.parse(req.body);
    const def = getConnectorDefinition(input.connectorKey);
    if (!def) {
      throw new HttpError(404, 'That connector is not in the catalog.', 'connectors_unknown');
    }
    if (!def.accessModes.includes(input.accessMode)) {
      throw new HttpError(
        400,
        `${def.name} does not support ${CONNECTOR_ACCESS_MODE_LABELS[input.accessMode]}.`,
        'connectors_mode_unsupported',
      );
    }

    const { orgId, role, supabase } = await callerOrgContext(req);
    const label = (input.label?.trim() || def.name).slice(0, 80);

    // Idempotent: replacing credentials on an already-connected app updates
    // the existing row rather than failing on the unique (org, key) constraint.
    const { data: existing } = await supabase
      .from('app_connectors')
      .select('id, web_connection_id, estimator_provider, access_mode')
      .eq('org_id', orgId)
      .eq('connector_key', def.key)
      .maybeSingle();

    let webConnectionId: string | null = existing?.web_connection_id ?? null;
    let estimatorProvider: string | null =
      existing?.estimator_provider ?? def.estimatorProvider ?? null;

    if (input.accessMode === 'web') {
      if (!webAccessEnabled) {
        throw new HttpError(
          503,
          'Web Access is not configured on this server.',
          'web_access_unconfigured',
        );
      }
      if (!input.username || !input.password) {
        throw new HttpError(
          400,
          'Username and password are required to connect via Web Access.',
          'connectors_credentials_required',
        );
      }

      const siteUrl = (input.siteUrl || def.siteUrl || '').trim();
      if (!siteUrl) {
        throw new HttpError(400, 'A site address is required.', 'connectors_site_url_required');
      }
      await assertUsableSiteUrl(siteUrl);
      const loginUrl = (input.loginUrl || def.loginUrl || undefined)?.trim() || undefined;
      if (loginUrl) await assertUsableSiteUrl(loginUrl);

      if (webConnectionId) {
        const sealed = sealSecret(input.password);
        const { error: updateError } = await supabase
          .from('web_connections')
          .update({
            label,
            site_url: siteUrl,
            login_url: loginUrl ?? null,
            username: input.username,
            status: 'unverified',
            last_error: null,
          })
          .eq('id', webConnectionId);
        if (updateError) {
          throw new HttpError(400, updateError.message, 'connectors_web_update_failed');
        }
        const { error: credentialError } = await supabase.from('web_credentials').upsert(
          {
            connection_id: webConnectionId,
            org_id: orgId,
            ciphertext: sealed.ciphertext,
            iv: sealed.iv,
            auth_tag: sealed.authTag,
            key_version: sealed.keyVersion,
          },
          { onConflict: 'connection_id' },
        );
        if (credentialError) {
          throw new HttpError(500, credentialError.message, 'connectors_web_update_failed');
        }
      } else {
        const { data: webRow, error: webError } = await supabase
          .from('web_connections')
          .insert({
            org_id: orgId,
            created_by: req.user!.id,
            label,
            site_url: siteUrl,
            login_url: loginUrl ?? null,
            username: input.username,
          })
          .select('id')
          .single();

        if (webError) {
          const message = /duplicate key/i.test(webError.message)
            ? 'A Web Access connection with that name already exists. Rename it or remove the old one.'
            : webError.message;
          throw new HttpError(400, message, 'connectors_web_create_failed');
        }

        const sealed = sealSecret(input.password);
        const { error: credentialError } = await supabase.from('web_credentials').insert({
          connection_id: webRow.id,
          org_id: orgId,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          auth_tag: sealed.authTag,
          key_version: sealed.keyVersion,
        });
        if (credentialError) {
          await supabase.from('web_connections').delete().eq('id', webRow.id);
          throw new HttpError(500, credentialError.message, 'connectors_web_create_failed');
        }
        webConnectionId = webRow.id as string;
      }
    }

    if (input.accessMode === 'api') {
      if (!def.estimatorProvider) {
        throw new HttpError(
          400,
          `${def.name} does not have an API connector.`,
          'connectors_api_unavailable',
        );
      }
      if (!canManageApiCredentials(role)) {
        throw new HttpError(
          403,
          'Only a Global Admin or Employee can connect API credentials.',
          'connectors_forbidden',
        );
      }
      if (!credentialStorageAvailable()) {
        throw new HttpError(
          503,
          'Credential storage is not configured on this server.',
          'connectors_credential_storage_unconfigured',
        );
      }
      if (!input.apiKey && !(input.username && input.password)) {
        throw new HttpError(
          400,
          'Provide an API key, or a username and password.',
          'connectors_credentials_required',
        );
      }

      await estimatorStore.saveCredential(supabase, {
        orgId,
        userId: req.user!.id,
        provider: def.estimatorProvider,
        label,
        secret: {
          username: input.username,
          password: input.password,
          apiKey: input.apiKey,
          accountId: input.accountId,
          baseUrl: input.baseUrl || def.siteUrl,
        },
      });
      estimatorProvider = def.estimatorProvider;
    }

    // Computer mode needs no secret here — the paired agent already has the
    // desktop session. Connecting just registers the app in the catalog.

    const payload = {
      org_id: orgId,
      created_by: req.user!.id,
      connector_key: def.key,
      access_mode: input.accessMode,
      label,
      status: 'connected',
      web_connection_id: webConnectionId,
      estimator_provider: estimatorProvider,
      notes: input.notes ?? null,
    };

    const { data, error } = existing
      ? await supabase
          .from('app_connectors')
          .update(payload)
          .eq('id', existing.id)
          .select(
            'id, connector_key, access_mode, label, status, web_connection_id, estimator_provider, notes, created_at, updated_at',
          )
          .single()
      : await supabase
          .from('app_connectors')
          .insert(payload)
          .select(
            'id, connector_key, access_mode, label, status, web_connection_id, estimator_provider, notes, created_at, updated_at',
          )
          .single();

    if (error) throw new HttpError(400, error.message, 'connectors_save_failed');

    res.status(existing ? 200 : 201).json({ connection: serializeConnection(data, def) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/connectors/connections/:id
 * Rename or annotate a connected app. Credential rotation goes back through POST.
 */
connectorsRouter.patch(
  '/connections/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = updateAppConnectorSchema.parse(req.body);
      const { supabase } = await callerOrgContext(req);

      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.status !== undefined) patch.status = input.status;

      const { data, error } = await supabase
        .from('app_connectors')
        .update(patch)
        .eq('id', req.params.id)
        .select(
          'id, connector_key, access_mode, label, status, web_connection_id, estimator_provider, notes, created_at, updated_at',
        )
        .maybeSingle();

      if (error) throw new HttpError(400, error.message, 'connectors_update_failed');
      if (!data) throw new HttpError(404, 'That connection no longer exists.', 'connectors_not_found');

      res.json({
        connection: serializeConnection(data, getConnectorDefinition(data.connector_key as string)),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/connectors/connections/:id
 * Removes the catalog link. Optionally tears down the backing Web Access
 * connection or Estimator credential when ?purge=true.
 */
connectorsRouter.delete(
  '/connections/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const purge = req.query.purge === '1' || req.query.purge === 'true';
      const { orgId, role, supabase } = await callerOrgContext(req);

      const { data: existing, error: readError } = await supabase
        .from('app_connectors')
        .select('id, access_mode, web_connection_id, estimator_provider')
        .eq('id', req.params.id)
        .maybeSingle();

      if (readError) throw new HttpError(500, readError.message, 'connectors_read_failed');
      if (!existing) {
        throw new HttpError(404, 'That connection no longer exists.', 'connectors_not_found');
      }

      const { error: deleteError } = await supabase
        .from('app_connectors')
        .delete()
        .eq('id', existing.id);
      if (deleteError) throw new HttpError(400, deleteError.message, 'connectors_delete_failed');

      if (purge) {
        if (existing.web_connection_id) {
          await supabase.from('web_connections').delete().eq('id', existing.web_connection_id);
        }
        if (existing.estimator_provider && canManageApiCredentials(role)) {
          await estimatorStore.deleteCredential(
            supabase,
            orgId,
            existing.estimator_provider as 'docusketch' | 'dash' | 'xactimate',
          );
        }
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/connectors/connections/:id/run
 * Start a Web Access task against a connected app (web mode only). Computer
 * and API modes redirect the UI to Computer Use / Estimator respectively.
 */
connectorsRouter.post(
  '/connections/:id/run',
  runLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = startConnectorRunSchema.parse(req.body);
      const { supabase } = await callerOrgContext(req);

      if (!webAccessEnabled) {
        throw new HttpError(
          503,
          'Web Access is not configured on this server.',
          'web_access_unconfigured',
        );
      }
      if (!hasRunCapacity()) {
        throw new HttpError(
          429,
          'Too many browser sessions are running right now. Try again shortly.',
          'web_access_busy',
        );
      }

      const { data: link, error } = await supabase
        .from('app_connectors')
        .select('id, connector_key, access_mode, web_connection_id, label')
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, 'connectors_read_failed');
      if (!link) throw new HttpError(404, 'That connection no longer exists.', 'connectors_not_found');
      if (link.access_mode !== 'web' || !link.web_connection_id) {
        throw new HttpError(
          400,
          'Only Web Access connectors can run tasks here. Use Computer Use or the Estimator for the other modes.',
          'connectors_run_unsupported',
        );
      }

      const def = getConnectorDefinition(link.connector_key as string);
      let instruction = input.instruction?.trim() ?? '';
      let kind = input.kind ?? 'pull';

      if (input.templateId && def) {
        const template = def.taskTemplates.find((t) => t.id === input.templateId);
        if (!template) {
          throw new HttpError(400, 'Unknown task template.', 'connectors_unknown_template');
        }
        kind = template.kind;
        instruction = instruction
          ? `${template.instruction}\n\nAdditional context from the user:\n${instruction}`
          : template.instruction;
      }

      if (!instruction || instruction.length < 4) {
        throw new HttpError(400, 'Describe the task.', 'connectors_instruction_required');
      }

      const { data: webRow, error: webErr } = await supabase
        .from('web_connections')
        .select('id, org_id, label, site_url, login_url, username')
        .eq('id', link.web_connection_id)
        .maybeSingle();

      if (webErr) throw new HttpError(500, webErr.message, 'connectors_web_read_failed');
      if (!webRow) {
        throw new HttpError(
          404,
          'The linked Web Access connection is missing. Reconnect this app.',
          'connectors_web_missing',
        );
      }

      const connection = webRow as ConnectionRecord;

      const { data: runRow, error: runError } = await supabase
        .from('web_runs')
        .insert({
          org_id: connection.org_id,
          connection_id: connection.id,
          created_by: req.user!.id,
          kind,
          instruction,
          input_data: input.data ?? null,
        })
        .select(
          'id, connection_id, kind, instruction, status, result, steps, error, started_at, finished_at, created_at',
        )
        .single();

      if (runError) throw new HttpError(400, runError.message, 'connectors_run_failed');

      startRun({
        accessToken: req.accessToken!,
        runId: runRow.id,
        connection,
        kind,
        instruction,
        inputData: input.data,
      });

      res.status(202).json({
        run: {
          id: runRow.id,
          connectionId: runRow.connection_id,
          kind: runRow.kind,
          instruction: runRow.instruction,
          status: runRow.status,
          result: runRow.result ?? null,
          steps: runRow.steps ?? [],
          error: runRow.error,
          startedAt: runRow.started_at,
          finishedAt: runRow.finished_at,
          createdAt: runRow.created_at,
        },
        workspace: '/web-access',
      });
    } catch (err) {
      next(err);
    }
  },
);
