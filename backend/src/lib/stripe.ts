import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';

/**
 * Stripe wiring.
 *
 * Two rules shape everything here:
 *
 *  1. **Money is minted by the webhook, never by the browser.** A checkout
 *     endpoint only opens a session; credits and subscription changes are
 *     applied when Stripe tells us the payment settled, authenticated with the
 *     service-role key. A client that navigates back to a success URL has
 *     proved nothing.
 *
 *  2. **Every handler is replay-safe.** Stripe guarantees at-least-once
 *     delivery and retries on any non-2xx, so the same event will arrive twice.
 *     Idempotency is enforced in the database (a unique event id, unique
 *     payment-intent and invoice ids, and an already-completed purchase
 *     returning its original receipt).
 */

let client: Stripe | null = null;

export const isStripeConfigured = (): boolean => Boolean(config.stripe.secretKey);

export function stripeClient(): Stripe {
  if (!config.stripe.secretKey) {
    throw new HttpError(503, 'Payments are not configured on this server.', 'stripe_unconfigured');
  }
  client ??= new Stripe(config.stripe.secretKey);
  return client;
}

/** Service-role client for webhook writes; RLS does not apply to these. */
export function adminClient(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Payment processing requires SUPABASE_SERVICE_ROLE_KEY to be configured.',
      'service_role_unconfigured',
    );
  }
  return admin;
}

/**
 * Find or create the Stripe customer for an organization.
 *
 * The org id is written to customer metadata so an event that only carries a
 * customer id can still be attributed back to an org, and the email is set so
 * Stripe can send receipts.
 */
export async function ensureCustomer(
  supabase: SupabaseClient,
  orgId: string,
  opts: { email?: string | null; orgName?: string | null },
): Promise<string> {
  const { data, error } = await supabase
    .from('org_billing')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'customer_lookup_failed');

  const existing = data?.stripe_customer_id as string | undefined;
  if (existing) return existing;

  const customer = await stripeClient().customers.create({
    email: opts.email ?? undefined,
    name: opts.orgName ?? undefined,
    metadata: { org_id: orgId },
  });

  const { error: linkError } = await supabase.rpc('link_stripe_customer', {
    p_org: orgId,
    p_customer_id: customer.id,
  });
  if (linkError) throw new HttpError(500, linkError.message, 'customer_link_failed');

  return customer.id;
}

/**
 * Resolve the organization a Stripe object belongs to.
 *
 * Metadata is checked first because it is exact; the customer id is the
 * fallback for events that carry no metadata of their own.
 */
export async function resolveOrgId(
  admin: SupabaseClient,
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null | undefined,
): Promise<string | null> {
  const fromMetadata = metadata?.org_id;
  if (fromMetadata) return fromMetadata;

  if (!customerId) return null;
  const { data } = await admin
    .from('org_billing')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

/** Map a Stripe subscription status onto ours. */
export function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    default:
      return 'canceled';
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Look up which seat/credit plan a Stripe price belongs to.
 *
 * The price id is the only durable link between a Stripe subscription and our
 * plan catalog, so a price that is not in the catalog is a configuration error
 * worth surfacing rather than guessing around.
 */
export async function planForPrice(
  admin: SupabaseClient,
  priceId: string | null | undefined,
): Promise<{ code: string; interval: 'monthly' | 'annual' } | null> {
  if (!priceId) return null;

  const { data } = await admin
    .from('billing_plans')
    .select('code, stripe_price_id_monthly, stripe_price_id_annual')
    .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_annual.eq.${priceId}`)
    .maybeSingle();

  if (!data) return null;
  return {
    code: data.code as string,
    interval: data.stripe_price_id_annual === priceId ? 'annual' : 'monthly',
  };
}

/**
 * Look up whether a Stripe price is the Work Verification metering plan
 * (signup onboarding). Separate from `billing_plans` — that catalog is seats /
 * usage credits; metering is the $599/mo platform subscription.
 */
export async function meteringPlanForPrice(
  admin: SupabaseClient,
  priceId: string | null | undefined,
): Promise<{ code: string; name: string } | null> {
  if (!priceId) return null;

  const { data } = await admin
    .from('metering_plan_versions')
    .select('stripe_price_id, metering_plans(code, name)')
    .eq('stripe_price_id', priceId)
    .is('effective_to', null)
    .maybeSingle();

  if (!data) return null;
  const plan = Array.isArray((data as any).metering_plans)
    ? (data as any).metering_plans[0]
    : (data as any).metering_plans;
  if (!plan?.code) return null;
  return { code: plan.code as string, name: (plan.name as string) ?? plan.code };
}

/** True when the price matches STRIPE_ONBOARDING_PRICE_ID (DB may still be unset). */
export function isConfiguredOnboardingPrice(priceId: string | null | undefined): boolean {
  return Boolean(
    priceId && config.stripe.onboardingPriceId && priceId === config.stripe.onboardingPriceId,
  );
}

/**
 * Mark org_billing as subscribed for a metering / onboarding Checkout.
 *
 * Does not call `stripe_sync_subscription` — that RPC only knows
 * `billing_plans` codes. Signup completion only needs
 * `stripe_subscription_id` + an active/trialing status.
 */
export async function syncMeteringSubscription(
  admin: SupabaseClient,
  orgId: string,
  opts: {
    subscriptionId: string;
    status: Stripe.Subscription.Status;
    periodStart: string | null;
    periodEnd: string | null;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    stripe_subscription_id: opts.subscriptionId,
    status: mapSubscriptionStatus(opts.status),
    cancel_at_period_end: Boolean(opts.cancelAtPeriodEnd),
  };
  if (opts.periodStart) patch.period_start = opts.periodStart;
  if (opts.periodEnd) patch.period_end = opts.periodEnd;

  const { data, error } = await admin
    .from('org_billing')
    .update(patch)
    .eq('org_id', orgId)
    .select('org_id');
  if (error) throw new Error(`metering subscription sync failed: ${error.message}`);
  if (data && data.length > 0) return;

  // Checkout normally creates the row via link_stripe_customer. If the webhook
  // wins the race, still mark the org paid so signup can finish.
  const { error: insertError } = await admin.from('org_billing').insert({
    org_id: orgId,
    ...patch,
  });
  if (insertError) throw new Error(`metering subscription sync failed: ${insertError.message}`);
}

/** Seconds-since-epoch → ISO, for Stripe's period boundaries. */
export const toIso = (seconds: number | null | undefined): string | null =>
  typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;

/** Card brand/last4 off an expanded charge, for the payment history table. */
export function cardDetails(charge: Stripe.Charge | null | undefined) {
  const card = charge?.payment_method_details?.card;
  return { brand: card?.brand ?? null, last4: card?.last4 ?? null };
}
