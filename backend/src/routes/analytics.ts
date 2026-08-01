import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { analyticsRangeSchema, analyticsDatasetSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import {
  getAccess,
  getAccounts,
  getFeatures,
  getMonthly,
  getOverview,
  getPlanMix,
  getRetention,
  getSummary,
  scopeAtLeast,
} from '../lib/analytics.js';
import { buildWorkbook, workbookFilename, type Dataset } from '../lib/analyticsWorkbook.js';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

/**
 * GET /api/analytics/access
 *
 * Deliberately NOT behind the analytics gate: the app shell asks this on every
 * load to decide whether to show the link at all, and "no access" is a normal
 * answer here rather than an error.
 */
analyticsRouter.get('/access', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    res.json(await getAccess(supabase));
  } catch (err) {
    next(err);
  }
});

// Everything below requires at least investor scope.
analyticsRouter.use(requireAnalytics('investor'));

function parseRange(req: Request) {
  const parsed = analyticsRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid range', 'invalid_range');
  }
  return parsed.data;
}

/** The whole dashboard in one round trip. */
analyticsRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, months } = parseRange(req);
    const supabase = createUserClient(req.accessToken!);
    res.json(await getOverview(supabase, req.analyticsScope!, from, to, months));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const supabase = createUserClient(req.accessToken!);
    res.json({ summary: await getSummary(supabase, from, to) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { months } = parseRange(req);
    const supabase = createUserClient(req.accessToken!);
    res.json({ months: await getMonthly(supabase, months) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/features', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const supabase = createUserClient(req.accessToken!);
    res.json({ features: await getFeatures(supabase, from, to) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/plan-mix', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    res.json({ plans: await getPlanMix(supabase) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/retention', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { months } = parseRange(req);
    const supabase = createUserClient(req.accessToken!);
    res.json({ cohorts: await getRetention(supabase, Math.min(months, 36)) });
  } catch (err) {
    next(err);
  }
});

/** Per-customer detail — internal scope only, enforced here and in the database. */
analyticsRouter.get(
  '/accounts',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = parseRange(req);
      const supabase = createUserClient(req.accessToken!);
      res.json({ accounts: await getAccounts(supabase, from, to, 500) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/analytics/export?dataset=all|summary|monthly|features|plans|retention|accounts
 *
 * Streams a real .xlsx. The workbook is assembled from the same payload the
 * dashboard renders, so an export can never disagree with the screen — and an
 * investor-scope caller cannot obtain the Accounts sheet, because the payload it
 * is built from has no accounts in it.
 */
analyticsRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, months } = parseRange(req);
    const scope = req.analyticsScope!;

    const datasetParsed = analyticsDatasetSchema.safeParse(req.query.dataset ?? 'all');
    if (!datasetParsed.success) {
      throw new HttpError(400, 'Unknown export dataset', 'invalid_dataset');
    }
    const dataset: Dataset = datasetParsed.data;

    if (dataset === 'accounts' && !scopeAtLeast(scope, 'internal')) {
      throw new HttpError(
        403,
        'This report is limited to the internal Atmosphere team.',
        'analytics_scope_insufficient',
      );
    }

    const supabase = createUserClient(req.accessToken!);
    const payload = await getOverview(supabase, scope, from, to, months);
    const workbook = buildWorkbook(payload, dataset);
    const filename = workbookFilename(payload, dataset);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // A spreadsheet of company revenue should not sit in an intermediary cache.
    res.setHeader('Cache-Control', 'no-store');

    const buffer = await workbook.xlsx.writeBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});
