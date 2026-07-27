import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { agentHub } from '../computer/agentHub.js';
import { createPairingCode, mintAgentToken, redeemPairingCode } from '../computer/agentTokens.js';
import {
  clearApiKey,
  getApiKey,
  getCredentialStatus,
  looksLikeAnthropicKey,
  setApiKey,
} from '../computer/credentials.js';
import { COMPUTER_MODELS, DEFAULT_MODEL_ID, findModel } from '../computer/models.js';
import { activeRunForAgent, getRun, listRuns, startRun } from '../computer/runner.js';

/**
 * The Computer Use API.
 *
 * Two audiences share this router. Agents hit exactly one unauthenticated
 * endpoint — pairing — where the one-time code *is* the credential. Everything
 * else is a browser call behind the normal session cookie, scoped to the
 * caller's organisation.
 */

export const computerRouter = Router();

/** Reject the whole surface when the feature is switched off for a deployment. */
computerRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!config.computerUse.enabled) {
    next(new HttpError(404, 'Computer use is disabled on this server.', 'computer_use_disabled'));
    return;
  }
  next();
});

/* ------------------------- unauthenticated: pairing ------------------------ */

/**
 * A pairing code is short, guessable-ish by construction (8 characters from a
 * 30-symbol alphabet), and grants control of a machine. Rate limiting is what
 * makes the short code safe: 20 attempts per 15 minutes turns a brute force
 * into centuries.
 */
const pairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many pairing attempts. Try again later.', code: 'rate_limited' },
});

const pairSchema = z.object({
  code: z.string().min(4).max(32),
  name: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(32),
});

/**
 * POST /api/computer/agents/pair
 * Called by the agent, not the browser. Trades a one-time code for the durable
 * token it reconnects with.
 */
computerRouter.post(
  '/agents/pair',
  pairLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, name } = pairSchema.parse(req.body);
      const redeemed = redeemPairingCode(code);
      if (!redeemed) {
        // Same message for "never existed", "already used", and "expired": a
        // caller guessing codes should learn nothing from the difference.
        throw badRequest('That pairing code is not valid or has expired.', 'invalid_pairing_code');
      }

      const { token, identity } = mintAgentToken({ orgId: redeemed.orgId, name });
      res.status(201).json({
        agentId: identity.agentId,
        agentToken: token,
        name: identity.name,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* --------------------------- authenticated routes -------------------------- */

computerRouter.use(requireAuth);

/** Every computer-use action is scoped to the caller's organisation. */
async function requireOrgId(req: Request): Promise<string> {
  const supabase = createUserClient(req.accessToken!);
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new HttpError(500, error.message, 'org_lookup_failed');

  const orgId = data?.[0]?.org_id as string | undefined;
  if (!orgId) {
    throw new HttpError(
      403,
      'Join or create an organization before using computer use.',
      'no_organization',
    );
  }
  return orgId;
}

/**
 * GET /api/computer/status
 * Everything the console needs to render itself in one call: whether a key is
 * connected, which computers are online, and what the model options are.
 */
computerRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    res.json({
      enabled: true,
      credential: await getCredentialStatus(orgId),
      agents: agentHub.list(orgId).map(serializeAgent),
      models: COMPUTER_MODELS.map((m) => ({ id: m.id, label: m.label })),
      defaults: {
        model: config.computerUse.defaultModel,
        quality: config.computerUse.defaultQuality,
      },
      limits: {
        maxSteps: config.computerUse.maxIterations,
        runTimeoutMs: config.computerUse.runTimeoutMs,
      },
    });
  } catch (err) {
    next(err);
  }
});

const apiKeySchema = z.object({ apiKey: z.string().trim().min(20).max(400) });

/**
 * PUT /api/computer/credentials
 * Connect (or replace) the organisation's Anthropic API key.
 */
