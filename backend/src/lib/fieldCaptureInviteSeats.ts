import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { isBillingExemptOrg, loadOrgCreatorEmail } from './billingExempt.js';
import { paymentRequired } from './errors.js';
import {
  extraSeatsNeeded,
  fcSeatLimitError,
  loadFieldCaptureSeatUsage,
  persistExtraFcSeats,
  readOrgBillingSeatState,
  type FieldCaptureSeatUsage,
} from './fieldCaptureSeats.js';
import { addExtraFieldCaptureSeats, decideFieldCaptureSeatAction } from './stripeExtraSeats.js';
import {
  ensureCustomer,
  extraSeatPriceId,
  isStripeConfigured,
  liveStripeCustomerId,
  liveStripeSubscriptionId,
  stripeClient,
  stripeIdempotencyKey,
} from './stripe.js';
import { resolveOnboardingPriceId } from './workspaceBilling.js';

export async function createWorkVerificationExtraSeatCheckout(input: {
  customerId: string;
  orgId: string;
  extraSeats: number;
  successUrl?: string;
  cancelUrl?: string;
  workVerificationPriceId: string;
}): Promise<string> {
  const extra = Math.max(1, Math.floor(input.extraSeats));
  const session = await stripeClient().checkout.sessions.create(
    {
      mode: 'subscription',
      customer: input.customerId,
      success_url: input.successUrl ?? config.stripe.successUrl,
      cancel_url: input.cancelUrl ?? config.stripe.cancelUrl,
      client_reference_id: input.orgId,
      metadata: {
        org_id: input.orgId,
        extra_fc_seats: String(extra),
        onboarding: 'true',
      },
      subscription_data: {
        metadata: {
          org_id: input.orgId,
          extra_fc_seats: String(extra),
          onboarding: 'true',
        },
      },
      line_items: [
        { price: input.workVerificationPriceId, quantity: 1 },
        { price: extraSeatPriceId(), quantity: extra },
      ],
    },
    { idempotencyKey: stripeIdempotencyKey('invite-extra-seats', input.orgId, extra) },
  );
  if (!session.url) {
    throw paymentRequired(
      'Stripe Checkout did not return a URL. Try again in a moment.',
      'checkout_unavailable',
    );
  }
  return session.url;
}

/**
 * Invite path is the seat path. At the included limit, add the extra seat
 * (Stripe item, complimentary bump, or Checkout redirect) before inserting.
 */
export async function ensureFieldCaptureSeatForInvite(
  supabase: SupabaseClient,
  orgId: string,
  opts: {
    actingUserEmail?: string | null;
    customerEmail?: string | null;
    orgName?: string | null;
  },
): Promise<FieldCaptureSeatUsage> {
  const seats = await loadFieldCaptureSeatUsage(supabase, orgId, {
    actingUserEmail: opts.actingUserEmail,
  });
  const billing = await readOrgBillingSeatState(supabase, orgId);
  const creatorEmail = await loadOrgCreatorEmail(supabase, orgId);
  const billingExempt = isBillingExemptOrg({
    status: billing.status,
    subscriptionId: billing.subscriptionId,
    creatorEmail,
    actingUserEmail: opts.actingUserEmail,
  });
  const liveSubscriptionId = liveStripeSubscriptionId(billing.subscriptionId);
  const extraNeeded = extraSeatsNeeded(seats.used + 1, seats.extra, seats.included);
  const decision = decideFieldCaptureSeatAction({
    remaining: seats.remaining,
    extraNeeded,
    billingExempt,
    liveSubscriptionId,
  });

  if (decision.action === 'allow') return seats;

  if (decision.action === 'grant_comped') {
    await persistExtraFcSeats(supabase, orgId, billing.extra + decision.addQuantity);
    return loadFieldCaptureSeatUsage(supabase, orgId, { actingUserEmail: opts.actingUserEmail });
  }

  if (config.billing.paymentProvider !== 'stripe' || !isStripeConfigured()) {
    throw fcSeatLimitError(seats.allowed, seats.used);
  }

  let customerId = liveStripeCustomerId(billing.customerId);
  if (!customerId) {
    customerId = await ensureCustomer(supabase, orgId, {
      email: opts.customerEmail,
      orgName: opts.orgName,
    });
  }

  const result = await addExtraFieldCaptureSeats(supabase, orgId, decision.addQuantity, {
    customerId,
    subscriptionId: billing.subscriptionId,
    billingExempt: false,
    createCheckout:
      decision.action === 'checkout'
        ? async ({ customerId: checkoutCustomerId, extraSeats }) => {
            const priceId = await resolveOnboardingPriceId(supabase, orgId);
            if (!priceId) {
              throw paymentRequired(
                'No Stripe price is configured for Work Verification. Set metering_plan_versions.stripe_price_id or STRIPE_ONBOARDING_PRICE_ID.',
                'price_not_configured',
              );
            }
            return createWorkVerificationExtraSeatCheckout({
              customerId: checkoutCustomerId,
              orgId,
              extraSeats,
              workVerificationPriceId: priceId,
            });
          }
        : undefined,
  });

  if (result.checkoutUrl) {
    throw paymentRequired(
      'Finish Work Verification checkout to add Field Capture seats, then send the invite again.',
      'fc_seat_checkout',
      { checkoutUrl: result.checkoutUrl },
    );
  }

  return loadFieldCaptureSeatUsage(supabase, orgId, { actingUserEmail: opts.actingUserEmail });
}
