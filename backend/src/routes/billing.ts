import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAnonClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { HttpError, badRequest, forbidden } from '../lib/errors.js';
import { toNanos } from '../lib/money.js';
import { ensureCustomer, stripeClient, stripeIdempotencyKey } from '../lib/stripe.js';
import { signupCheckoutReturnUrl } from '../lib/signupOnboarding.js';
import { loadWorkspaceBilling, resolveOnboardingPriceId } from '../lib/workspaceBilling.js';
import { loadTokenUsageReport, type TokenUsageRange } from '../metering/tokenUsage.js';
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
  onboardingCheckoutSchema,
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
    if (config.billing.paymentProvider === 'stripe') {
      throw badRequest(
        'Plan changes go through Stripe Checkout or the billing portal, not this endpoint.',
        'use_stripe_checkout',
      );
    }

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
 * Auto-reload thresholds and the monthly spend cap. Auto-reload is stored for
 * the credit catalog; it is not charged automatically. Sending
 * `monthlySpendLimitNanos: null` removes the cap; omitting the field leaves
 * it untouched.
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

    // With Stripe configured, hand back a hosted checkout URL. The credits are
    // granted by the webhook once the payment settles — landing back on the
    // success URL proves nothing, so nothing is granted here.
    let checkoutUrl: string | null = null;
    if (config.billing.paymentProvider === 'stripe') {
      const customerId = await ensureCustomer(supabase, req.orgId!, {
        email: req.user!.email,
        orgName: await orgName(supabase, req.orgId!),
      });

      const session = await stripeClient().checkout.sessions.create(
        {
          mode: 'payment',
          customer: customerId,
          success_url: config.stripe.successUrl,
          cancel_url: config.stripe.cancelUrl,
          client_reference_id: req.orgId,
          // Read back on the webhook to attribute the payment and find the
          // purchase it settles.
          metadata: { org_id: req.orgId!, purchase_id: row.id },
          payment_intent_data: {
            metadata: { org_id: req.orgId!, purchase_id: row.id },
            // Makes Stripe email a receipt for this charge.
            receipt_email: req.user!.email ?? undefined,
            description: 'Atmosphere usage credits',
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: row.amount_cents,
                product_data: {
                  name: 'Atmosphere usage credits',
                  description: `${formatCreditLabel(row)} of usage credits`,
                },
              },
            },
          ],
        },
        { idempotencyKey: stripeIdempotencyKey('credit-purchase', row.id) },
      );
      checkoutUrl = session.url;
    }

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
      checkoutUrl,
      // The dev provider settles in-app; Stripe settles by redirect + webhook.
      requiresConfirmation: config.billing.paymentProvider === 'dev',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/subscription
 * Hosted Stripe Checkout for a paid plan. The subscription itself is applied by
 * the `customer.subscription.*` webhook, not on return from checkout.
 */
billingRouter.post('/checkout/subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }

    const { planCode, billingInterval, seats } = setPlanSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data: plan, error: planError } = await supabase
      .from('billing_plans')
      .select('code, name, min_seats, is_contact_sales, stripe_price_id_monthly, stripe_price_id_annual')
      .eq('code', planCode)
      .maybeSingle();
    if (planError) throw new HttpError(500, planError.message, 'plan_lookup_failed');
    if (!plan) throw badRequest('Unknown plan.', 'unknown_plan');
    if (plan.is_contact_sales) throw badRequest('That plan is arranged with sales.', 'plan_requires_sales');

    const priceId =
      billingInterval === 'annual' ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
    if (!priceId) {
      throw badRequest(
        `No Stripe price is configured for the ${plan.name} plan (${billingInterval}).`,
        'price_not_configured',
      );
    }

    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: await orgName(supabase, req.orgId!),
    });

    const quantity = Math.max(seats, plan.min_seats ?? 1);
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        success_url: config.stripe.successUrl,
        cancel_url: config.stripe.cancelUrl,
        client_reference_id: req.orgId,
        metadata: { org_id: req.orgId! },
        subscription_data: { metadata: { org_id: req.orgId! } },
        line_items: [{ price: priceId, quantity }],
      },
      {
        idempotencyKey: stripeIdempotencyKey(
          'subscription',
          req.orgId,
          priceId,
          billingInterval,
          quantity,
        ),
      },
    );

    res.status(201).json({ checkoutUrl: session.url });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/portal
 * Stripe's hosted billing portal — card management, invoice history, and
 * cancellation, without us handling card data or reimplementing any of it.
 */
billingRouter.post('/portal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }

    const supabase = createUserClient(req.accessToken!);
    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: await orgName(supabase, req.orgId!),
    });

    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: config.stripe.portalReturnUrl,
    });

    res.status(201).json({ portalUrl: session.url });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/payments
 * The in-product payment history: every charge, refund and subscription
 * invoice, with links to the Stripe receipt and invoice PDF so a customer can
 * retrieve proof of payment at any time.
 */
