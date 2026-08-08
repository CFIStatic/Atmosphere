import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { billingError } from '../lib/billing.js';
import { HttpError, forbidden } from '../lib/errors.js';
import {
  getCustomerMeteringSummary,
  calculateMeteringPeriod,
  closeMeteringPeriod,
} from '../metering/periodAggregation.js';
import { recordAiUsageEvent } from '../metering/usageEvents.js';
import { registerBillableJob } from '../metering/jobMetering.js';
import { z } from 'zod';

export const meteringRouter = Router();

meteringRouter.use(requireAuth, requireOrg);

const recordEventSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  actionType: z.string().min(1).max(128),
  provider: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  jobId: z.string().uuid().optional(),
  workflowId: z.string().max(128).optional(),
  agentRunId: z.string().max(128).optional(),
  agentType: z.string().max(128).optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  cachedInputTokens: z.number().int().min(0).optional(),
  reasoningTokens: z.number().int().min(0).optional(),
  imageCount: z.number().int().min(0).optional(),
  videoSeconds: z.number().min(0).optional(),
  audioSeconds: z.number().min(0).optional(),
  ocrPages: z.number().int().min(0).optional(),
  embeddingTokens: z.number().int().min(0).optional(),
  thirdPartyCostNanos: z.number().int().min(0).optional(),
  otherVariableCostNanos: z.number().int().min(0).optional(),
  billable: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const registerJobSchema = z.object({
  jobId: z.string().uuid(),
  workflowType: z.string().min(1).max(64),
  idempotencyKey: z.string().min(1).max(256),
});

/**
 * GET /api/metering/summary
 * Customer-facing usage for the current billing period.
 * No tokens, model names, or internal margin.
 */
meteringRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const summary = await getCustomerMeteringSummary(supabase, req.orgId!);
    res.json(summary);
  } catch (err) {
    next(err instanceof Error && 'code' in err ? billingError(err as never) : err);
  }
});

/**
 * GET /api/metering/period
 * Full period calculation (org members with billing access only for margin fields).
 */
meteringRouter.get('/period', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const periodStart = typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined;
    const calc = await calculateMeteringPeriod(supabase, req.orgId!, periodStart);

    // Strip internal economics unless caller can manage billing
    const { data: canManage } = await supabase.rpc('billing_overview', { p_org: req.orgId });
    const manage = Boolean((canManage as { can_manage?: boolean } | null)?.can_manage);

    if (!manage) {
      const {
        estimatedAiCostCents: _a,
        estimatedGrossProfitCents: _b,
        estimatedGrossMarginPct: _c,
        ...customerSafe
      } = calc;
      res.json(customerSafe);
      return;
    }

    res.json(calc);
  } catch (err) {
    next(err instanceof Error && 'code' in err ? billingError(err as never) : err);
  }
});

/**
 * POST /api/metering/jobs
 * Register a billable processed job (once per billing period per job).
 */
meteringRouter.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerJobSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const result = await registerBillableJob(supabase, {
      orgId: req.orgId!,
      ...input,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/metering/events
 * Record an internal AI usage event (server-side workflows).
 * Idempotent on idempotencyKey.
 */
meteringRouter.post('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = recordEventSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const result = await recordAiUsageEvent(supabase, {
      orgId: req.orgId!,
      userId: req.user?.id ?? null,
      ...input,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/metering/period/close
 * Snapshot and close the current billing period (billing managers only).
 */
meteringRouter.post('/period/close', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data: overview, error } = await supabase.rpc('billing_overview', { p_org: req.orgId });
    if (error) throw billingError(error);
    if (!(overview as { can_manage?: boolean })?.can_manage) {
      throw forbidden('Only billing managers can close a billing period.', 'billing_forbidden');
    }

    const periodStart = typeof req.body?.periodStart === 'string' ? req.body.periodStart : undefined;
    const result = await closeMeteringPeriod(supabase, req.orgId!, periodStart);
    res.json(result);
  } catch (err) {
    next(err instanceof Error && 'code' in err ? billingError(err as never) : err);
  }
});

/**
 * GET /api/metering/plans
 * Public catalog of active metering plans (for pricing display).
 */
meteringRouter.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data: plans, error: plansError } = await supabase
      .from('metering_plans')
      .select('code, name, description, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (plansError) throw new HttpError(500, plansError.message, 'plans_failed');

    const { data: versions, error: versionsError } = await supabase
      .from('metering_plan_versions')
      .select(
        'plan_id, version, base_monthly_fee_cents, included_jobs, additional_job_price_cents, included_compute_units, video_hour_price_cents, billing_period_days',
      )
      .is('effective_to', null)
      .order('version', { ascending: false });
    if (versionsError) throw new HttpError(500, versionsError.message, 'plan_versions_failed');

    res.json({ plans: plans ?? [], versions: versions ?? [] });
  } catch (err) {
    next(err);
  }
});
