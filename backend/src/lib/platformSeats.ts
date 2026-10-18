/**
 * Platform-only seats: $75/mo per person, unlimited quantity.
 *
 * A Platform seat is a member with Global Admin access on
 * platform.atmosphereteam.com (every job, file and setting) who:
 *   - is never a Field Capture seat, and never counts toward chest mounts,
 *   - is refused by the Field Capture app with `platform_seat_no_field_capture`,
 *   - does not see Billing and Usage (those belong to the owner alone).
 *
 * Seats are an add-on to an existing workspace. org_billing.platform_seats is
 * how many the workspace has: on a comped workspace they are added free with
 * no Stripe call (same as complimentary Field Capture seats, #781); on a live
 * subscription a $75/mo line is added; otherwise Checkout opens with the plan
 * and the seat. Nothing is ever bought from the phone app. With no Platform
 * seat price configured, a paid workspace is told the seats are not
 * available yet (fail closed).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { isBillingExemptEmail, isBillingExemptOrg, loadOrgCreatorEmail } from './billingExempt.js';
import { forbidden, HttpError, paymentRequired } from './errors.js';
import { isWorkVerificationEntitled } from './fieldCaptureSeats.js';
import { unscopedAdminOrNull } from './scopedAdmin.js';
import { PLATFORM_SEAT_MONTHLY_CENTS, PLATFORM_SEAT_PLAN_CODE, atmospherePlan } from './stripeCatalog.js';
import { ensureSubscriptionAutomaticTax, withChestMounts, type AutomaticTaxStripe } from './stripeTax.js';

export const PLATFORM_SEAT_TYPE = 'platform';
export const FIELD_CAPTURE_SEAT_TYPE = 'field_capture';
export type SeatType = typeof PLATFORM_SEAT_TYPE | typeof FIELD_CAPTURE_SEAT_TYPE;

export const PLATFORM_SEAT_NO_FIELD_CAPTURE_MESSAGE =
  'This is a Platform account. It works on platform.atmosphereteam.com but not in Field Capture. ' +
  'To film jobs, ask your account owner for a Field Capture seat.';
export const PLATFORM_SEAT_UNAVAILABLE_MESSAGE =
  "Platform seats aren't available yet. Ask Atmosphere support to turn them on for this workspace.";
export const PLATFORM_SEAT_OWNER_ONLY_MESSAGE =
  'Every Platform seat on this workspace is in use. Ask the account owner to add a Platform seat.';
export const PLATFORM_SEAT_APP_MESSAGE =
  'Every Platform seat on this team is in use. Add Platform seats on platform.atmosphereteam.com.';
export const PLATFORM_SEAT_ANNUAL_MESSAGE =
  'Platform seats are billed monthly and this workspace is on a yearly plan. Contact Atmosphere support to add them.';

export function parseSeatType(value: unknown): SeatType {
  return value === PLATFORM_SEAT_TYPE ? PLATFORM_SEAT_TYPE : FIELD_CAPTURE_SEAT_TYPE;
}

export function isPlatformSeatType(value: unknown): boolean {
  return value === PLATFORM_SEAT_TYPE;
}

export function isPlatformSeatLimitDbError(error: { message?: string; hint?: string } | null | undefined): boolean {
  if (!error) return false;
  return /platform_seat_limit/i.test(`${error.message ?? ''} ${error.hint ?? ''}`);
}

export interface PlatformSeatUsage {
  /** Platform seats the workspace has (0 while lapsed). */
  allowed: number;
  used: number;
  remaining: number;
  priceCents: number;
  /** A new seat can be added: comped workspace, or a Platform seat price is configured. */
  available: boolean;
}

export function summarizePlatformSeats(input: {
  purchased: number;
  used: number;
  status: string | null | undefined;
  entitledOverride?: boolean;
  billingExempt: boolean;
  priceConfigured: boolean;
}): PlatformSeatUsage {
  const entitled = input.entitledOverride || isWorkVerificationEntitled(input.status);
  const allowed = entitled ? Math.max(0, Math.floor(input.purchased || 0)) : 0;
  const used = Math.max(0, Math.floor(input.used || 0));
  return {
    allowed,
    used,
    remaining: Math.max(0, allowed - used),
    priceCents: PLATFORM_SEAT_MONTHLY_CENTS,
    available: input.billingExempt || input.priceConfigured,
  };
}

