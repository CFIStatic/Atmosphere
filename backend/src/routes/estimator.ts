import { Router, type NextFunction, type Request, type Response } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import {
  credentialSchema,
  providerParamSchema,
  selectJobSchema,
  startRunSchema,
} from '../lib/validation.js';
import { config } from '../config.js';
import { credentialStorageAvailable } from '../estimator/credentials.js';
import { isModelAvailable } from '../estimator/ai/client.js';
import { buildConnectors, isSandbox } from '../estimator/connectors/index.js';
import { VendorError } from '../estimator/connectors/http.js';
import { approveAndExport, selectJobAndResume, startRun } from '../estimator/pipeline.js';
import { toCsv, toXactimateXml } from '../estimator/estimate/export.js';
import * as store from '../estimator/store.js';

export const estimatorRouter = Router();

/**
 * Construction Estimator API.
 *
 * Every route is org-scoped through the caller's JWT, so Row Level Security —
 * not a filter in this file — decides what is visible. Two rules shape the
 * surface:
 *
 *   • **Secrets go in, never out.** Credentials can be written and replaced;
 *     nothing here can read one back, not even for the user who stored it.
 *   • **The export is a separate, explicit call.** A run produces an estimate
 *     and stops. Writing it into Xactimate takes a deliberate approval.
 */

estimatorRouter.use(requireAuth);

/** Resolve the caller's org once per request, with the role for permission checks. */
async function context(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const membership = await store.requireMembership(supabase, req.user!.id);
  return { supabase, membership, userId: req.user!.id };
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

/**
 * GET /api/estimator/status
 * What the estimator can do on this deployment, and what is still unconnected.
 */
estimatorRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, membership } = await context(req);
    const credentials = await store.listCredentials(supabase, membership.orgId);

    res.json({
      sandbox: isSandbox(),
      modelAvailable: isModelAvailable(),
      credentialStorageAvailable: credentialStorageAvailable(),
      canManageCredentials: ['project_manager', 'office_manager'].includes(membership.role),
      maxPhotosPerRun: config.estimator.maxPhotosPerRun,
      credentials,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/estimator/credentials/:provider
 * Store or replace the credentials the agent signs in with.
 */
estimatorRouter.put(
  '/credentials/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = providerParamSchema.parse(req.params.provider);
      const input = credentialSchema.parse(req.body);
      const { supabase, membership, userId } = await context(req);
      store.assertCanManageCredentials(membership);

      const summary = await store.saveCredential(supabase, {
        orgId: membership.orgId,
        userId,
        provider,
        label: input.label,
        secret: {
          username: input.username,
          password: input.password,
          apiKey: input.apiKey,
          accountId: input.accountId,
          baseUrl: input.baseUrl,
        },
      });

      // Nothing secret is echoed back — only the metadata the UI renders.
      res.status(200).json({ credential: summary });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/estimator/credentials/:provider */
estimatorRouter.delete(
  '/credentials/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = providerParamSchema.parse(req.params.provider);
      const { supabase, membership } = await context(req);
      store.assertCanManageCredentials(membership);

      await store.deleteCredential(supabase, membership.orgId, provider);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/estimator/credentials/:provider/test
 * Sign in without starting a run, so a typo surfaces at setup time.
 */
estimatorRouter.post(
  '/credentials/:provider/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = providerParamSchema.parse(req.params.provider);
      const { supabase, membership } = await context(req);

      const secrets = await store.loadSecrets(supabase, membership.orgId);
      if (!isSandbox() && !secrets[provider]) {
        throw new HttpError(404, `No ${provider} credentials are stored.`, 'credential_missing');
      }

      const connectors = buildConnectors(secrets);
      const connector =
        provider === 'docusketch'
          ? connectors.scan
          : provider === 'dash'
            ? connectors.crm
            : connectors.estimating;

      await connector.verify();
      res.json({ ok: true, connector: connector.name });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Scan projects                                                       */
/* ------------------------------------------------------------------ */

/** GET /api/estimator/projects — scans available to start a run from. */
estimatorRouter.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, membership } = await context(req);
    const secrets = await store.loadSecrets(supabase, membership.orgId);
    const connectors = buildConnectors(secrets);

    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json({ projects: await connectors.scan.listProjects({ search, limit: 25 }) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /api/estimator/runs
 * Start a run. Returns immediately with the run row; the pipeline continues
 * behind it and the client polls `GET /runs/:id` for progress.
 */
estimatorRouter.post('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = startRunSchema.parse(req.body);
    const { supabase, membership, userId } = await context(req);

    const run = await startRun(
      { supabase, orgId: membership.orgId, userId },
      { scanProjectId: input.scanProjectId, mitigationText: input.mitigationText },
    );

    res.status(202).json({ run });
  } catch (err) {
    next(err);
  }
});

/** GET /api/estimator/runs */
estimatorRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, membership } = await context(req);
    res.json({ runs: await store.listRuns(supabase, membership.orgId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/estimator/runs/:id */
estimatorRouter.get('/runs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await context(req);
    res.json({ run: await store.getRun(supabase, req.params.id!) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/estimator/runs/:id/job
 * Answer the matcher when it could not choose a job on its own.
 */
estimatorRouter.post('/runs/:id/job', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = selectJobSchema.parse(req.body);
    const { supabase, membership, userId } = await context(req);

    const run = await selectJobAndResume(
      { supabase, orgId: membership.orgId, userId },
      req.params.id!,
      jobId,
    );

    res.status(202).json({ run });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/estimator/runs/:id/approve
 * Approve the estimate and write it to Xactimate. The only outward-facing
 * action in the feature, and the only one that is never automatic.
 */
estimatorRouter.post('/runs/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, membership, userId } = await context(req);
    const run = await approveAndExport(
      { supabase, orgId: membership.orgId, userId },
      req.params.id!,
    );
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/estimator/runs/:id/export?format=csv|xml
 * Download the estimate without writing it anywhere — the path an estimator
 * takes when they would rather import it into Xactimate themselves.
 */
estimatorRouter.get('/runs/:id/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await context(req);
    const run = await store.getRun(supabase, req.params.id!);
    if (!run.estimate) {
      throw new HttpError(409, 'This run has no estimate yet.', 'no_estimate');
    }

    const format = req.query.format === 'xml' ? 'xml' : 'csv';
    const stem = (run.estimate.claimNumber ?? run.id).replace(/[^A-Za-z0-9._-]/g, '-');
    const body = format === 'xml' ? toXactimateXml(run.estimate) : toCsv(run.estimate);

    res.setHeader('Content-Type', format === 'xml' ? 'application/xml' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="estimate-${stem}.${format}"`);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

/**
 * A vendor failure is a gateway failure, not an unexpected crash. Translating
 * it here — rather than in the shared handler — keeps the estimator's vendor
 * plumbing out of the rest of the app, and stops a DocuSketch 401 from being
 * logged as an internal error with a generic message the operator cannot act on.
 */
estimatorRouter.use(
  (err: unknown, _req: Request, _res: Response, next: NextFunction): void => {
    next(err instanceof VendorError ? err.toHttpError() : err);
  },
);
