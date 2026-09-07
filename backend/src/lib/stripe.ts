import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { persistExtraFcSeats } from './fieldCaptureSeats.js';
import { unscopedAdmin } from './scopedAdmin.js';
import { HttpError } from './errors.js';
import {
  FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE,
  LIVE_EXTRA_FC_SEAT_PRICE_ID,
  LIVE_SCALE_PRICE_ID,
  LIVE_STARTER_PRICE_ID,
  LIVE_WORK_VERIFICATION_PRICE_ID,
  WORK_VERIFICATION_PLAN_CODE,
  atmospherePlan,
  isAtmosphereSelfServePlanCode,
  type AtmosphereSelfServePlanCode,
} from './stripeCatalog.js';

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

/**
 * Pin the account API version so Invoice / Charge field shapes do not drift
 * under us when Stripe ships a new default. Cast because the SDK's
 * `LatestApiVersion` union moves with the package.
 */
export const STRIPE_API_VERSION = '2026-06-24.dahlia' as Stripe.LatestApiVersion;

const STRIPE_PRICE_ID = /^price_[A-Za-z0-9]+$/;
const STRIPE_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;

export const isStripeConfigured = (): boolean => Boolean(config.stripe.secretKey);

export function isStripePriceId(priceId: string | null | undefined): priceId is string {
  return Boolean(priceId && STRIPE_PRICE_ID.test(priceId));
}

/** Live Stripe subscription ids only — complimentary `comp_*` rows must never hit the API. */
export function isLiveStripeSubscriptionId(id: string | null | undefined): id is string {
  return Boolean(id && STRIPE_SUBSCRIPTION_ID.test(id.trim()));
}

export function liveStripeSubscriptionId(id: string | null | undefined): string | null {
  const value = id?.trim();
  return value && isLiveStripeSubscriptionId(value) ? value : null;
}

export function isLiveStripeCustomerId(id: string | null | undefined): id is string {
  return Boolean(id && STRIPE_CUSTOMER_ID.test(id.trim()));
}

export function liveStripeCustomerId(id: string | null | undefined): string | null {
  const value = id?.trim();
  return value && isLiveStripeCustomerId(value) ? value : null;
}

/** Stripe idempotency keys are 255 characters; we keep ours short and stable. */
export function stripeIdempotencyKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(':')
    .slice(0, 255);
}

export function stripeClient(): Stripe {
  if (!config.stripe.secretKey) {
    throw new HttpError(503, 'Payments are not configured on this server.', 'stripe_unconfigured');
  }
  client ??= new Stripe(config.stripe.secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  return client;
}

/** Service-role client for webhook writes; RLS does not apply to these. */
export function adminClient(): SupabaseClient {
  try {
    return unscopedAdmin();
  } catch {
    throw new HttpError(
      503,
      'Payment processing requires SUPABASE_SERVICE_ROLE_KEY to be configured.',
      'service_role_unconfigured',
    );
  }
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

  // Two overlapping checkouts must not create two customers. Search Stripe
  // first (metadata is written on create), then create, then re-read if the
  // unique link loses the race.
  const found = await findCustomerByOrgId(orgId);
  const customerId = found ?? (await createCustomer(orgId, opts)).id;

  const { error: linkError } = await supabase.rpc('link_stripe_customer', {
    p_org: orgId,
    p_customer_id: customerId,
  });
  if (linkError) {
    const winner = await readLinkedCustomer(supabase, orgId);
    if (winner) return winner;
    throw new HttpError(500, linkError.message, 'customer_link_failed');
  }

  return customerId;
}

async function readLinkedCustomer(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from('org_billing')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data?.stripe_customer_id as string | undefined) ?? null;
}

async function findCustomerByOrgId(orgId: string): Promise<string | null> {
  const listed = await stripeClient().customers.search({
    query: `metadata["org_id"]:"${orgId}"`,
    limit: 1,
  });
  return listed.data[0]?.id ?? null;
}

