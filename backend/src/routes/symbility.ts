import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { resolveOrgId } from '../estimator/mitigation/store.js';
import {
  SYMBILITY_SCOPES,
  SYMBILITY_SCOPE_DESCRIPTIONS,
  SymbilityError,
  createGrant,
  createSymbilityDriver,
  getSymbilityConnection,
  grantIsLive,
  isSymbilityVaultConfigured,
  recordSymbilityAudit,
  revokeSymbilityConnection,
  saveSymbilityConnection,
  sealSymbilityCredential,
  symbilitySessions,
  type SymbilityScope,
} from '../estimator/symbility/index.js';

/**
 * The Symbility connection, as three verbs: status, connect, disconnect.
 *
 * Deliberately the same shape as the Xactimate routes — a person connecting
 * their second estimating platform should not have to learn a second set of
 * rules. Web login is the live path; the mock driver covers everything else.
 */

export const symbilityRouter = Router();
symbilityRouter.use(requireAuth);

/**
 * Same hard metering as Xactimate sign-ins, same reason: these attempts land
 * on a third party's login, and a retry loop walks a restoration company's
 * Claims Connect account into a lockout mid-job.
 */
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Too many Symbility sign-in attempts. Wait 15 minutes — repeated failures can lock your Claims Connect account.',
    code: 'rate_limited',
  },
});

const connectSchema = z.object({
  username: z
    .string({ required_error: 'Your Symbility username is required' })
    .trim()
    .min(3, 'Enter your Symbility username')
    .max(200),
  password: z
    .string({ required_error: 'Your Symbility password is required' })
    .min(1, 'Enter your Symbility password')
    .max(500),
  mfaCode: z.string().trim().regex(/^\d{4,8}$/, 'Enter the numeric code').optional(),
  scopes: z.array(z.enum(['read_profile', 'read_claims', 'write_estimate'])).min(1).max(10),
  storageMode: z.enum(['session', 'stored']).default('session'),
  consentDays: z.number().int().min(1).max(90).default(30),
  acknowledgedTerms: z.literal(true, {
    errorMap: () => ({
      message:
        'Confirm that automated access is permitted under your CoreLogic account terms.',
    }),
  }),
});

/** GET /api/symbility/status — what the card renders, and nothing more. */
symbilityRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const grant = await getSymbilityConnection(supabase, userId);
    const live = grantIsLive(grant);
    const session = symbilitySessions.get(userId);

    res.json({
      connected: live,
      sessionActive: Boolean(session),
      driver: config.symbility.driver,
      webAutomationEnabled: config.symbility.webAutomationEnabled,
      storageAvailable: isSymbilityVaultConfigured(),
      username: live ? grant.username : null,
      scopes: live ? grant.scopes : [],
      storageMode: live ? grant.storageMode : 'session',
      grantedAt: live ? grant.grantedAt : null,
      expiresAt: live ? grant.expiresAt : null,
      availableScopes: SYMBILITY_SCOPES.map((scope) => ({
        scope,
        ...SYMBILITY_SCOPE_DESCRIPTIONS[scope],
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/symbility/connect — web sign-in as the user, MFA-aware. */
symbilityRouter.post(
  '/connect',
  connectLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = connectSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const orgId = await resolveOrgId(supabase, userId).catch(() => null);

      if (input.storageMode === 'stored' && !isSymbilityVaultConfigured()) {
        throw new HttpError(
          400,
          'This server cannot store Symbility credentials — SYMBILITY_ENC_KEY is not set. Connect in session-only mode instead, which is the safer option regardless.',
          'vault_unavailable',
        );
      }

      const grant = createGrant({
        userId,
        orgId,
        username: input.username,
        scopes: input.scopes as SymbilityScope[],
        storageMode: input.storageMode,
        days: input.consentDays,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      const driver = createSymbilityDriver();
      const result = await driver.connect(
        { username: input.username, password: input.password, mfaCode: input.mfaCode },
        grant,
      );

      await recordSymbilityAudit(supabase, {
        consentId: grant.id,
        userId,
        scope: 'read_profile',
        action: 'connect',
        detail: `${driver.kind} sign-in as ${input.username}`,
        succeeded: result.status === 'connected',
      });

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

      // Only after Claims Connect itself accepted the credentials is the
      // grant recorded — a grant for a login that does not work is noise.
      const sealed =
        input.storageMode === 'stored' ? sealSymbilityCredential(input.password, userId) : null;
      await saveSymbilityConnection(supabase, grant, sealed);
      symbilitySessions.put(userId, result.session, driver);

      res.status(201).json({
        status: 'connected',
        profile: result.profile,
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
        storageMode: grant.storageMode,
      });
    } catch (err) {
      next(err instanceof SymbilityError ? new HttpError(400, err.message, err.code) : err);
    }
  },
);

/** POST /api/symbility/disconnect — end the session, destroy the credential. */
symbilityRouter.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    await symbilitySessions.close(userId);
    await revokeSymbilityConnection(supabase, userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