/** True when this member holds a Platform seat in this org. Missing column → false. */
export async function isPlatformSeatMember(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('org_members')
    .select('seat_type')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (/seat_type|column .* does not exist/i.test(error.message)) return false;
    throw new HttpError(500, error.message, 'membership_lookup_failed');
  }
  return isPlatformSeatType((data as { seat_type?: string } | null)?.seat_type);
}

function profileEmail(row: { profiles?: { email?: string | null } | Array<{ email?: string | null }> | null }): string | null {
  const profiles = row.profiles;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  return (profile?.email as string | undefined) ?? null;
}

/** Platform members plus pending Platform invites (not yet members). */
export async function countPlatformSeats(supabase: SupabaseClient, orgId: string): Promise<number> {
  const [members, invites] = await Promise.all([
    supabase.from('org_members').select('seat_type, profiles(email)').eq('org_id', orgId),
    supabase.from('org_invites').select('email, seat_type').eq('org_id', orgId).eq('status', 'pending'),
  ]);
  if (members.error || invites.error) {
    const message = members.error?.message ?? invites.error?.message ?? '';
    if (/seat_type|column .* does not exist/i.test(message)) return 0;
    throw new Error(`Platform seat count failed: ${message}`);
  }
  const memberRows = (members.data ?? []) as unknown as Array<{
    seat_type?: string | null;
    profiles?: { email?: string | null } | Array<{ email?: string | null }> | null;
  }>;
  const memberEmails = new Set(
    memberRows.map((row) => profileEmail(row)?.trim().toLowerCase()).filter(Boolean) as string[],
  );
  let used = memberRows.filter((row) => isPlatformSeatType(row.seat_type)).length;
  for (const invite of (invites.data ?? []) as Array<{ email?: string | null; seat_type?: string | null }>) {
    if (!isPlatformSeatType(invite.seat_type)) continue;
    const email = invite.email?.trim().toLowerCase() ?? '';
    if (email && memberEmails.has(email)) continue;
    used += 1;
  }
  return used;
}

export interface PlatformSeatBillingState {
  purchased: number;
  status: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  planCode: string | null;
}