async function createCustomer(
  orgId: string,
  opts: { email?: string | null; orgName?: string | null },
): Promise<Stripe.Customer> {
  return stripeClient().customers.create(
    {
      email: opts.email ?? undefined,
      name: opts.orgName ?? undefined,
      metadata: { org_id: orgId },
    },
    { idempotencyKey: stripeIdempotencyKey('customer', orgId) },
  );
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
  if (!isStripePriceId(priceId)) return null;

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
 * Look up whether a Stripe price is an Atmosphere platform metering plan
 * (signup onboarding). Separate from `billing_plans` — that catalog is seats /
 * usage credits; metering is the Starter / Work Verification / Scale subscription.
 */
export async function meteringPlanForPrice(
  admin: SupabaseClient,
  priceId: string | null | undefined,
): Promise<{ code: string; name: string } | null> {
  if (!isStripePriceId(priceId)) return null;

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

/** Configured Stripe price ids for Starter / Work Verification / Scale. */
export function configuredSelfServePriceIds(): string[] {
  return [
    config.stripe.onboardingPriceId,
    config.stripe.starterPriceId,
    config.stripe.scalePriceId,
    LIVE_STARTER_PRICE_ID,
    LIVE_WORK_VERIFICATION_PRICE_ID,
    LIVE_SCALE_PRICE_ID,
  ].filter(Boolean);
}

/** True when the price is a configured Atmosphere platform plan. */
export function isConfiguredOnboardingPrice(priceId: string | null | undefined): boolean {
  return Boolean(priceId && configuredSelfServePriceIds().includes(priceId));
}

export function resolveSelfServePriceId(
  planCode?: string | null,
): string | null {
  const plan = atmospherePlan(planCode);
  if (plan.code === 'starter') return config.stripe.starterPriceId || LIVE_STARTER_PRICE_ID;
  if (plan.code === 'scale') return config.stripe.scalePriceId || LIVE_SCALE_PRICE_ID;
  return config.stripe.onboardingPriceId || LIVE_WORK_VERIFICATION_PRICE_ID;
}

export function atmospherePlanCodeForPriceId(
  priceId: string | null | undefined,
): AtmosphereSelfServePlanCode | null {
  if (!priceId) return null;
  if (priceId === config.stripe.starterPriceId || priceId === LIVE_STARTER_PRICE_ID) {
    return 'starter';
  }
  if (priceId === config.stripe.scalePriceId || priceId === LIVE_SCALE_PRICE_ID) {
    return 'scale';
  }
  if (isWorkVerificationPriceId(priceId)) return WORK_VERIFICATION_PLAN_CODE;
  return null;
}

export function extraSeatPriceId(): string {
  return config.stripe.extraSeatPriceId || LIVE_EXTRA_FC_SEAT_PRICE_ID;
}

export function isExtraSeatPriceId(priceId: string | null | undefined): boolean {
  return Boolean(priceId && (priceId === extraSeatPriceId() || priceId === LIVE_EXTRA_FC_SEAT_PRICE_ID));
}

export function isWorkVerificationPriceId(priceId: string | null | undefined): boolean {
  return Boolean(
    priceId &&
      (priceId === config.stripe.onboardingPriceId || priceId === LIVE_WORK_VERIFICATION_PRICE_ID),
  );
}

export function subscriptionItemPriceId(item: { price?: { id?: string } | string | null } | null | undefined): string | null {
  const price = item?.price;
  if (typeof price === 'string') return price;
  return price?.id ?? null;
}

export function extraSeatQuantityFromSubscription(sub: {
  items?: { data?: Array<{ price?: { id?: string } | string | null; quantity?: number | null }> };
}): number {
  return (sub.items?.data ?? []).reduce((sum, item) => {
    const priceId = subscriptionItemPriceId(item);
    if (!isExtraSeatPriceId(priceId)) return sum;
    return sum + Math.max(0, item.quantity ?? 1);
  }, 0);
}

export function subscriptionHasWorkVerification(sub: {
  metadata?: { onboarding?: string; atmosphere_plan_code?: string } | null;
  items?: { data?: Array<{ price?: { id?: string } | string | null }> };
}): boolean {
  if (sub.metadata?.onboarding === 'true') return true;
  if (isAtmosphereSelfServePlanCode(sub.metadata?.atmosphere_plan_code)) return true;
  return (sub.items?.data ?? []).some((item) => {
    const priceId = subscriptionItemPriceId(item);
    return isWorkVerificationPriceId(priceId) || isConfiguredOnboardingPrice(priceId);
  });
}

/** Extra-seat Checkout can open a second subscription. Do not treat it as Work Verification. */
export function isExtraSeatOnlySubscription(sub: {
  metadata?: { onboarding?: string; kind?: string; extra_fc_seats?: string } | null;
  items?: { data?: Array<{ price?: { id?: string } | string | null }> };
}): boolean {
  if (subscriptionHasWorkVerification(sub)) return false;
  if (sub.metadata?.kind === FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE) return true;
  const items = sub.items?.data ?? [];
  if (items.length === 0) return Boolean(sub.metadata?.extra_fc_seats);
  const hasExtra = items.some((item) => isExtraSeatPriceId(subscriptionItemPriceId(item)));
  return hasExtra;
}

export function shouldCancelOrgBillingForDeletedSubscription(input: {
  deletedSubscriptionId: string;
  storedSubscriptionId?: string | null;
  subscription: {
    metadata?: { onboarding?: string; kind?: string; extra_fc_seats?: string } | null;
    items?: { data?: Array<{ price?: { id?: string } | string | null }> };
  };
}): boolean {
  if (isExtraSeatOnlySubscription(input.subscription)) return false;
  if (input.storedSubscriptionId && input.storedSubscriptionId !== input.deletedSubscriptionId) {
    return false;
  }
  return true;
}

export async function findActiveWorkVerificationSubscriptionId(
  customerId: string,
): Promise<string | null> {
  const listed = await stripeClient().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  for (const sub of listed.data) {
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;
    if (isExtraSeatOnlySubscription(sub)) continue;
    if (subscriptionHasWorkVerification(sub)) return sub.id;
  }
  return null;
}

export async function syncExtraFcSeatsFromCustomer(
  admin: SupabaseClient,
  orgId: string,
  customerId: string | null | undefined,
): Promise<number> {
  if (!customerId) return 0;
  const listed = await stripeClient().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  let extra = 0;
  for (const sub of listed.data) {
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;
    extra += extraSeatQuantityFromSubscription(sub);
  }
  await persistExtraFcSeats(admin, orgId, extra);
  return extra;
}

export function pricePlanCode(price: { metadata?: Stripe.Metadata | null; id?: string } | null | undefined): string | null {
  const fromMeta = price?.metadata?.atmosphere_plan_code;
  if (fromMeta) return fromMeta;
  const fromPrice = atmospherePlanCodeForPriceId(price?.id);
  if (fromPrice) return fromPrice;
  if (isExtraSeatPriceId(price?.id)) return FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE;
  return null;
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
    planCode?: string | null;
    includedFcSeats?: number | null;
  },
): Promise<void> {
  const plan = atmospherePlan(opts.planCode);
  const included =
    opts.includedFcSeats != null && Number.isFinite(Number(opts.includedFcSeats))
      ? Math.max(0, Math.floor(Number(opts.includedFcSeats)))
      : plan.includedFcSeats;
  const patch: Record<string, unknown> = {
    stripe_subscription_id: opts.subscriptionId,
    status: mapSubscriptionStatus(opts.status),
    cancel_at_period_end: Boolean(opts.cancelAtPeriodEnd),
    atmosphere_plan_code: plan.code,
    included_fc_seats: included,
  };
  if (opts.periodStart) patch.period_start = opts.periodStart;
  if (opts.periodEnd) patch.period_end = opts.periodEnd;

  const write = async (row: Record<string, unknown>) => {
    const { data, error } = await admin
      .from('org_billing')
      .update(row)
      .eq('org_id', orgId)
      .select('org_id');
    if (error) return { data: null, error };
    if (data && data.length > 0) return { data, error: null };
    const inserted = await admin.from('org_billing').insert({ org_id: orgId, ...row });
    return { data: inserted.data, error: inserted.error };
  };

  let result = await write(patch);
  if (result.error && /atmosphere_plan_code|included_fc_seats|column .* does not exist/i.test(result.error.message)) {
    const fallback = { ...patch };
    delete fallback.atmosphere_plan_code;
    delete fallback.included_fc_seats;
    result = await write(fallback);
  }
  if (result.error) throw new Error(`metering subscription sync failed: ${result.error.message}`);
}

/** Seconds-since-epoch → ISO, for Stripe's period boundaries. */
export const toIso = (seconds: number | null | undefined): string | null =>
  typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;

/** Card brand/last4 off an expanded charge, for the payment history table. */
export function cardDetails(charge: Stripe.Charge | null | undefined) {
  const card = charge?.payment_method_details?.card;
  return { brand: card?.brand ?? null, last4: card?.last4 ?? null };
}

/**
 * Invoice.charge was removed in the 2025+ Invoice API. Read whichever field
 * the account's version still provides so receipts stay populated.
 */
export function invoiceChargeId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    charge?: string | { id?: string } | null;
    latest_charge?: string | { id?: string } | null;
    payments?: { data?: Array<{ payment?: { charge?: string | { id?: string } | null } }> };
  };
  const asId = (value: string | { id?: string } | null | undefined): string | null => {
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object' && value.id) return value.id;
    return null;
  };
  return (
    asId(raw.charge) ??
    asId(raw.latest_charge) ??
    asId(raw.payments?.data?.[0]?.payment?.charge) ??
    null
  );
}
