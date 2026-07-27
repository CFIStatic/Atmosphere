import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config, webAccessEnabled } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import {
  createWebConnectionSchema,
  updateWebConnectionSchema,
  createWebRunSchema,
} from '../lib/validation.js';
import { sealSecret } from '../lib/webVault.js';
import { assertUsableSiteUrl } from '../lib/webUrlGuard.js';
import { hasRunCapacity, startRun, verifyConnection, type ConnectionRecord } from '../lib/webRunner.js';

/**
 * Web Access — connections to outside websites, and the runs performed against
 * them.
 *
 * Everything here is org-scoped through the caller's JWT: connections belong to
 * an organization, not to the member who added them, so a team shares one set
 * of portal logins the way they already share a join code.
 *
 * Stored passwords leave this API in exactly one direction — into the browser
 * that signs in with them. No response in this file ever carries one back.
 */

export const webAccessRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

webAccessRouter.use(requireAuth);

/**
 * A run costs a browser and a model call, so it is worth a good deal more than
 * an ordinary request. The limit is per-IP and generous enough that normal use
 * never meets it.
 */
const runLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many runs started. Wait a few minutes and try again.', code: 'rate_limited' },
});

function serializeConnection(row: any) {
  return {
    id: row.id,
    label: row.label,
    siteUrl: row.site_url,
    loginUrl: row.login_url,
    username: row.username,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function serializeRun(row: any) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    kind: row.kind,
    instruction: row.instruction,
    status: row.status,
    result: row.result ?? null,
    steps: row.steps ?? [],
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

/** The org the caller belongs to. Every row written here is stamped with it. */
async function callerOrgId(req: Request): Promise<string> {
  const supabase = createUserClient(req.accessToken!);
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new HttpError(500, error.message, 'web_access_org_lookup_failed');
  const orgId = data?.[0]?.org_id as string | undefined;
  if (!orgId) {
    throw new HttpError(400, 'Join an organization before using Web Access.', 'web_access_no_org');
  }
  return orgId;
}

/** Loads one connection. RLS does the authorising; a miss is simply "not found". */
async function loadConnection(req: Request, id: string): Promise<ConnectionRecord> {
  const supabase = createUserClient(req.accessToken!);
  const { data, error } = await supabase
    .from('web_connections')
    .select('id, org_id, label, site_url, login_url, username')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'web_access_connection_read_failed');
  if (!data) throw new HttpError(404, 'That connection no longer exists.', 'web_access_not_found');
  return data as ConnectionRecord;
}

function requireEnabled(): void {
  if (!webAccessEnabled) {
    throw new HttpError(
      503,
      'Web Access is not configured on this server.',
      'web_access_unconfigured',
    );
  }
}

/**
 * GET /api/web-access/status
 * Whether the feature is usable here, so the UI can explain itself rather than
 * failing at the first click.
 */
webAccessRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    enabled: webAccessEnabled,
    capacityAvailable: hasRunCapacity(),
    maxSteps: config.webAccess.maxSteps,
  });
});

/**
 * GET /api/web-access/connections
 * Every site the caller's organization has connected.
 */
