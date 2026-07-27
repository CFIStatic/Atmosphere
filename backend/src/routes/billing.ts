import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAnonClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { toNanos } from '../lib/money.js';
import {
  billingError,
  serializeBalance,
  serializeOverview,
  serializePack,
  serializePlan,
  serializeRate,
} from '../lib/billing.js';
import {
  billingSettingsSchema,
  completePurchaseSchema,
  setPlanSchema,
  startPurchaseSchema,
} from '../lib/validation.js';

export const billingRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/billing/catalog
 *
 * Plans, credit packs and the model rate card. Deliberately unauthenticated:
 * these are the three tables a public pricing page needs, and none of them
 * contain organization data or our cost basis — the rate card carries sell
 * prices only, projected from the private cost table by the database.
 */
billingRouter.get('/catalog', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createAnonClient();

    const [plans, packs, rates] = await Promise.all([
      supabase.from('billing_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('credit_packs').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('model_rate_card').select('*').eq('is_active', true).order('sort_order'),
    ]);

    const failure = plans.error ?? packs.error ?? rates.error;
    if (failure) throw new HttpError(500, failure.message, 'catalog_failed');

    res.json({
      plans: (plans.data ?? []).map(serializePlan),
      packs: (packs.data ?? []).map(serializePack),
      rateCard: (rates.data ?? []).map(serializeRate),
      // Lets the UI show a "confirm payment" affordance only where the dev
      // provider can actually settle a charge without a real processor.
      paymentProvider: config.billing.paymentProvider,
    });
  } catch (err) {
    next(err);
  }
});

// Everything past this point acts on the caller's own organization.
billingRouter.use(requireAuth, requireOrg);

/**
 * GET /api/billing/overview
 * Subscription, balance, settings and month-to-date usage in one round trip.
 * Reading also rolls the billing period forward and grants any due plan
 * credits, so the system stays correct without a scheduler.
 */
billingRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase.rpc('billing_overview', { p_org: req.orgId });
    if (error) throw billingError(error);
    res.json(serializeOverview(data));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/plan
 * Switch subscription tier. Upgrades take effect immediately; moving to Free is
 * deferred to the end of the paid period so nothing already paid for is lost.
 */
