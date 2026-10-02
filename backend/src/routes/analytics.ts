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
import { getProductHealth } from '../analytics/productHealth.js';
import { contactRegistry, normalizeAudience } from '../analytics/contacts/registry.js';
import {
  campaignSendBlocker,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  resolveAudience,
  saveCampaign,
  sendCampaign,
  suppressedEmails,
} from '../analytics/campaigns.js';
import { sendSystemMail } from '../lib/systemMail.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { config } from '../config.js';

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

/**
 * North star, capture pipeline, analysis time, evidence and Ask health.
 * Investor scope; analytics_product_health re-checks it in the database.
 */
analyticsRouter.get('/product-health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weeks = z.coerce.number().int().min(4).max(52).catch(12).parse(req.query.weeks ?? 12);
    const supabase = staffReports(req);
    res.json(await getProductHealth(supabase, weeks));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Contacts and campaigns. Internal staff only, here and in every RPC.
// Contacts come from Stripe server-side (the key never leaves the backend)
// and are cached in memory, not stored.
// ---------------------------------------------------------------------------

const campaignIdSchema = z.string().uuid();
const audienceSchema = z
  .object({
    plans: z.array(z.string().max(64)).max(20).default([]),
    statuses: z.array(z.string().max(32)).max(10).default([]),
    sources: z.array(z.string().max(32)).max(10).default([]),
  })
  .default({ plans: [], statuses: [], sources: [] })
  .transform((a) => normalizeAudience(a));
const campaignDraftSchema = z.object({
  name: z.string().trim().max(200).default(''),
  subject: z.string().max(200).default(''),
  bodyMarkdown: z.string().max(50_000).default(''),
  audience: audienceSchema,
});

function parseCampaignId(raw: unknown): string {
  const parsed = campaignIdSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'Invalid campaign id', 'invalid_campaign');
  return parsed.data;
}

function sendingState() {
  const blocker = campaignSendBlocker(process.env, config.isProduction);
  return { enabled: blocker === null, reason: blocker?.message ?? null, code: blocker?.code ?? null };
}

analyticsRouter.get(
  '/contacts',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = staffReports(req);
      const directory = await contactRegistry().load({ refresh: req.query.refresh === '1' });
      const suppressed = await suppressedEmails(
        supabase,
        directory.contacts.map((c) => c.email),
      );
      res.json({
        ...directory,
        contacts: directory.contacts.map((c) => ({ ...c, suppressed: suppressed.has(c.email) })),
        suppressedCount: suppressed.size,
      });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.get(
  '/campaigns',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = staffReports(req);
      res.json({ ...(await listCampaigns(supabase)), sending: sendingState() });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.post(
  '/campaigns',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = campaignDraftSchema.parse(req.body ?? {});
      const supabase = staffReports(req);
      res.status(201).json({ campaign: await saveCampaign(supabase, null, body) });
    } catch (err) {
      next(err);
    }
  },
);

/** Recipient count for an audience after suppressions. No email is sent. */
analyticsRouter.post(
  '/campaigns/audience',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audience = audienceSchema.parse(req.body?.audience);
      const supabase = staffReports(req);
      const directory = await contactRegistry().load();
      const result = await resolveAudience(supabase, directory.contacts, audience);
      res.json({
        matched: result.matched,
        suppressed: result.suppressed,
        recipients: result.recipients.length,
        fetchedAt: directory.fetchedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.get(
  '/campaigns/:id',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = staffReports(req);
      res.json({ campaign: await getCampaign(supabase, parseCampaignId(req.params.id)), sending: sendingState() });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.put(
  '/campaigns/:id',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseCampaignId(req.params.id);
      const body = campaignDraftSchema.parse(req.body ?? {});
      const supabase = staffReports(req);
      res.json({ campaign: await saveCampaign(supabase, id, body) });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.delete(
  '/campaigns/:id',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = staffReports(req);
      const deleted = await deleteCampaign(supabase, parseCampaignId(req.params.id));
      if (!deleted) throw new HttpError(409, 'Only draft campaigns can be deleted.', 'campaign_not_editable');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Send a draft. Refused (403 campaign_sending_disabled) unless
 * CAMPAIGN_SENDING_ENABLED=true, and the body must repeat the recipient count
 * the person confirmed.
 */
analyticsRouter.post(
  '/campaigns/:id/send',
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseCampaignId(req.params.id);
      const blocker = campaignSendBlocker(process.env, config.isProduction);
      if (blocker) throw new HttpError(403, blocker.message, blocker.code);
      const { confirmRecipientCount } = z
        .object({ confirmRecipientCount: z.number().int().min(1).max(100_000) })
        .parse(req.body ?? {});
      const supabase = staffReports(req);
      const result = await sendCampaign(
        {
          supabase,
          contacts: async () => (await contactRegistry().load({ refresh: true })).contacts,
          mailer: (mail) =>
            sendSystemMail({
              to: mail.to,
              subject: mail.subject,
              text: mail.text,
              html: mail.html,
              kind: 'marketing',
              unsubscribeUrl: mail.unsubscribeUrl,
            }),
          origin: publicAppOrigin(),
          env: process.env,
          isProduction: config.isProduction,
        },
        id,
        confirmRecipientCount,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