billingRouter.get('/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('payments')
      .select(
        'id, kind, status, amount_cents, currency, description, receipt_url, hosted_invoice_url, invoice_pdf_url, receipt_email, card_brand, card_last4, period_start, period_end, failure_reason, created_at',
      )
      .eq('org_id', req.orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new HttpError(500, error.message, 'payments_failed');

    res.json({
      payments: (data ?? []).map((p: any) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountCents: p.amount_cents,
        currency: p.currency,
        description: p.description,
        receiptUrl: p.receipt_url,
        hostedInvoiceUrl: p.hosted_invoice_url,
        invoicePdfUrl: p.invoice_pdf_url,
        receiptEmail: p.receipt_email,
        cardBrand: p.card_brand,
        cardLast4: p.card_last4,
        periodStart: p.period_start,
        periodEnd: p.period_end,
        failureReason: p.failure_reason,
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/workspace
 * The customer-facing bill: Work Verification subscription + this period's usage.
 * Seat/credit `billing_overview` is not this product.
 */
billingRouter.get('/workspace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    res.json(await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id));
  } catch (err) {
    next(err);
  }
});

const TOKEN_USAGE_RANGES = new Set<TokenUsageRange>(['period', '30d', '90d']);

/**
 * GET /api/billing/token-usage
 *
 * Org-wide token meter plus a per-employee breakdown. Global Admins only —
 * employees do not see Settings → Billing.
 *
 * `range=period` (default) is the current Stripe / org billing period.
 * `30d` and `90d` are rolling windows for the usage graph.
 */
billingRouter.get('/token-usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data: overview, error } = await supabase.rpc('billing_overview', { p_org: req.orgId });
    if (error) throw billingError(error);
    if (!(overview as { can_manage?: boolean } | null)?.can_manage) {
      throw forbidden('Only a Global Admin can view token usage.', 'billing_forbidden');
    }

    const raw = typeof req.query.range === 'string' ? req.query.range : 'period';
    const range: TokenUsageRange = TOKEN_USAGE_RANGES.has(raw as TokenUsageRange)
      ? (raw as TokenUsageRange)
      : 'period';

    res.json(await loadTokenUsageReport(supabase, req.orgId!, range));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/onboarding
 * Whether the caller must finish Stripe setup before using the product.
 * Required only for the org creator when Stripe is configured; joiners inherit
 * the org's subscription and teammates skip this step.
 */
billingRouter.get('/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id);
    res.json({
      paymentProvider: workspace.paymentProvider,
      required: workspace.required,
      complete: workspace.complete,
      isCreator: workspace.isCreator,
      hasSubscription: workspace.subscription.hasStripeSubscription,
      plan: {
        name: workspace.subscription.name,
        baseMonthlyFeeCents: workspace.subscription.baseMonthlyFeeCents,
        includedJobs: workspace.subscription.includedJobs,
        additionalJobPriceCents: workspace.subscription.additionalJobPriceCents,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/onboarding
 * Hosted Stripe Checkout for the Work Verification platform subscription.
 * Applied by the subscription webhook — the browser only opens the session.
 */
billingRouter.post('/checkout/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }

    const { returnPath } = onboardingCheckoutSchema.parse(req.body ?? {});
    const supabase = createUserClient(req.accessToken!);
    const status = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id);

    if (!status.required) {
      throw badRequest('Billing setup is not required for this account.', 'billing_not_required');
    }
    if (status.complete) {
      throw badRequest('Billing is already set up for this organization.', 'billing_already_complete');
    }

    const priceId = await resolveOnboardingPriceId(supabase, req.orgId!);
    if (!priceId) {
      throw badRequest(
        'No Stripe price is configured for onboarding. Set metering_plan_versions.stripe_price_id or STRIPE_ONBOARDING_PRICE_ID.',
        'price_not_configured',
      );
    }

    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: await orgName(supabase, req.orgId!),
    });

    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        success_url: onboardingReturnUrl('success', returnPath),
        cancel_url: onboardingReturnUrl('cancelled', returnPath),
        client_reference_id: req.orgId,
        metadata: { org_id: req.orgId!, onboarding: 'true' },
        subscription_data: { metadata: { org_id: req.orgId!, onboarding: 'true' } },
        line_items: [{ price: priceId, quantity: 1 }],
      },
      { idempotencyKey: stripeIdempotencyKey('onboarding', req.orgId, priceId) },
    );

    res.status(201).json({ checkoutUrl: session.url });
  } catch (err) {
    next(err);
  }
});

function onboardingReturnUrl(kind: 'success' | 'cancelled', returnPath?: string) {
  return signupCheckoutReturnUrl({
    base: config.stripe.onboardingReturnBase,
    kind,
    returnPath,
  });
}

/** Organization name, for the Stripe customer record. */
async function orgName(supabase: ReturnType<typeof createUserClient>, orgId: string) {
  const { data } = await supabase.from('orgs').select('name').eq('id', orgId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/** "$100" / "$103 (incl. $3 bonus)" for the Stripe line item. */
function formatCreditLabel(row: any): string {
  const credits = toNanos(row.credits_nanos) / 1_000_000_000;
  const bonus = toNanos(row.bonus_nanos) / 1_000_000_000;
  return bonus > 0 ? `$${credits + bonus} (incl. $${bonus} bonus)` : `$${credits}`;
}

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