billingRouter.post('/plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planCode, billingInterval, seats } = setPlanSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase.rpc('set_billing_plan', {
      p_org: req.orgId,
      p_plan: planCode,
      p_interval: billingInterval,
      p_seats: seats,
    });
    if (error) throw billingError(error);

    res.json({
      plan: (data as any)?.plan,
      changed: Boolean((data as any)?.changed),
      effectiveAt: (data as any)?.effective_at ?? null,
      cancelAtPeriodEnd: Boolean((data as any)?.cancel_at_period_end),
      grantedNanos: toNanos((data as any)?.granted_nanos ?? 0),
      balance: serializeBalance((data as any)?.balance),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/billing/settings
 * Auto-reload and the monthly spend cap. Sending `monthlySpendLimitNanos: null`
 * removes the cap; omitting the field leaves it untouched.
 */
billingRouter.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = billingSettingsSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const clearLimit = 'monthlySpendLimitNanos' in input && input.monthlySpendLimitNanos === null;

    const { data, error } = await supabase.rpc('set_billing_settings', {
      p_org: req.orgId,
      p_auto_reload_enabled: input.autoReloadEnabled ?? null,
      p_auto_reload_threshold: input.autoReloadThresholdNanos ?? null,
      p_auto_reload_amount: input.autoReloadAmountNanos ?? null,
      p_monthly_spend_limit: clearLimit ? null : (input.monthlySpendLimitNanos ?? null),
      p_clear_spend_limit: clearLimit,
    });
    if (error) throw billingError(error);

    const row = data as any;
    res.json({
      settings: {
        autoReloadEnabled: Boolean(row?.auto_reload_enabled),
        autoReloadThresholdNanos: toNanos(row?.auto_reload_threshold_nanos ?? 0),
        autoReloadAmountNanos: toNanos(row?.auto_reload_amount_nanos ?? 0),
        monthlySpendLimitNanos:
          row?.monthly_spend_limit_nanos === null || row?.monthly_spend_limit_nanos === undefined
            ? null
            : toNanos(row.monthly_spend_limit_nanos),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/ledger
 * Append-only credit history: grants, purchases, usage draw-downs, expirations.
 */
billingRouter.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('credit_ledger')
      .select('id, entry_type, bucket, amount_nanos, description, created_at')
      .eq('org_id', req.orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new HttpError(500, error.message, 'ledger_failed');

    res.json({
      entries: (data ?? []).map((e: any) => ({
        id: e.id,
        entryType: e.entry_type,
        bucket: e.bucket,
        amountNanos: toNanos(e.amount_nanos),
        description: e.description,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/billing/purchases — top-up history. */
billingRouter.get('/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('credit_purchases')
      .select('id, pack_code, credits_nanos, bonus_nanos, amount_cents, status, provider, is_auto_reload, created_at, completed_at')
      .eq('org_id', req.orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new HttpError(500, error.message, 'purchases_failed');

    res.json({
      purchases: (data ?? []).map((p: any) => ({
        id: p.id,
        packCode: p.pack_code,
        creditsNanos: toNanos(p.credits_nanos),
        bonusNanos: toNanos(p.bonus_nanos),
        amountCents: p.amount_cents,
        status: p.status,
        provider: p.provider,
        isAutoReload: p.is_auto_reload,
        createdAt: p.created_at,
        completedAt: p.completed_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/purchases
 *
 * Opens a purchase in `pending`. No credits exist until a payment is confirmed.
 *
 * This is the hand-off point for a real payment processor: create the
 * PaymentIntent (or equivalent) here, return its client secret alongside the
 * purchase id, and let the processor's webhook call
 * `complete_credit_purchase` with the service-role key. Until one is
 * configured, `PAYMENT_PROVIDER=dev` lets a billing manager settle their own
 * purchase through the confirm route below so the flow is exercisable
 * end-to-end.
 */
billingRouter.post('/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { packCode, amountCents } = startPurchaseSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase.rpc('start_credit_purchase', {
      p_org: req.orgId,
      p_pack_code: packCode ?? null,
      p_amount_cents: amountCents ?? null,
      p_provider: config.billing.paymentProvider,
      p_is_auto_reload: false,
    });
    if (error) throw billingError(error);

    const row = data as any;
    res.status(201).json({
      purchase: {
        id: row.id,
        packCode: row.pack_code,
        creditsNanos: toNanos(row.credits_nanos),
        bonusNanos: toNanos(row.bonus_nanos),
        amountCents: row.amount_cents,
        status: row.status,
        provider: row.provider,
      },
      // A real processor would return its client secret here for the browser
      // to confirm against; the dev provider needs no client-side step.
      requiresConfirmation: config.billing.paymentProvider === 'dev',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/purchases/:id/confirm
 *
 * Development-only settlement. With a real provider configured this is refused
 * — production credits are minted by the provider's webhook, authenticated with
 * the service-role key, never by a browser request.
 */
billingRouter.post('/purchases/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (config.billing.paymentProvider !== 'dev') {
      throw badRequest(
        'Purchases are settled by the payment provider, not by the client.',
        'confirmation_not_supported',
      );
    }

    const { purchaseId } = completePurchaseSchema.parse({ purchaseId: req.params.id });
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase.rpc('complete_credit_purchase', {
      p_purchase_id: purchaseId,
      p_provider_ref: `dev_${purchaseId}`,
    });
    if (error) throw billingError(error);

    const row = data as any;
    res.json({
      purchaseId: row.purchase_id,
      status: row.status,
      duplicate: Boolean(row.duplicate),
      creditedNanos: toNanos(row.credited_nanos ?? 0),
      balance: serializeBalance(row.balance),
    });
  } catch (err) {
    next(err);
  }
});
