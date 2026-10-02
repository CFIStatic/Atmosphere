import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createAdminClient, createStaffReportClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import {
  accessRequestIdSchema,
  analyticsDatasetSchema,
  analyticsOrgIdSchema,
  analyticsRangeSchema,
} from '../lib/validation.js';
import { forbidden, HttpError } from '../lib/errors.js';
import { canGrantAiCredits } from '../metering/aiBudget.js';
import { aiBudgetConfig } from '../metering/aiBudgetConfig.js';
import { grantAiCredits, loadAiAllowance, publicAllowance } from '../metering/aiBudgetService.js';
import {
  approveAccessRequests,
  countPendingAccessRequests,
  denyAccessRequest,
  listAccessRequests,
} from '../auth/internalAccessRequests.js';
import {
  getAccess,
  getAccountDetail,
  getAccounts,
  getExperiments,
  getFeatures,
  getMonthly,
  getOverview,
  getPlanMix,
  getRetention,
  getSummary,
  scopeAtLeast,
} from '../lib/analytics.js';
import { ensureAllowlistedAnalyticsAccess } from '../lib/analyticsAccess.js';
import { buildWorkbook, workbookFilename, type Dataset } from '../lib/analyticsWorkbook.js';
import { getAdminMeteringAnalytics, getAdminTokenUsageAnalytics } from '../metering/periodAggregation.js';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

function staffReports(req: Request) {
  const userId = req.user?.id ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new HttpError(401, 'Not authenticated', 'unauthorized');
  }
  const client = createStaffReportClient(userId);
  if (!client) {
    throw new HttpError(
      503,
      'Staff reports are not configured on this server.',
      'analytics_unavailable',
    );
  }
  return client;
}

/**
 * GET /api/analytics/access
 *
 * Deliberately NOT behind the analytics gate: the app shell asks this on every
 * load to decide whether to show the link at all, and "no access" is a normal
 * answer here rather than an error.
 */
analyticsRouter.get('/access', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Auto-grant Atmosphere staff (e.g. jack@jettx.ai) so preview shows
    // /analytics without a manual SQL upsert.
    await ensureAllowlistedAnalyticsAccess(req.user);

    // Own analytics_staff row under the user JWT. Do not call analytics_whoami
    // here: that RPC is service_role only, and a missing EXECUTE grant is not
    // a report the sign-in page opened. The service-role client would bypass
    // RLS and see every staff row.
    const supabase = createUserClient(req.accessToken!);
    const access = await getAccess(supabase);
    if (access.scope === 'internal') {
      access.pendingAccessRequests = await countPendingAccessRequests();
    }
    res.json(access);
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
    const supabase = staffReports(req);
    res.json(await getOverview(supabase, req.analyticsScope!, from, to, months));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const supabase = staffReports(req);
    res.json({ summary: await getSummary(supabase, from, to) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { months } = parseRange(req);
    const supabase = staffReports(req);
    res.json({ months: await getMonthly(supabase, months) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/features', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const supabase = staffReports(req);
    res.json({ features: await getFeatures(supabase, from, to) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/plan-mix', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = staffReports(req);
    res.json({ plans: await getPlanMix(supabase) });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/retention', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { months } = parseRange(req);
    const supabase = staffReports(req);
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
      const supabase = staffReports(req);
      res.json({ accounts: await getAccounts(supabase, from, to, 500) });
    } catch (err) {
      next(err);
    }
  },
);

/** One organization file — members, jobs, usage. Internal scope only. */
analyticsRouter.get(
  '/accounts/:orgId',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = analyticsOrgIdSchema.safeParse(req.params.orgId);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid org id', 'invalid_org');
      }
      const { from, to } = parseRange(req);
      const supabase = staffReports(req);
      const detail = await getAccountDetail(supabase, parsed.data, from, to);
      if (!detail) {
        throw new HttpError(404, 'Organization not found', 'org_not_found');
      }
      res.json(detail);
    } catch (err) {
      next(err);
    }
  },
);


/** Global AI token usage — internal scope only. Source: token_usage_events. */
analyticsRouter.get(
  '/token-usage',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = parseRange(req);
      const supabase = staffReports(req);
      res.json(await getAdminTokenUsageAnalytics(supabase, from.toISOString(), to.toISOString()));
    } catch (err) {
      next(err);
    }
  },
);

