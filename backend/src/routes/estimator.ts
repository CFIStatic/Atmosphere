import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { buildEstimate } from '../estimator/agent.js';
import { buildEstimatorConfig } from '../estimator/settings.js';
import { CATALOG } from '../estimator/catalog/lineItems.js';
import { toLineItemCsv, toScopeSheet, toSketchXml } from '../estimator/export/xactimateExport.js';
import {
  buildEstimateSchema,
  estimatorSettingsSchema,
  exportFormatSchema,
} from '../estimator/validation.js';
import {
  getEstimate,
  getPriceList,
  getSettings,
  listJobs,
  resolveOrgId,
  saveEstimate,
  saveSettings,
  getConnection,
} from '../estimator/store.js';

export const estimatorRouter = Router();

estimatorRouter.use(requireAuth);

/**
 * Building an estimate parses several megabytes of vendor export and runs the
 * whole rule set, so it is metered — not against abuse so much as against a
 * client that re-fires on every keystroke of a notes field.
 */
const buildLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many estimate builds. Wait a moment and try again.', code: 'rate_limited' },
});

/**
 * Resolve everything an estimate run needs: the caller's org, its settings, and
 * the price list their Xactimate connection selected.
 */
async function loadContext(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const userId = req.user!.id;
  const orgId = await resolveOrgId(supabase, userId);
  const stored = await getSettings(supabase, orgId);

  const connection = await getConnection(supabase, userId);
  const priceList = connection?.priceListId
    ? await getPriceList(supabase, orgId, connection.priceListId)
    : null;

  return { supabase, userId, orgId, stored, priceList };
}

/**
 * POST /api/estimator/build
 *
 * Build an estimate from raw sources without saving anything. This is the
 * endpoint the UI calls while the user is still adding sources and adjusting
 * assumptions — an estimate is cheap to recompute and there is no reason to
 * litter the database with drafts.
 */
estimatorRouter.post(
  '/build',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = buildEstimateSchema.parse(req.body);
      const { stored, priceList } = await loadContext(req);

      const { config, warnings } = buildEstimatorConfig(
        { ...stored, ...(input.settings ?? {}) },
        priceList,
      );

      const estimate = buildEstimate(
        {
          jobId: input.jobId,
          docusketch: input.docusketch,
          mica: input.mica,
          photos: input.photos,
          notes: input.notes,
          overrides: input.overrides,
        },
        config,
      );

      res.json({
        estimate: {
          ...estimate,
          openQuestions: [...new Set([...estimate.openQuestions, ...warnings])],
        },
        priceListConnected: Boolean(priceList),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/estimator/estimates
 *
 * Build and persist. Separate from /build on purpose: saving is the deliberate
 * act, and it is the one that puts claim data in the database.
 */
estimatorRouter.post(
  '/estimates',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = buildEstimateSchema.parse(req.body);
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);

      const { config, warnings } = buildEstimatorConfig(
        { ...stored, ...(input.settings ?? {}) },
        priceList,
      );

      const estimate = buildEstimate(
        {
          jobId: input.jobId,
          docusketch: input.docusketch,
          mica: input.mica,
          photos: input.photos,
          notes: input.notes,
          overrides: input.overrides,
        },
        config,
      );
      estimate.openQuestions = [...new Set([...estimate.openQuestions, ...warnings])];

      const name =
        estimate.assessment.propertyAddress ??
        estimate.assessment.claimNumber ??
        `Mitigation estimate ${new Date().toISOString().slice(0, 10)}`;

      const record = await saveEstimate(supabase, { orgId, userId, name, estimate });

      res.status(201).json({ estimateId: record.id, jobId: record.jobId, estimate });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/estimator/demo-sources
 *
 * The worked example, so the estimator can be evaluated before anyone uploads a
 * real claim. It is a Category 2 appliance loss that sat two days, with a wet
 * wall cavity and an equipment log left open — enough to exercise the paths that
 * matter without any customer data changing hands.
 */
estimatorRouter.get('/demo-sources', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { SAMPLE_JOB } = await import('../estimator/fixtures/sampleJob.js');
    res.json({ sources: SAMPLE_JOB });
  } catch (err) {
    next(err);
  }
});

/** GET /api/estimator/jobs — the org's estimating jobs, newest first. */
estimatorRouter.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ jobs: await listJobs(supabase, orgId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/estimator/estimates/:id */
estimatorRouter.get('/estimates/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const record = await getEstimate(supabase, req.params.id);
    // RLS already hides other orgs' rows, so "not visible" and "not there" are
    // the same answer and neither confirms the id exists.
    if (!record) throw new HttpError(404, 'That estimate was not found.', 'estimate_not_found');
    res.json({ estimate: record.estimate, savedAt: record.createdAt });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/estimator/estimates/:id/export?format=csv|xml|scope
 *
 * The route that needs no Xactimate login at all: download the file, import it
 * by hand. For most orgs this is the whole integration.
 */
estimatorRouter.get(
  '/estimates/:id/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { format } = exportFormatSchema.parse(req.query);
      const supabase = createUserClient(req.accessToken!);
      const record = await getEstimate(supabase, req.params.id);
      if (!record) throw new HttpError(404, 'That estimate was not found.', 'estimate_not_found');

      const base = `estimate-${record.id.slice(0, 8)}`;

      if (format === 'csv') {
        res.type('text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}-line-items.csv"`);
        res.send(toLineItemCsv(record.estimate.lineItems));
        return;
      }
      if (format === 'xml') {
        res.type('application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}-sketch.xml"`);
        res.send(toSketchXml(record.estimate));
        return;
      }

      res.type('text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}-scope.txt"`);
      res.send(toScopeSheet(record.estimate));
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/estimator/settings — the org's estimating assumptions. */
estimatorRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ settings: await getSettings(supabase, orgId) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/estimator/settings */
estimatorRouter.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = estimatorSettingsSchema.parse(req.body);
    if (!parsed) throw badRequest('Nothing to save.');

    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ settings: await saveSettings(supabase, orgId, parsed) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/estimator/catalog
 *
 * The line-item catalog the estimator can write, with each entry's verification
 * state. Exposed so the UI can be honest about which prices are real.
 */
estimatorRouter.get('/catalog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const orgId = await resolveOrgId(supabase, userId);
    const connection = await getConnection(supabase, userId);
    const priceList = connection?.priceListId
      ? await getPriceList(supabase, orgId, connection.priceListId)
      : null;

    const { config } = buildEstimatorConfig(await getSettings(supabase, orgId), priceList);

    res.json({
      priceListId: priceList?.id ?? null,
      verifiedCount: config.catalog.filter((item) => item.verified).length,
      totalCount: config.catalog.length,
      items: config.catalog.map((item) => ({
        code: item.code,
        category: item.category,
        description: item.description,
        unit: item.unit,
        unitPrice: item.defaultUnitPrice,
        unitCost: item.defaultUnitCost,
        verified: item.verified,
        note: item.note,
      })),
      seedCount: CATALOG.length,
    });
  } catch (err) {
    next(err);
  }
});