computerRouter.put('/credentials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    const { apiKey } = apiKeySchema.parse(req.body);
    if (!looksLikeAnthropicKey(apiKey)) {
      throw badRequest(
        'That does not look like an Anthropic API key. Keys start with "sk-ant-".',
        'invalid_api_key',
      );
    }
    res.json({ credential: await setApiKey(orgId, apiKey, req.user!.id) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/computer/credentials — disconnect the organisation's key. */
computerRouter.delete('/credentials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    res.json({ credential: await clearApiKey(orgId) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/computer/agents/pair-code — mint a code to enrol a new computer. */
computerRouter.post('/agents/pair-code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    res.status(201).json(createPairingCode(orgId, req.user!.id));
  } catch (err) {
    next(err);
  }
});

/** GET /api/computer/agents — computers currently online. */
computerRouter.get('/agents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    res.json({ agents: agentHub.list(orgId).map(serializeAgent) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/computer/agents/:agentId/screen
 * A single fresh frame for the live view. Read-only — this never moves the
 * mouse or types anything.
 */
computerRouter.get(
  '/agents/:agentId/screen',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = await requireOrgId(req);
      const agent = agentHub.get(orgId, req.params.agentId);
      if (!agent) throw new HttpError(404, 'That computer is not connected.', 'agent_offline');

      // Configure on demand so a preview taken before any run still arrives at
      // a sensible size rather than a full 4K PNG.
      const capture =
        agent.capture ??
        agentHub.configure(
          agent.agentId,
          findModel(config.computerUse.defaultModel),
          config.computerUse.defaultQuality,
        );

      const output = await agentHub.invoke(agent.agentId, { action: 'screenshot' }, 'preview');
      if (output.kind !== 'image') {
        throw new HttpError(502, 'The computer did not return a screenshot.', 'screenshot_failed');
      }
      res.json({ image: output.data, width: capture.width, height: capture.height });
    } catch (err) {
      next(err);
    }
  },
);

const startRunSchema = z.object({
  agentId: z.string().min(1),
  instruction: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).max(64).optional(),
  quality: z.enum(['economical', 'balanced', 'detailed']).optional(),
});

/** POST /api/computer/runs — give a computer a task. */
computerRouter.post('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await requireOrgId(req);
    const body = startRunSchema.parse(req.body);

    const apiKey = await getApiKey(orgId);
    if (!apiKey) {
      throw badRequest(
        'Connect an Anthropic API key before starting a task.',
        'no_api_key',
      );
    }

    if (activeRunForAgent(orgId, body.agentId)) {
      throw new HttpError(409, 'That computer is already running a task.', 'agent_busy');
    }

    // Validate the model before creating the run, so a typo is a 400 rather
    // than a run that appears and immediately fails.
    findModel(body.model ?? config.computerUse.defaultModel);

    const run = startRun({
      orgId,
      agentId: body.agentId,
      instruction: body.instruction,
      apiKey,
      modelId: body.model ?? config.computerUse.defaultModel,
      quality: body.quality ?? config.computerUse.defaultQuality,
    });

    res.status(201).json({ run: run.summary() });
  } catch (err) {
    next(err instanceof HttpError || err instanceof z.ZodError ? err : badRequest((err as Error).message, 'start_run_failed'));
  }
});

/** GET /api/computer/runs — recent runs for the organisation. */
computerRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ runs: listRuns(await requireOrgId(req)) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/computer/runs/:runId — one run's current state. */
computerRouter.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = getRun(await requireOrgId(req), req.params.runId);
    if (!run) throw new HttpError(404, 'Run not found.', 'run_not_found');
    res.json({ run: run.summary() });
  } catch (err) {
    next(err);
  }
});

/** POST /api/computer/runs/:runId/stop — hand control back to the operator. */
computerRouter.post('/runs/:runId/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = getRun(await requireOrgId(req), req.params.runId);
    if (!run) throw new HttpError(404, 'Run not found.', 'run_not_found');
    run.stop();
    res.json({ run: run.summary() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/computer/runs/:runId/events
 *
 * Server-sent events for the live transcript. `?after=<seq>` replays everything
 * the browser missed, so closing the tab and reopening it mid-run rebuilds the
 * whole story rather than starting from a blank panel.
 */
computerRouter.get(
  '/runs/:runId/events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const run = getRun(await requireOrgId(req), req.params.runId);
      if (!run) throw new HttpError(404, 'Run not found.', 'run_not_found');

      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Proxies that buffer would defeat the point of streaming.
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      const write = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      const after = Number(req.query.after ?? 0);
      for (const event of run.since(Number.isFinite(after) ? after : 0)) write(event);
      write({ type: 'summary', run: run.summary() });

      const unsubscribe = run.subscribe((event) => {
        write(event);
        if (event.type === 'status') write({ type: 'summary', run: run.summary() });
      });

      // Keeps intermediaries from reaping an idle connection while Claude
      // spends thirty seconds thinking.
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on('close', close);
      res.on('close', close);
    } catch (err) {
      next(err);
    }
  },
);

function serializeAgent(agent: ReturnType<typeof agentHub.list>[number]) {
  return {
    id: agent.agentId,
    name: agent.name,
    platform: agent.platform,
    version: agent.agentVersion,
    screen: agent.screen,
    capture: agent.capture,
    capabilities: agent.capabilities,
    connectedAt: agent.connectedAt,
    busy: agent.busyWithRunId !== null,
  };
}

export { DEFAULT_MODEL_ID };