/** AI cost vs revenue metering — internal scope only. */
analyticsRouter.get(
  '/metering',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = parseRange(req);
      const supabase = staffReports(req);
      res.json(await getAdminMeteringAnalytics(supabase, from.toISOString(), to.toISOString()));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/analytics/access-requests
 * Employees waiting to join Internal Growth Metrics. Internal admin only.
 */
analyticsRouter.get(
  '/access-requests',
  requireAnalytics('internal'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await listAccessRequests();
      res.json({
        requests,
        pendingCount: requests.filter((row) => row.status === 'pending').length,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/analytics/access-requests/approve-all
 * Grant every pending employee internal analytics access.
 */
analyticsRouter.post(
  '/access-requests/approve-all',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const approved = await approveAccessRequests({
        allPending: true,
        reviewerId: req.user!.id,
      });
      res.json({
        approved,
        pendingCount: await countPendingAccessRequests(),
      });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.post(
  '/access-requests/:id/approve',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = accessRequestIdSchema.safeParse(req.params.id);
      if (!parsed.success) {
        throw new HttpError(400, 'Invalid request id', 'invalid_request');
      }
      const approved = await approveAccessRequests({
        ids: [parsed.data],
        reviewerId: req.user!.id,
      });
      if (approved.length === 0) {
        throw new HttpError(404, 'Access request not found', 'request_not_found');
      }
      res.json({ request: approved[0], pendingCount: await countPendingAccessRequests() });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.post(
  '/access-requests/:id/deny',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = accessRequestIdSchema.safeParse(req.params.id);
      if (!parsed.success) {
        throw new HttpError(400, 'Invalid request id', 'invalid_request');
      }
      const denied = await denyAccessRequest(parsed.data, req.user!.id);
      if (!denied) {
        throw new HttpError(404, 'Access request not found', 'request_not_found');
      }
      res.json({ request: denied, pendingCount: await countPendingAccessRequests() });
    } catch (err) {
      next(err);
    }
  },
);

/** A/B experiment funnel — Atmosphere internal staff only. */
analyticsRouter.get(
  '/experiments',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = parseRange(req);
      const supabase = createUserClient(req.accessToken!);
      res.json({ experiments: await getExperiments(supabase, from, to) });
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

    const supabase = staffReports(req);
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

/** Staff view of each org's AI spend against its allowance. */
analyticsRouter.get(
  '/ai-budgets',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!canGrantAiCredits(req.analyticsScope)) {
        throw forbidden('Only Atmosphere staff can view AI budgets.', 'analytics_forbidden');
      }
      const admin = createAdminClient();
      if (!admin) throw new HttpError(503, 'Admin client is not configured.', 'no_admin');
      const { data, error } = await admin.from('orgs').select('id, name').order('name').limit(100);
      if (error) throw new HttpError(500, error.message, 'ai_budgets_failed');
      const budgets = [];
      for (const org of (data ?? []) as Array<{ id: string; name: string | null }>) {
        const view = publicAllowance(await loadAiAllowance(admin, org.id));
        budgets.push({ orgId: org.id, orgName: org.name, ...view });
      }
      res.json({ budgets });
    } catch (err) {
      next(err);
    }
  },
);

/** Manual credit grant. Investors cannot reach this route. */
analyticsRouter.post(
  '/ai-budgets/:orgId/credits',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!canGrantAiCredits(req.analyticsScope)) {
        throw forbidden('Only Atmosphere staff can grant AI credits.', 'analytics_forbidden');
      }
      const parsed = analyticsOrgIdSchema.safeParse(req.params.orgId);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid org id', 'invalid_org');
      }
      const body = z
        .object({
          dollars: z.number().positive().max(100_000),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body ?? {});
      const admin = createAdminClient();
      if (!admin) throw new HttpError(503, 'Admin client is not configured.', 'no_admin');
      const deltaNanos = Math.round(body.dollars * 1_000_000_000 * aiBudgetConfig().creditUsdRatio);
      const granted = await grantAiCredits(admin, {
        orgId: parsed.data,
        deltaNanos,
        kind: 'admin_grant',
        note: body.note ?? 'Manual credit grant',
        actorId: req.user?.id ?? null,
        requestId: `admin-grant:${req.user?.id ?? 'staff'}:${Date.now()}`,
      });
      res.status(201).json(granted);
    } catch (err) {
      next(err);
    }
  },
);
