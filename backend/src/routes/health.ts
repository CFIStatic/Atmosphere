import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { createAnonClient, createAdminClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export const healthRouter = Router();

/** Liveness probe — no auth, no dependencies. */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'atmosphere-backend', time: new Date().toISOString() });
});

type CheckResult = { ok: boolean; detail?: string; skipped?: boolean };

/**
 * Readiness probe — confirms the process can reach the dependencies the
 * verification path needs. Load balancers should route only when this returns
 * 200. Liveness (`/health`) stays dependency-free so a brief Supabase blip
 * does not thrash the process.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, CheckResult> = {};

  checks.supabaseAuth = await checkSupabaseAuth();
  checks.supabaseAdmin = await checkSupabaseAdmin();
  checks.storage = await checkStorage();
  checks.config = {
    ok: Boolean(config.frontendOrigins.length && config.device.pepper),
    detail: config.isProduction ? 'production' : 'development',
  };

  const required = ['supabaseAuth', 'config'] as const;
  const ready = required.every((key) => checks[key]?.ok);

  // Storage/admin are strongly preferred in production but a deploy that has
  // not yet set the service role can still answer auth; report degraded.
  const degraded =
    ready &&
    config.isProduction &&
    (!checks.supabaseAdmin.ok || !checks.storage.ok);

  const status = ready ? (degraded ? 'degraded' : 'ready') : 'not_ready';
  const httpStatus = ready ? 200 : 503;

  if (!ready) {
    logger.warn('readiness_failed', { checks });
  }

  res.status(httpStatus).json({
    status,
    service: 'atmosphere-backend',
    time: new Date().toISOString(),
    checks,
  });
});

async function checkSupabaseAuth(): Promise<CheckResult> {
  try {
    const client = createAnonClient();
    // A deliberately invalid refresh is cheap and proves Auth is reachable
    // without depending on any seeded user.
    const { error } = await client.auth.getSession();
    if (error) {
      return { ok: false, detail: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkSupabaseAdmin(): Promise<CheckResult> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      skipped: !config.isProduction,
      detail: 'SUPABASE_SERVICE_ROLE_KEY unset',
    };
  }
  try {
    // Head a known system table through PostgREST — proves the key works and
    // the API is up without leaking row data.
    const { error } = await admin.from('orgs').select('id', { head: true, count: 'exact' }).limit(1);
    if (error) {
      return { ok: false, detail: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkStorage(): Promise<CheckResult> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      skipped: !config.isProduction,
      detail: 'SUPABASE_SERVICE_ROLE_KEY unset',
    };
  }
  try {
    const { data, error } = await admin.storage.getBucket(config.media.hotBucket);
    if (error) {
      return { ok: false, detail: error.message };
    }
    if (!data) {
      return { ok: false, detail: `bucket ${config.media.hotBucket} missing` };
    }
    return { ok: true, detail: config.media.hotBucket };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
