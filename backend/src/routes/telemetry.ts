import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  experimentAssignSchema,
  experimentEventSchema,
  featureHeartbeatSchema,
} from '../lib/validation.js';
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

/**
 * POST /api/telemetry/experiment/assign
 *
 * Sticky A/B assignment for the signed-in user. Deterministic on first assign;
 * subsequent calls return the same variant.
 */
telemetryRouter.post(
  '/experiment/assign',
  heartbeatLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = experimentAssignSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? 'Invalid experiment',
          'invalid_experiment',
        );
      }

      const supabase = createUserClient(req.accessToken!);
      const { data, error } = await supabase.rpc('assign_experiment', {
        p_experiment: parsed.data.experimentKey,
      });

      if (error) {
        if (/unknown_experiment/.test(error.message)) {
          throw new HttpError(404, 'Unknown experiment', 'unknown_experiment');
        }
        if (/experiment_not_running/.test(error.message)) {
          throw new HttpError(409, 'Experiment is not running', 'experiment_not_running');
        }
        throw new HttpError(500, error.message, 'experiment_assign_failed');
      }

      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/telemetry/experiment/event
 *
 * Records an experiment event (conversion, click, …). Auto-assigns when needed.
 */
telemetryRouter.post(
  '/experiment/event',
  heartbeatLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = experimentEventSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? 'Invalid experiment event',
          'invalid_experiment_event',
        );
      }

      const supabase = createUserClient(req.accessToken!);
      const { error } = await supabase.rpc('track_experiment_event', {
        p_experiment: parsed.data.experimentKey,
        p_event: parsed.data.eventName,
        p_props: parsed.data.props ?? {},
      });

      if (error) {
        if (/unknown_experiment|experiment_not_running|not_assigned/.test(error.message)) {
          throw new HttpError(409, error.message, 'experiment_event_rejected');
        }
        throw new HttpError(500, error.message, 'experiment_event_failed');
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
