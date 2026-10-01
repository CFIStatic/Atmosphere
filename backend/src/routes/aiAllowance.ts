/**
 * Customer allowance: meter, plan change, and credit packs.
 * Money is applied by the Stripe webhook, not by the success URL.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { createUserClient } from '../lib/supabase.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { planChangeIdempotencyKey, planChangeInterval, planItemUpdateParams } from '../lib/planChange.js';
import {
  ensureCustomer,
  isExtraSeatLineItem,
  liveStripeSubscriptionId,
  normalizeAtmosphereBillingInterval,
  stripeClient,
  stripeIdempotencyKey,
  subscriptionItemPriceId,
} from '../lib/stripe.js';
import { atmospherePlan, parseAtmospherePlanCode } from '../lib/stripeCatalog.js';
import { loadWorkspaceBilling, resolveOnboardingPriceId } from '../lib/workspaceBilling.js';
import { aiBudgetConfig, creditPackByCode, creditPackPriceId } from '../metering/aiBudgetConfig.js';
import { canPurchaseAiCredits, creditNanosForPaymentCents } from '../metering/aiBudget.js';
import { loadAiAllowance, publicAllowance } from '../metering/aiBudgetService.js';

export const aiAllowanceRouter = Router();
aiAllowanceRouter.use(requireAuth, requireOrg);

const packSchema = z.object({
  packCode: z.string().min(1).max(32),
});

const planSchema = z.object({
  planCode: z.string().min(1).max(64),
  billingInterval: z.string().optional(),
});

async function callerCanManage(req: Request): Promise<boolean> {
  const supabase = createUserClient(req.accessToken!);
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', req.orgId!)
    .eq('user_id', req.user!.id)
    .maybeSingle();
  return canPurchaseAiCredits((data as { role?: string } | null)?.role);
}

aiAllowanceRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const canManage = await callerCanManage(req);
    const workspace = await loadWorkspaceBilling(supabase, req.orgId!, req.user!.id, req.user!.email);
    const admin = unscopedAdminOrNull() ?? supabase;
    const view = await loadAiAllowance(admin, req.orgId!, {
      canManage,
      unlimited: workspace.billingExempt || workspace.subscription.status === 'comped',
    });
    res.json(publicAllowance(view));
  } catch (err) {
    next(err);
  }
});

aiAllowanceRouter.post('/credits/checkout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await callerCanManage(req))) {
      throw forbidden('Only an owner can buy AI credits.', 'billing_forbidden');
    }
    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }
    const { packCode } = packSchema.parse(req.body ?? {});
    const pack = creditPackByCode(packCode);
    if (!pack) throw badRequest('Unknown credit pack.', 'unknown_pack');
    const priceId = creditPackPriceId(pack.code);
    if (!priceId) {
      throw badRequest(
        `No Stripe price is configured for the ${pack.label} credit pack. Set ${pack.env} to a test-mode price id.`,
        'price_not_configured',
      );
    }
    const supabase = createUserClient(req.accessToken!);
    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: null,
    });
    const budget = aiBudgetConfig();
    const creditNanos = creditNanosForPaymentCents(pack.cents, budget.creditUsdRatio);
    const metadata = {
      org_id: req.orgId!,
      kind: 'ai_credits',
      pack_code: pack.code,
      pack_cents: String(pack.cents),
      credit_nanos: String(creditNanos),
    };
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'payment',
        customer: customerId,
        success_url: config.stripe.successUrl,
        cancel_url: config.stripe.cancelUrl,
        client_reference_id: req.orgId,
        metadata,
        invoice_creation: { enabled: true },
        line_items: [{ price: priceId, quantity: 1 }],
      },
      {
        // A stable key is replayed for 24 hours. Buying the same pack again
        // that day must open a new Checkout Session, not the one already paid.
        idempotencyKey: stripeIdempotencyKey('ai-credits', req.orgId, pack.code, priceId, randomUUID()),
      },
    );
    res.status(201).json({ checkoutUrl: session.url, packCode: pack.code });
  } catch (err) {
    next(err);
  }
});

aiAllowanceRouter.post('/plan/checkout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await callerCanManage(req))) {
      throw forbidden('Only an owner can change the plan.', 'billing_forbidden');
    }
    if (config.billing.paymentProvider !== 'stripe') {
      throw badRequest('Stripe is not configured on this server.', 'stripe_unconfigured');
    }
    const body = planSchema.parse(req.body ?? {});
    const plan = atmospherePlan(parseAtmospherePlanCode(body.planCode));
    const supabase = createUserClient(req.accessToken!);
    const { data: billing } = await supabase
      .from('org_billing')
      .select('stripe_subscription_id')
      .eq('org_id', req.orgId!)
      .maybeSingle();
    const currentSub = liveStripeSubscriptionId(
      (billing as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id,
    );
    if (currentSub) {
      const stripe = stripeClient();
      const existing = await stripe.subscriptions.retrieve(currentSub);
      const interval = planChangeInterval(existing);
      const priceId = await resolveOnboardingPriceId(supabase, req.orgId!, plan.code, interval);
      if (!priceId) {
        throw badRequest(`No Stripe price is configured for the ${plan.name} plan.`, 'price_not_configured');
      }
      const planItem = (existing.items?.data ?? []).find((item) => item.id && !isExtraSeatLineItem(item));
      if (subscriptionItemPriceId(planItem) === priceId) {
        res.status(200).json({ checkoutUrl: null, updated: true, planCode: plan.code, billingInterval: interval });
        return;
      }
      const update = planItemUpdateParams(existing.items?.data ?? [], priceId);
      // A stable key is replayed for 24 hours. Switching away and back to this
      // plan in that window must send a new update, not the cached one.
      await stripe.subscriptions.update(
        currentSub,
        {
          ...update,
          metadata: {
            org_id: req.orgId!,
            kind: 'plan_change',
            atmosphere_plan_code: plan.code,
            atmosphere_included_fc_seats: String(plan.includedFcSeats),
            billing_interval: interval,
            atmosphere_interval: interval,
          },
        },
        {
          idempotencyKey: planChangeIdempotencyKey({
            orgId: req.orgId!,
            planCode: plan.code,
            interval,
            priceId,
            nonce: randomUUID(),
          }),
        },
      );
      res.status(200).json({ checkoutUrl: null, updated: true, planCode: plan.code, billingInterval: interval });
      return;
    }
    const interval = normalizeAtmosphereBillingInterval(body.billingInterval);
    const priceId = await resolveOnboardingPriceId(supabase, req.orgId!, plan.code, interval);
    if (!priceId) {
      throw badRequest(`No Stripe price is configured for the ${plan.name} plan.`, 'price_not_configured');
    }
    const customerId = await ensureCustomer(supabase, req.orgId!, {
      email: req.user!.email,
      orgName: null,
    });
    const metadata: Record<string, string> = {
      org_id: req.orgId!,
      kind: 'plan_change',
      atmosphere_plan_code: plan.code,
      atmosphere_included_fc_seats: String(plan.includedFcSeats),
      billing_interval: interval,
      atmosphere_interval: interval,
    };
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        success_url: config.stripe.successUrl,
        cancel_url: config.stripe.cancelUrl,
        client_reference_id: req.orgId,
        metadata,
        subscription_data: { metadata },
        line_items: [{ price: priceId, quantity: 1 }],
      },
      { idempotencyKey: stripeIdempotencyKey('plan-change', req.orgId, plan.code, interval, priceId) },
    );
    res.status(201).json({ checkoutUrl: session.url, planCode: plan.code, billingInterval: interval });
  } catch (err) {
    next(err);
  }
});
