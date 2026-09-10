import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAnonClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { HttpError, badRequest, forbidden } from '../lib/errors.js';
import { toNanos } from '../lib/money.js';
import {
  ensureCustomer,
  isStripeConfigured,
  liveStripeCustomerId,
  stripeClient,
  stripeIdempotencyKey,
} from '../lib/stripe.js';
import { createWorkVerificationExtraSeatCheckout } from '../lib/fieldCaptureInviteSeats.js';
import { addExtraFieldCaptureSeats, canOpenStripeBillingPortal } from '../lib/stripeExtraSeats.js';
import { signupCheckoutReturnUrl } from '../lib/signupOnboarding.js';
import { loadWorkspaceBilling, publicSelfServePlans, resolveOnboardingPriceId } from '../lib/workspaceBilling.js';
import { atmospherePlan, parseAtmospherePlanCode } from '../lib/stripeCatalog.js';
import { loadOrgBillingInvoices } from '../lib/stripeInvoices.js';
import { loadTokenUsageReport, type TokenUsageRange } from '../metering/tokenUsage.js';
import {
  billingError,
  serializeBalance,
  serializeOverview,
  serializePlan,
} from '../lib/billing.js';
import {
  billingSettingsSchema,
  extraSeatCheckoutSchema,
  onboardingCheckoutSchema,
  setPlanSchema,
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

    // credit_packs + model_rate_card dropped — pricing via private.model_costs / quote_usage.
    const plans = await supabase
      .from('billing_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (plans.error) throw new HttpError(500, plans.error.message, 'catalog_failed');

    res.json({
      plans: (plans.data ?? []).map(serializePlan),
      packs: [],
      rateCard: [],
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
billingRouter.get('/ledger', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // credit_ledger dropped
    res.status(410).json({
      error: 'Legacy credit wallet removed. Use Stripe subscription / metering.',
      code: 'credit_wallet_gone',
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/billing/purchases — top-up history. */
billingRouter.get('/purchases', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // credit_purchases dropped
    res.status(410).json({
      error: 'Legacy credit wallet removed. Use Stripe subscription / metering.',
      code: 'credit_wallet_gone',
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
billingRouter.post('/purchases', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // start_credit_purchase / credit_packs dropped
    res.status(410).json({
      error: 'Legacy credit wallet removed. Use Stripe subscription / metering.',
      code: 'credit_wallet_gone',
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
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);
    const { data: billing } = await supabase
      .from('org_billing')
      .select('stripe_customer_id')
      .eq('org_id', req.orgId)
      .maybeSingle();
    const existingCustomerId = (billing?.stripe_customer_id as string | undefined) ?? null;

    if (workspace.billingExempt || !canOpenStripeBillingPortal({
      billingExempt: workspace.billingExempt,
      customerId: existingCustomerId,
    })) {
      if (workspace.billingExempt) {
        throw badRequest(
          'This complimentary account does not use the Stripe billing portal.',
          'billing_portal_unavailable',
        );
      }
      throw badRequest(
        'No Stripe customer is on file for this organization.',
        'stripe_customer_missing',
      );
    }

    const customerId =
      liveStripeCustomerId(existingCustomerId) ??
      (await ensureCustomer(supabase, req.orgId!, {
        email: req.user!.email,
        orgName: await orgName(supabase, req.orgId!),
      }));

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
billingRouter.get('/payments', async (req: Request, res: Response, _next: NextFunction) => {
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
    if (error) {
      console.warn('[billing] payment history unavailable:', error.message);
      res.json({ payments: [] });
      return;
    }

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
    console.warn('[billing] payment history unavailable:', err instanceof Error ? err.message : err);
    res.json({ payments: [] });
  }
});

/**
 * GET /api/billing/invoices
 *
 * Live Stripe invoices for this org (subscription renewals + same-day usage).
 * Complimentary orgs get an empty list, not an error. Receipt emails are sent
 * by Stripe; this list only exposes hosted invoice / PDF links.
 */
billingRouter.get('/invoices', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const supabase = createUserClient(req.accessToken!);
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);
    const { data: billing, error } = await supabase
      .from('org_billing')
      .select('stripe_customer_id')
      .eq('org_id', req.orgId)
      .maybeSingle();
    if (error) {
      console.warn('[billing] invoice customer lookup failed:', error.message);
    }

    res.json(
      await loadOrgBillingInvoices({
        customerId: (billing?.stripe_customer_id as string | undefined) ?? null,
        billingExempt: workspace.billingExempt,
        stripeConfigured: config.billing.paymentProvider === 'stripe' && isStripeConfigured(),
        limit,
      }),
    );
  } catch (err) {
    console.warn('[billing] invoice history unavailable:', err instanceof Error ? err.message : err);
    res.json({ invoices: [], complimentary: false });
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
    res.json(await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email));
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
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);
    res.json({
      paymentProvider: workspace.paymentProvider,
      required: workspace.required,
      complete: workspace.complete,
      isCreator: workspace.isCreator,
      hasSubscription: workspace.subscription.hasStripeSubscription,
      defaultPlanCode: 'work_verification',
      plans: publicSelfServePlans(),
      plan: {
        code: workspace.subscription.code,
        name: workspace.subscription.name,
        baseMonthlyFeeCents: workspace.subscription.baseMonthlyFeeCents,
        includedJobs: workspace.subscription.includedJobs,
        additionalJobPriceCents: workspace.subscription.additionalJobPriceCents,
        includedFcSeats: workspace.subscription.includedFcSeats,
      },
      fieldCaptureSeats: workspace.fieldCaptureSeats,
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

    const { returnPath, planCode: rawPlanCode } = onboardingCheckoutSchema.parse(req.body ?? {});
    const plan = atmospherePlan(parseAtmospherePlanCode(rawPlanCode));
    const supabase = createUserClient(req.accessToken!);
    const status = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);

    if (!status.required) {
      throw badRequest('Billing setup is not required for this account.', 'billing_not_required');
    }
    if (status.complete) {
      throw badRequest('Billing is already set up for this organization.', 'billing_already_complete');
    }

    const priceId = await resolveOnboardingPriceId(supabase, req.orgId!, plan.code);
    if (!priceId) {
      throw badRequest(
        `No Stripe price is configured for the ${plan.name} plan. Set ${
          plan.code === 'starter'
            ? 'STRIPE_STARTER_PRICE_ID'
            : plan.code === 'scale'
              ? 'STRIPE_SCALE_PRICE_ID'
              : 'STRIPE_ONBOARDING_PRICE_ID'
        }.`,
        'price_not_configured',
      );
    }

    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: await orgName(supabase, req.orgId!),
    });

    const planMeta = {
      org_id: req.orgId!,
      onboarding: 'true',
      atmosphere_plan_code: plan.code,
      atmosphere_included_fc_seats: String(plan.includedFcSeats),
    };

    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        success_url: onboardingReturnUrl('success', returnPath),
        cancel_url: onboardingReturnUrl('cancelled', returnPath),
        client_reference_id: req.orgId,
        metadata: planMeta,
        subscription_data: { metadata: planMeta },
        line_items: [{ price: priceId, quantity: 1 }],
      },
      { idempotencyKey: stripeIdempotencyKey('onboarding', req.orgId, priceId) },
    );

    res.status(201).json({ checkoutUrl: session.url });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/extra-seats
 * Add Field Capture extra seats ($125/mo each) on the live Work Verification
 * subscription. Refuses when that subscription is missing so we never open a
 * second extra-seat-only Checkout that can cancel the $849 plan.
 */
billingRouter.post('/checkout/extra-seats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { quantity } = extraSeatCheckoutSchema.parse(req.body ?? {});
    const supabase = createUserClient(req.accessToken!);
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);
    if (!workspace.canManage) {
      throw forbidden('Only a Global Admin can add Field Capture seats.', 'billing_forbidden');
    }

    const { data: billing } = await supabase
      .from('org_billing')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('org_id', req.orgId)
      .maybeSingle();

    if (workspace.billingExempt) {
      const result = await addExtraFieldCaptureSeats(supabase, req.orgId!, quantity, {
        customerId: (billing?.stripe_customer_id as string | undefined) ?? null,
        subscriptionId: (billing?.stripe_subscription_id as string | undefined) ?? null,
        billingExempt: true,
      });
      res.status(200).json(result);
      return;
    }

    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }

    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: await orgName(supabase, req.orgId!),
    });

    const result = await addExtraFieldCaptureSeats(supabase, req.orgId!, quantity, {
      customerId,
      subscriptionId: (billing?.stripe_subscription_id as string | undefined) ?? null,
      createCheckout: async ({ customerId: checkoutCustomerId, extraSeats }) => {
        const priceId = await resolveOnboardingPriceId(
          supabase,
          req.orgId!,
          workspace.subscription.code,
        );
        if (!priceId) {
          throw badRequest(
            'No Stripe price is configured for this plan. Set STRIPE_ONBOARDING_PRICE_ID, STRIPE_STARTER_PRICE_ID, or STRIPE_SCALE_PRICE_ID.',
            'price_not_configured',
          );
        }
        return createWorkVerificationExtraSeatCheckout({
          customerId: checkoutCustomerId,
          orgId: req.orgId!,
          extraSeats,
          workVerificationPriceId: priceId,
          planCode: workspace.subscription.code,
        });
      },
    });

    res.status(result.updated ? 200 : 201).json(result);
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

/**
 * POST /api/billing/purchases/:id/confirm
 *
 * Development-only settlement. With a real provider configured this is refused
 * — production credits are minted by the provider's webhook, authenticated with
 * the service-role key, never by a browser request.
 */
billingRouter.post('/purchases/:id/confirm', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // complete_credit_purchase dropped
    res.status(410).json({
      error: 'Legacy credit wallet removed. Use Stripe subscription / metering.',
      code: 'credit_wallet_gone',
    });
  } catch (err) {
    next(err);
  }
});