export async function readPlatformSeatBilling(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PlatformSeatBillingState> {
  const { data, error } = await supabase
    .from('org_billing')
    .select('platform_seats, status, stripe_subscription_id, stripe_customer_id, atmosphere_plan_code')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error && /platform_seats|column .* does not exist/i.test(error.message)) {
    const { data: fallback } = await supabase
      .from('org_billing')
      .select('status, stripe_subscription_id, stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle();
    const row = fallback as Record<string, string | null> | null;
    return {
      purchased: 0,
      status: row?.status ?? null,
      subscriptionId: row?.stripe_subscription_id ?? null,
      customerId: row?.stripe_customer_id ?? null,
      planCode: null,
    };
  }
  if (error) throw error;
  const row = data as {
    platform_seats?: number | null;
    status?: string | null;
    stripe_subscription_id?: string | null;
    stripe_customer_id?: string | null;
    atmosphere_plan_code?: string | null;
  } | null;
  const raw = Number(row?.platform_seats ?? 0);
  return {
    purchased: Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0,
    status: row?.status ?? null,
    subscriptionId: row?.stripe_subscription_id ?? null,
    customerId: row?.stripe_customer_id ?? null,
    planCode: row?.atmosphere_plan_code ?? null,
  };
}

/** Write org_billing.platform_seats with the service role (no authenticated UPDATE policy). */
export async function persistPlatformSeats(
  fallbackClient: SupabaseClient,
  orgId: string,
  seats: number,
): Promise<void> {
  const value = Math.max(0, Math.floor(seats));
  const writer = unscopedAdminOrNull() ?? fallbackClient;
  const { data, error } = await writer
    .from('org_billing')
    .update({ platform_seats: value })
    .eq('org_id', orgId)
    .select('org_id');
  if (error && /platform_seats|column .* does not exist/i.test(error.message)) {
    console.warn('[billing] platform_seats column is missing — apply the Platform seats migration');
    return;
  }
  if (error) throw new Error(`Platform seat sync failed: ${error.message}`);
  if (!data?.length) throw new Error('Platform seat sync failed: org_billing row was not updated');
}

export async function loadPlatformSeatUsage(
  supabase: SupabaseClient,
  orgId: string,
  opts: { actingUserEmail?: string | null; priceId?: string | null } = {},
): Promise<PlatformSeatUsage> {
  const [used, billing, creatorEmail] = await Promise.all([
    countPlatformSeats(supabase, orgId),
    readPlatformSeatBilling(supabase, orgId),
    loadOrgCreatorEmail(supabase, orgId),
  ]);
  const billingExempt = isBillingExemptOrg({
    status: billing.status,
    subscriptionId: billing.subscriptionId,
    creatorEmail,
    actingUserEmail: opts.actingUserEmail,
  });
  const priceId = opts.priceId === undefined ? await defaultPlatformSeatPriceId() : opts.priceId;
  return summarizePlatformSeats({
    purchased: billing.purchased,
    used,
    status: billing.status,
    entitledOverride: billingExempt || isBillingExemptEmail(creatorEmail),
    billingExempt,
    priceConfigured: Boolean(priceId),
  });
}

async function defaultPlatformSeatPriceId(): Promise<string | null> {
  const { platformSeatPriceId } = await import('./stripe.js');
  return platformSeatPriceId();
}

export type PlatformSeatAction =
  | { action: 'allow' }
  | { action: 'grant_comped' }
  | { action: 'unavailable' }
  | { action: 'charge_stripe'; subscriptionId: string }
  | { action: 'checkout' };

export function decidePlatformSeatAction(input: {
  remaining: number;
  billingExempt: boolean;
  liveSubscriptionId: string | null;
  priceId: string | null;
}): PlatformSeatAction {
  if (input.remaining > 0) return { action: 'allow' };
  if (input.billingExempt) return { action: 'grant_comped' };
  if (!input.priceId) return { action: 'unavailable' };
  if (input.liveSubscriptionId) return { action: 'charge_stripe', subscriptionId: input.liveSubscriptionId };
  return { action: 'checkout' };
}

/** The slice of the Stripe client this path uses (injectable for tests). */
export interface PlatformSeatStripe {
  subscriptions: {
    retrieve(id: string): Promise<{
      items: { data: Array<{ id: string; quantity?: number | null; price?: unknown }> };
      metadata?: Record<string, string> | null;
    }>;
  };
  subscriptionItems: {
    update(id: string, params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
    create(params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
  };
  checkout: {
    sessions: {
      create(params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ url?: string | null }>;
    };
  };
}

export interface PlatformSeatInviteInput {
  orgId: string;
  usage: PlatformSeatUsage;
  billing: PlatformSeatBillingState;
  billingExempt: boolean;
  priceId: string | null;
  fromAppShell?: boolean;
  /** Only the owner may add a paid seat or open Checkout. Omitted means owner. */
  actorIsOwner?: boolean;
}

export interface PlatformSeatInviteDeps {
  persist(orgId: string, seats: number): Promise<void>;
  /** Only called on the paid path. */
  stripe(): PlatformSeatStripe;
  isLiveSubscriptionId(id: string | null | undefined): string | null;
  /** Monthly or yearly, from the live subscription's plan item. */
  intervalOf(sub: Awaited<ReturnType<PlatformSeatStripe['subscriptions']['retrieve']>>): 'month' | 'year';
  isPlatformSeatItem(item: { price?: unknown }): boolean;
  idempotencyKey(...parts: Array<string | number>): string;
  /** Checkout (plan + Platform seat) for a workspace without a live subscription. */
  createCheckout(input: { orgId: string; priceId: string }): Promise<string>;
  /** Turn on Stripe Tax for an older live subscription. Optional (tests). */
  ensureAutomaticTax?(
    subscriptionId: string,
    sub: Awaited<ReturnType<PlatformSeatStripe['subscriptions']['retrieve']>>,
  ): Promise<unknown>;
}

/**
 * Make room for one more Platform seat before the invite row is inserted.
 * Returns how the seat was found; throws a clear 402/403 otherwise.
 */
export async function addPlatformSeatForInvite(
  input: PlatformSeatInviteInput,
  deps: PlatformSeatInviteDeps,
): Promise<{ action: PlatformSeatAction['action']; platformSeats: number; checkoutUrl?: string }> {
  const liveSubscriptionId = deps.isLiveSubscriptionId(input.billing.subscriptionId);
  const decision = decidePlatformSeatAction({
    remaining: input.usage.remaining,
    billingExempt: input.billingExempt,
    liveSubscriptionId,
    priceId: input.priceId,
  });
  const target = Math.max(input.billing.purchased, input.usage.used) + 1;

  if (decision.action === 'allow') return { action: 'allow', platformSeats: input.billing.purchased };

  if (decision.action === 'grant_comped') {
    // Complimentary workspace: the seat is free and Stripe is never called.
    await deps.persist(input.orgId, target);
    return { action: 'grant_comped', platformSeats: target };
  }

  if (input.actorIsOwner === false) {
    throw forbidden(PLATFORM_SEAT_OWNER_ONLY_MESSAGE, 'platform_seat_owner_only');
  }
  if (input.fromAppShell) {
    throw paymentRequired(PLATFORM_SEAT_APP_MESSAGE, 'platform_seat_limit_app');
  }
  if (decision.action === 'unavailable' || !input.priceId) {
    throw paymentRequired(PLATFORM_SEAT_UNAVAILABLE_MESSAGE, 'platform_seat_unavailable');
  }

  if (decision.action === 'charge_stripe') {
    const stripe = deps.stripe();
    const sub = await stripe.subscriptions.retrieve(decision.subscriptionId);
    if (deps.intervalOf(sub) === 'year') {
      throw paymentRequired(PLATFORM_SEAT_ANNUAL_MESSAGE, 'platform_seat_interval');
    }
    // Stripe Tax on the subscription before the $75 line is added (best effort).
    await deps.ensureAutomaticTax?.(decision.subscriptionId, sub);
    const existing = sub.items.data.find((item) => deps.isPlatformSeatItem(item));
    if (existing) {
      await stripe.subscriptionItems.update(
        existing.id,
        { quantity: target, proration_behavior: 'create_prorations' },
        { idempotencyKey: deps.idempotencyKey('platform-seats', input.orgId, target, existing.id) },
      );
    } else {
      await stripe.subscriptionItems.create(
        {
          subscription: decision.subscriptionId,
          price: input.priceId,
          quantity: target,
          proration_behavior: 'create_prorations',
          metadata: { atmosphere_plan_code: PLATFORM_SEAT_PLAN_CODE, org_id: input.orgId },
        },
        { idempotencyKey: deps.idempotencyKey('platform-seats', input.orgId, target, input.priceId, 'create') },
      );
    }
    await deps.persist(input.orgId, target);
    return { action: 'charge_stripe', platformSeats: target };
  }

  const checkoutUrl = await deps.createCheckout({ orgId: input.orgId, priceId: input.priceId });
  throw paymentRequired(
    'Finish checkout to add the Platform seat, then send the invite again.',
    'platform_seat_checkout',
    { checkoutUrl },
  );
}

/** Invite path for a Platform seat: load the workspace state, then make room. */
export async function ensurePlatformSeatForInvite(
  supabase: SupabaseClient,
  orgId: string,
  opts: {
    actingUserEmail?: string | null;
    customerEmail?: string | null;
    orgName?: string | null;
    fromAppShell?: boolean;
    actorIsOwner?: boolean;
  },
): Promise<PlatformSeatUsage> {
  const stripeLib = await import('./stripe.js');
  const priceId = stripeLib.platformSeatPriceId();
  const [billing, creatorEmail] = await Promise.all([
    readPlatformSeatBilling(supabase, orgId),
    loadOrgCreatorEmail(supabase, orgId),
  ]);
  const billingExempt = isBillingExemptOrg({
    status: billing.status,
    subscriptionId: billing.subscriptionId,
    creatorEmail,
    actingUserEmail: opts.actingUserEmail,
  });
  const usage = await loadPlatformSeatUsage(supabase, orgId, {
    actingUserEmail: opts.actingUserEmail,
    priceId,
  });

  await addPlatformSeatForInvite(
    { orgId, usage, billing, billingExempt, priceId, fromAppShell: opts.fromAppShell, actorIsOwner: opts.actorIsOwner },
    {
      persist: (id, seats) => persistPlatformSeats(supabase, id, seats),
      stripe: () => stripeLib.stripeClient() as unknown as PlatformSeatStripe,
      isLiveSubscriptionId: stripeLib.liveStripeSubscriptionId,
      intervalOf: (sub) => stripeLib.recurringIntervalFromSubscription(sub as never),
      isPlatformSeatItem: (item) => stripeLib.isPlatformSeatLineItem(item as never),
      idempotencyKey: (...parts) => stripeLib.stripeIdempotencyKey(...parts),
      ensureAutomaticTax: (subscriptionId, sub) =>
        ensureSubscriptionAutomaticTax(
          stripeLib.stripeClient() as unknown as AutomaticTaxStripe,
          subscriptionId,
          sub as { automatic_tax?: { enabled?: boolean | null } | null },
        ),
      createCheckout: async ({ orgId: id, priceId: seatPriceId }) => {
        if (config.billing.paymentProvider !== 'stripe' || !stripeLib.isStripeConfigured()) {
          throw paymentRequired(PLATFORM_SEAT_UNAVAILABLE_MESSAGE, 'platform_seat_unavailable');
        }
        const { resolveOnboardingPriceId } = await import('./workspaceBilling.js');
        const planPriceId = await resolveOnboardingPriceId(supabase, id, billing.planCode);
        if (!planPriceId) {
          throw paymentRequired('No Stripe price is configured for this plan.', 'price_not_configured');
        }
        if (stripeLib.billingIntervalForCheckoutPrice(planPriceId) === 'year') {
          throw paymentRequired(PLATFORM_SEAT_ANNUAL_MESSAGE, 'platform_seat_interval');
        }
        let customerId = stripeLib.liveStripeCustomerId(billing.customerId);
        if (!customerId) {
          customerId = await stripeLib.ensureCustomer(supabase, id, {
            email: opts.customerEmail,
            orgName: opts.orgName,
          });
        }
        const plan = atmospherePlan(billing.planCode);
        const meta = {
          org_id: id,
          onboarding: 'true',
          atmosphere_plan_code: plan.code,
          atmosphere_included_fc_seats: String(plan.includedFcSeats),
          platform_seats: String(Math.max(billing.purchased, usage.used) + 1),
          billing_interval: 'month',
          atmosphere_interval: 'month',
        };
        const session = await stripeLib.stripeClient().checkout.sessions.create(
          {
            mode: 'subscription',
            customer: customerId,
            success_url: config.stripe.successUrl,
            cancel_url: config.stripe.cancelUrl,
            client_reference_id: id,
            metadata: meta,
            subscription_data: { metadata: meta },
            // Chest Mounts for the plan's Field Capture seats only; a
            // Platform seat never gets one.
            ...withChestMounts(
              [
                { price: planPriceId, quantity: 1 },
                { price: seatPriceId, quantity: Math.max(billing.purchased, usage.used) + 1 },
              ],
              plan.includedFcSeats,
            ),
          },
          { idempotencyKey: stripeLib.stripeIdempotencyKey('invite-platform-seats-v2', id, usage.used + 1) },
        );
        if (!session.url) {
          throw paymentRequired('Stripe Checkout did not return a URL. Try again in a moment.', 'checkout_unavailable');
        }
        return session.url;
      },
    },
  );
  return loadPlatformSeatUsage(supabase, orgId, { actingUserEmail: opts.actingUserEmail, priceId });
}
