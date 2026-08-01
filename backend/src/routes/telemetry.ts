import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { featureHeartbeatSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';

export const telemetryRouter = Router();

telemetryRouter.use(requireAuth);

/**
 * A heartbeat every ~30s per open tool, so a busy user with several tabs still
 * lands well inside this. The cap exists to stop a broken (or enthusiastic)
 * client from hammering the database, not to police normal use.
 */
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry requests', code: 'rate_limited' },
});

/**
 * POST /api/telemetry/feature
 *
 * Records foreground time in a tool. The elapsed time is measured by the client
 * but never trusted: the value is bounded here and clamped again in the
 * database, and the session it lands on is looked up by `auth.uid()` — a caller
 * cannot attribute time to another user, another org, or another feature.
 *
 * Returns the session id to continue with. A null id means the caller has no
 * organization yet (mid-onboarding), which is not an error.
 */
telemetryRouter.post(
  '/feature',
  heartbeatLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = featureHeartbeatSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? 'Invalid heartbeat',
          'invalid_heartbeat',
        );
      }
      const { featureKey, sessionId, deltaMs, interactions, client } = parsed.data;

      const supabase = createUserClient(req.accessToken!);
      const { data, error } = await supabase.rpc('feature_heartbeat', {
        p_feature: featureKey,
        p_session: sessionId ?? null,
        p_delta_ms: deltaMs,
        p_client: client,
        p_interactions: interactions,
      });

      if (error) {
        // An unknown feature key is a client bug, not a server fault.
        if (/unknown_feature/.test(error.message)) {
          throw new HttpError(400, 'Unknown feature', 'unknown_feature');
        }
        throw new HttpError(500, error.message, 'heartbeat_failed');
      }

      res.json({ sessionId: (data as string | null) ?? null });
    } catch (err) {
      next(err);
    }
  },
);
