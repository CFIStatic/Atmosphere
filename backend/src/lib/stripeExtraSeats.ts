import type { SupabaseClient } from '@supabase/supabase-js';
import { persistExtraFcSeats, readOrgBillingSeatState } from './fieldCaptureSeats.js';
import { paymentRequired } from './errors.js';
import { allowedFcSeats } from './stripeCatalog.js';
import {
  chestMountLineItems,
  chestMountPriceId,
  ensureSubscriptionAutomaticTax,
  type AutomaticTaxStripe,
} from './stripeTax.js';
import {
  adminClient,
  extraSeatPriceIdForInterval,
  findActiveWorkVerificationSubscriptionId,
  isExtraSeatLineItem,
  liveStripeCustomerId,
  liveStripeSubscriptionId,
  recurringIntervalFromSubscription,
  stripeClient,
  stripeIdempotencyKey,
} from './stripe.js';

/** The slice of the Stripe client the paid seat path uses (injectable for tests). */
export interface ExtraSeatStripe extends AutomaticTaxStripe {
  subscriptions: AutomaticTaxStripe['subscriptions'] & {
    retrieve(id: string): Promise<{
      items: { data: Array<{ id: string; quantity?: number | null; price?: unknown }> };
      automatic_tax?: { enabled?: boolean | null } | null;
      metadata?: Record<string, string> | null;
    }>;
  };
}

/**
 * Subscription update for N more Field Capture seats: set the extra-seat
 * quantity (or add the line) and put N Chest Mounts on the next invoice.
 */
export function extraSeatSubscriptionUpdate(input: {
  existingItemId: string | null;
  priceId: string;
  targetExtra: number;
  added: number;
  chestMountPrice?: string | null;
}): Record<string, unknown> {
  const mounts = chestMountLineItems(
    input.added,
    input.chestMountPrice === undefined ? chestMountPriceId() : input.chestMountPrice,
  );
  return {
    items: [
      input.existingItemId
        ? { id: input.existingItemId, quantity: input.targetExtra }
        : { price: input.priceId, quantity: input.targetExtra },
    ],
    proration_behavior: 'create_prorations',
    ...(mounts.length > 0 ? { add_invoice_items: mounts } : {}),
  };
}

export type FieldCaptureSeatAction =
  | { action: 'allow' }
  | { action: 'grant_comped'; addQuantity: number }
  | { action: 'charge_stripe'; addQuantity: number; subscriptionId: string }
  | { action: 'checkout'; addQuantity: number };

export function decideFieldCaptureSeatAction(input: {
  remaining: number;
  extraNeeded: number;
  billingExempt: boolean;
  liveSubscriptionId: string | null;
}): FieldCaptureSeatAction {
  if (input.remaining > 0) return { action: 'allow' };
  const addQuantity = Math.max(1, Math.floor(input.extraNeeded));
  if (input.billingExempt) return { action: 'grant_comped', addQuantity };
  if (input.liveSubscriptionId) {
    return { action: 'charge_stripe', addQuantity, subscriptionId: input.liveSubscriptionId };
  }
  return { action: 'checkout', addQuantity };
}

export function canOpenStripeBillingPortal(input: {
  billingExempt: boolean;
  customerId?: string | null;
}): boolean {
  return !input.billingExempt && Boolean(liveStripeCustomerId(input.customerId));
}

export async function addExtraFieldCaptureSeats(
  supabase: SupabaseClient,
  orgId: string,
  addQuantity: number,
  opts: {
    customerId?: string | null;
    subscriptionId?: string | null;
    billingExempt?: boolean;
    createCheckout?: (input: {
      customerId: string;
      orgId: string;
      extraSeats: number;
    }) => Promise<string>;
    /** Injected in tests; defaults to the configured Stripe client. */
    stripe?: ExtraSeatStripe;
    /** Persist target (tests); defaults to the service-role client. */
    persistWith?: SupabaseClient;
  },
): Promise<{
  checkoutUrl: string | null;
  updated: boolean;
  extraSeats: number;
  allowedSeats: number;
}> {
  const add = Math.max(1, Math.floor(addQuantity));
  const billing = await readOrgBillingSeatState(supabase, orgId);
  const currentExtra = billing.extra;
  const included = billing.included;
  const targetExtra = currentExtra + add;

  if (opts.billingExempt) {
    await persistExtraFcSeats(supabase, orgId, targetExtra);
    return {
      checkoutUrl: null,
      updated: true,
      extraSeats: targetExtra,
      allowedSeats: allowedFcSeats(targetExtra, included),
    };
  }

  const storedLiveId = liveStripeSubscriptionId(opts.subscriptionId);
  const customerId = liveStripeCustomerId(opts.customerId);
  // A stored `comp_*` (or any non-`sub_`) id is complimentary — never look it
  // up, and do not invent a paid subscription from a leftover customer id.
  const storedComplimentary = Boolean(opts.subscriptionId?.trim()) && !storedLiveId;
  let subscriptionId = storedLiveId;
  if (!subscriptionId && !storedComplimentary && customerId) {
    subscriptionId = await findActiveWorkVerificationSubscriptionId(customerId);
  }

  if (!subscriptionId) {
    if (opts.createCheckout && customerId) {
      const checkoutUrl = await opts.createCheckout({
        customerId,
        orgId,
        extraSeats: add,
      });
      return {
        checkoutUrl,
        updated: false,
        extraSeats: currentExtra,
        allowedSeats: allowedFcSeats(currentExtra, included),
      };
    }
    throw paymentRequired(
      'Add Field Capture seats after Work Verification billing is active.',
      'subscription_required',
    );
  }

  const stripe = (opts.stripe ?? stripeClient()) as ExtraSeatStripe;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  // Match the subscription interval. Stripe rejects a monthly seat on a yearly
  // plan (and the reverse). `create_prorations` is Stripe's default: an annual
  // seat is charged for the remainder of the prepaid term.
  const interval = recurringIntervalFromSubscription(sub as never);
  const priceId = extraSeatPriceIdForInterval(interval);
  if (!priceId) {
    throw paymentRequired(
      'Annual Field Capture seats are not configured. Set STRIPE_EXTRA_SEAT_ANNUAL_PRICE_ID.',
      'price_not_configured',
    );
  }
  // Older subscriptions predate Stripe Tax; turn it on first (best effort).
  await ensureSubscriptionAutomaticTax(stripe, subscriptionId, sub);
  const existing = sub.items.data.find((item) => isExtraSeatLineItem(item as never));
  // One update: the seat quantity plus one Chest Mount per new Field Capture
  // seat, as a one-time line on the next invoice (with the seat proration).
  await stripe.subscriptions.update(
    subscriptionId,
    extraSeatSubscriptionUpdate({ existingItemId: existing?.id ?? null, priceId, targetExtra, added: add }),
    {
      idempotencyKey: stripeIdempotencyKey(
        'extra-seats-v2',
        orgId,
        targetExtra,
        existing?.id ?? priceId,
      ),
    },
  );
  await persistExtraFcSeats(opts.persistWith ?? adminClient(), orgId, targetExtra);
  return {
    checkoutUrl: null,
    updated: true,
    extraSeats: targetExtra,
    allowedSeats: allowedFcSeats(targetExtra, included),
  };
}