webAccessRouter.get('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('web_connections')
      .select('id, label, site_url, login_url, username, status, last_verified_at, last_error, created_at')
      .order('created_at', { ascending: false });

    if (error) throw new HttpError(500, error.message, 'web_access_list_failed');
    res.json({ connections: (data ?? []).map(serializeConnection) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/web-access/connections
 * Connect a site. The password is sealed here and never read back out through
 * the API.
 */
webAccessRouter.post('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireEnabled();
    const input = createWebConnectionSchema.parse(req.body);
    await assertUsableSiteUrl(input.siteUrl);
    if (input.loginUrl) await assertUsableSiteUrl(input.loginUrl);

    const orgId = await callerOrgId(req);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('web_connections')
      .insert({
        org_id: orgId,
        created_by: req.user!.id,
        label: input.label,
        site_url: input.siteUrl,
        login_url: input.loginUrl ?? null,
        username: input.username,
      })
      .select('id, label, site_url, login_url, username, status, last_verified_at, last_error, created_at')
      .single();

    if (error) {
      const message = /duplicate key/i.test(error.message)
        ? 'A connection with that name already exists.'
        : error.message;
      throw new HttpError(400, message, 'web_access_create_failed');
    }

    const sealed = sealSecret(input.password);
    const { error: credentialError } = await supabase.from('web_credentials').insert({
      connection_id: data.id,
      org_id: orgId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.authTag,
      key_version: sealed.keyVersion,
    });

    if (credentialError) {
      // A connection without its password is unusable and confusing; leave
      // nothing behind rather than a half-made row.
      await supabase.from('web_connections').delete().eq('id', data.id);
      throw new HttpError(500, credentialError.message, 'web_access_create_failed');
    }

    res.status(201).json({ connection: serializeConnection(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/web-access/connections/:id
 * Edit a connection, including rotating its password on its own.
 */
webAccessRouter.patch('/connections/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireEnabled();
    const input = updateWebConnectionSchema.parse(req.body);
    const existing = await loadConnection(req, req.params.id);
    const supabase = createUserClient(req.accessToken!);

    if (input.siteUrl) await assertUsableSiteUrl(input.siteUrl);
    if (input.loginUrl) await assertUsableSiteUrl(input.loginUrl);

    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.siteUrl !== undefined) patch.site_url = input.siteUrl;
    if (input.loginUrl !== undefined) patch.login_url = input.loginUrl;
    if (input.username !== undefined) patch.username = input.username;
    // Any credential change invalidates what we knew about this login.
    if (input.password !== undefined || input.username !== undefined) {
      patch.status = 'unverified';
      patch.last_error = null;
    }

    const { data, error } = await supabase
      .from('web_connections')
      .update(patch)
      .eq('id', existing.id)
      .select('id, label, site_url, login_url, username, status, last_verified_at, last_error, created_at')
      .single();

    if (error) throw new HttpError(400, error.message, 'web_access_update_failed');

    if (input.password !== undefined) {
      const sealed = sealSecret(input.password);
      const { error: credentialError } = await supabase.from('web_credentials').upsert(
        {
          connection_id: existing.id,
          org_id: existing.org_id,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          auth_tag: sealed.authTag,
          key_version: sealed.keyVersion,
        },
        { onConflict: 'connection_id' },
      );
      if (credentialError) {
        throw new HttpError(500, credentialError.message, 'web_access_update_failed');
      }
    }

    res.json({ connection: serializeConnection(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/web-access/connections/:id
 * Removes the connection; the sealed password and the run history go with it.
 */
webAccessRouter.delete('/connections/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { error } = await supabase.from('web_connections').delete().eq('id', req.params.id);
    if (error) throw new HttpError(400, error.message, 'web_access_delete_failed');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/web-access/connections/:id/verify
 * Signs in once to confirm the credential still works.
 */
webAccessRouter.post(
  '/connections/:id/verify',
  runLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireEnabled();
      if (!hasRunCapacity()) {
        throw new HttpError(
          429,
          'Too many browser sessions are running right now. Try again shortly.',
          'web_access_busy',
        );
      }
      const connection = await loadConnection(req, req.params.id);
      const result = await verifyConnection(req.accessToken!, connection);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/web-access/runs
 * Starts a task. Returns as soon as the run is queued — the browser work
 * outlives the request, so the client polls the run for progress.
 */
webAccessRouter.post('/runs', runLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireEnabled();
    const input = createWebRunSchema.parse(req.body);

    if (!hasRunCapacity()) {
      throw new HttpError(
        429,
        'Too many browser sessions are running right now. Try again shortly.',
        'web_access_busy',
      );
    }

    const connection = await loadConnection(req, input.connectionId);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('web_runs')
      .insert({
        org_id: connection.org_id,
        connection_id: connection.id,
        created_by: req.user!.id,
        kind: input.kind,
        instruction: input.instruction,
        input_data: input.data ?? null,
      })
      .select('id, connection_id, kind, instruction, status, result, steps, error, started_at, finished_at, created_at')
      .single();

    if (error) throw new HttpError(400, error.message, 'web_access_run_failed');

    startRun({
      accessToken: req.accessToken!,
      runId: data.id,
      connection,
      kind: input.kind,
      instruction: input.instruction,
      inputData: input.data,
    });

    res.status(202).json({ run: serializeRun(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/web-access/runs
 * Recent runs for the caller's organization, newest first.
 */
webAccessRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('web_runs')
      .select('id, connection_id, kind, instruction, status, result, steps, error, started_at, finished_at, created_at')
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) throw new HttpError(500, error.message, 'web_access_runs_failed');
    res.json({ runs: (data ?? []).map(serializeRun) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/web-access/runs/:id
 * One run, with its full step trace. This is what the UI polls while a run is
 * in flight.
 */
webAccessRouter.get('/runs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('web_runs')
      .select('id, connection_id, kind, instruction, status, result, steps, error, started_at, finished_at, created_at')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message, 'web_access_run_read_failed');
    if (!data) throw new HttpError(404, 'That run no longer exists.', 'web_access_not_found');
    res.json({ run: serializeRun(data) });
  } catch (err) {
    next(err);
  }
});
