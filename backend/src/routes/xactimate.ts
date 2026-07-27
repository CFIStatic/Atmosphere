import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import {
  ALL_SCOPES,
  ConsentError,
  DEFAULT_SCOPES,
  SCOPE_DESCRIPTIONS,
  connections,
  createConsent,
  createDriver,
  isLive,
  isVaultConfigured,
  openCredential,
  requireConnection,
  sealCredential,
  type ConsentScope,
  type XactimateDriver,
} from '../estimator/mitigation/xactimate/index.js';
import {
  priceListSyncSchema,
  priceListUploadSchema,
  pushEstimateSchema,
  xactimateConnectSchema,
} from '../estimator/mitigation/validation.js';
import {
  getConnection,
  getPriceList,
  listAudit,
  recordAudit,
  resolveOrgId,
  revokeConnection,
  savePriceList,
  saveConnection,
} from '../estimator/mitigation/store.js';
import type { MitigationEstimate } from '../estimator/mitigation/types.js';

export const xactimateRouter = Router();

xactimateRouter.use(requireAuth);

/**
 * Sign-in attempts are metered hard.
 *
 * These attempts land on a *third party's* login. A retry loop here does not
 * just waste our resources — it walks a restoration company's Xactimate account
 * into a lockout in the middle of a job, which is a genuinely expensive failure
 * for them. Five attempts per fifteen minutes is deliberately tighter than the
 * app's own login limiter.
 */
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many Xactimate sign-in attempts. Wait 15 minutes — repeated failures can lock your Xactimate account.',
    code: 'rate_limited',
  },
});

/** Flush a driver's audit entries to the database. Never throws. */
async function flushAudit(req: Request, driver: XactimateDriver): Promise<void> {
  const supabase = createUserClient(req.accessToken!);
  await recordAudit(supabase, driver.drainAudit());
}

/**
 * GET /api/xactimate/status
 *
 * What the UI needs to render the connection card, and nothing more. No
 * credential, in any form, ever leaves the server — the username is returned
 * only so the user can confirm which account is linked.
 */
xactimateRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const record = await getConnection(supabase, userId);
    const live = isLive(record?.grant ?? null);

    res.json({
      connected: live,
      sessionActive: Boolean(connections.get(userId)),
      driver: config.xactimate.driver,
      storageAvailable: isVaultConfigured(),
      webAutomationEnabled: config.xactimate.webAutomationEnabled,
      username: record?.grant.xactimateUsername ?? null,
      scopes: live ? record!.grant.scopes : [],
      storageMode: record?.grant.storageMode ?? 'session',
      grantedAt: record?.grant.grantedAt ?? null,
      expiresAt: record?.grant.expiresAt ?? null,
      revokedAt: record?.grant.revokedAt ?? null,
      priceListId: record?.priceListId ?? null,
      availableScopes: ALL_SCOPES.map((scope) => ({
        scope,
        description: SCOPE_DESCRIPTIONS[scope],
        defaultGranted: DEFAULT_SCOPES.includes(scope),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/xactimate/connect
 *
 * Sign in to the user's Xactimate account, under an explicit, scoped, expiring
 * grant. The password is used for this operation and, unless the user
 * deliberately chose at-rest storage, is never written anywhere.
 */
xactimateRouter.post(
  '/connect',
  connectLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = xactimateConnectSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const orgId = await resolveOrgId(supabase, userId);

      if (input.storageMode === 'stored' && !isVaultConfigured()) {
        throw new HttpError(
          400,
          'This server cannot store Xactimate credentials — XACTIMATE_ENC_KEY is not set. Connect in session-only mode instead, which is the safer option regardless.',
          'vault_unavailable',
        );
      }

      const grant = createConsent({
        userId,
        orgId,
        xactimateUsername: input.username,
        scopes: input.scopes as ConsentScope[],
        storageMode: input.storageMode,
        days: input.consentDays,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      const driver = createDriver();
      const result = await driver.connect(
        { username: input.username, password: input.password, mfaCode: input.mfaCode },
        grant,
      );
      await flushAudit(req, driver);

      if (result.status === 'mfa_required') {
        res.status(202).json({
          status: 'mfa_required',
          challengeId: result.challengeId,
          message: result.message,
        });
        return;
      }

      if (result.status === 'failed') {
        throw new HttpError(401, result.message, result.code);
      }

      // Only now, after Xactimate itself has accepted the credentials, is the
      // grant recorded — a grant for a login that does not work is noise.
      const sealed =
        input.storageMode === 'stored' ? sealCredential(input.password, userId) : null;
      await saveConnection(supabase, grant, sealed);

      connections.put(userId, result.session, driver);

      res.status(201).json({
        status: 'connected',
        profile: result.profile,
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
        storageMode: grant.storageMode,
      });
    } catch (err) {
      next(err instanceof ConsentError ? new HttpError(403, err.message, err.code) : err);
    }
  },
);

/**
 * POST /api/xactimate/disconnect
 *
 * Ends the live session and destroys any stored credential in the same
 * statement that marks the grant revoked. There is no window where a revoked
 * grant still has a usable password behind it.
 */
xactimateRouter.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    await connections.close(userId);
    await revokeConnection(supabase, userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/xactimate/price-lists — the price lists the account can see. */
xactimateRouter.get('/price-lists', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const record = await getConnection(supabase, userId);
    const { session, driver } = requireConnection(userId, record?.grant ?? null);

    const lists = await driver.fetchPriceLists(session, record!.grant);
    await flushAudit(req, driver);

    res.json({ priceLists: lists, selected: record?.priceListId ?? null });
  } catch (err) {
    next(err instanceof ConsentError ? new HttpError(403, err.message, err.code) : err);
  }
});

/**
 * POST /api/xactimate/price-lists/sync
 *
 * Pull the real price list and make it the org's. This is the step that turns
 * every placeholder price in the seeded catalog into a real one — until it runs,
 * the estimator flags every line as unverified.
 */
xactimateRouter.post(
  '/price-lists/sync',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { priceListId } = priceListSyncSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const orgId = await resolveOrgId(supabase, userId);

      const record = await getConnection(supabase, userId);
      const { session, driver } = requireConnection(userId, record?.grant ?? null);

      const priceList = await driver.fetchPriceList(session, record!.grant, priceListId);
      await flushAudit(req, driver);

      await savePriceList(supabase, orgId, userId, priceList);

      res.json({
        priceListId: priceList.id,
        name: priceList.name,
        effectiveDate: priceList.effectiveDate ?? null,
        entryCount: priceList.entries.length,
      });
    } catch (err) {
      next(err instanceof ConsentError ? new HttpError(403, err.message, err.code) : err);
    }
  },
);

/**
 * POST /api/xactimate/price-lists/upload
 *
 * The no-login path: export the price list from Xactimate and upload it. Orgs
 * without API access get real prices this way without any credential ever
 * changing hands, which is why the browser driver refuses to scrape one.
 */
xactimateRouter.post(
  '/price-lists/upload',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = priceListUploadSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const orgId = await resolveOrgId(supabase, userId);

      await savePriceList(supabase, orgId, userId, {
        id: input.id,
        name: input.name,
        effectiveDate: input.effectiveDate,
        entries: input.entries,
      });

      res.status(201).json({ priceListId: input.id, entryCount: input.entries.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/xactimate/push
 *
 * Write the estimate into the user's Xactimate account.
 *
 * Two gates before anything is written. The grant must carry `write_estimate`,
 * which is not granted by default. And the caller must have acknowledged the
 * profitability findings — pushing an estimate with unpriced lines or
 * undocumented demolition into a real account is how a bad estimate becomes a
 * submitted one.
 */
xactimateRouter.post('/push', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = pushEstimateSchema.parse(req.body);
    const estimate = input.estimate as MitigationEstimate;

    if (!Array.isArray(estimate?.lineItems) || estimate.lineItems.length === 0) {
      throw new HttpError(400, 'That estimate has no line items to write.', 'empty_estimate');
    }

    // A breach of a binding program term is not a judgement call the user can
    // confirm past. The carrier will not pay a line the agreement prohibits, and
    // writing it into the account produces a chargeback with the franchise's
    // name on it. Either bring the estimate inside the terms, or record a
    // documented deviation — which is exactly what the deviation route is for.
    if (estimate.sla?.blocksSubmission) {
      const breaches = estimate.sla.checks.filter(
        (check) => check.status === 'violated' && check.severity === 'hard',
      );
      res.status(409).json({
        status: 'sla_blocked',
        message: `This estimate breaches ${breaches.length} binding ${estimate.sla.agreement?.programName ?? 'program'} term${breaches.length === 1 ? '' : 's'}. Resolve them, or record a documented deviation for each with the evidence that justifies it.`,
        checks: breaches,
        proposedDeviations: estimate.sla.proposedDeviations,
      });
      return;
    }

    const blocking = estimate.profitability?.findings?.filter(
      (finding) => finding.severity === 'critical',
    ) ?? [];

    if (blocking.length > 0 && !input.confirmedFindings) {
      res.status(409).json({
        status: 'confirmation_required',
        message: `This estimate has ${blocking.length} critical finding${blocking.length === 1 ? '' : 's'} outstanding. Review them, then push again with confirmedFindings.`,
        findings: blocking,
      });
      return;
    }

    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const record = await getConnection(supabase, userId);
    const { session, driver } = requireConnection(userId, record?.grant ?? null);

    const result = await driver.createEstimate(session, record!.grant, estimate);
    await flushAudit(req, driver);

    res.status(201).json(result);
  } catch (err) {
    next(err instanceof ConsentError ? new HttpError(403, err.message, err.code) : err);
  }
});

/**
 * GET /api/xactimate/activity
 *
 * Everything done in the user's Xactimate account under their grant. A
 * permission the user cannot inspect the use of is not really a permission.
 */
xactimateRouter.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    res.json({ activity: await listAudit(supabase, req.user!.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/xactimate/resume
 *
 * Re-establish a live session from a stored credential, for users who opted into
 * at-rest storage. Session-only users cannot use this — by design; the whole
 * point of session-only is that there is nothing to resume from.
 */
xactimateRouter.post(
  '/resume',
  connectLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const record = await getConnection(supabase, userId);

      if (!isLive(record?.grant ?? null)) {
        throw new HttpError(
          403,
          'Your Xactimate authorisation has expired. Connect the account again.',
          'consent_expired',
        );
      }
      if (record!.grant.storageMode !== 'stored' || !record!.sealedCredential) {
        throw new HttpError(
          400,
          'This connection is session-only, so there is no stored password to sign in with. Enter your Xactimate password to reconnect.',
          'session_only_connection',
        );
      }

      const password = openCredential(record!.sealedCredential, userId);
      const driver = createDriver();
      const result = await driver.connect(
        { username: record!.grant.xactimateUsername, password },
        record!.grant,
      );
      await flushAudit(req, driver);

      if (result.status !== 'connected') {
        throw new HttpError(
          401,
          result.status === 'mfa_required'
            ? 'Xactimate asked for a verification code, which a stored password cannot supply. Reconnect and enter the code.'
            : result.message,
          result.status === 'mfa_required' ? 'mfa_required' : result.code,
        );
      }

      connections.put(userId, result.session, driver);
      res.json({ status: 'connected', profile: result.profile });
    } catch (err) {
      next(err instanceof ConsentError ? new HttpError(403, err.message, err.code) : err);
    }
  },
);

/** GET /api/xactimate/price-list — the org's currently synced list, if any. */
xactimateRouter.get('/price-list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const orgId = await resolveOrgId(supabase, userId);
    const record = await getConnection(supabase, userId);

    if (!record?.priceListId) {
      res.json({ priceList: null });
      return;
    }

    const priceList = await getPriceList(supabase, orgId, record.priceListId);
    res.json({
      priceList: priceList
        ? {
            id: priceList.id,
            name: priceList.name,
            effectiveDate: priceList.effectiveDate ?? null,
            entryCount: priceList.entries.length,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});
