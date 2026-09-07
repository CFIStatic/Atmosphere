import type { SupabaseClient } from '@supabase/supabase-js';
import { persistExtraFcSeats, readExtraFcSeats } from './fieldCaptureSeats.js';
import { paymentRequired } from './errors.js';
import { allowedFcSeats } from './stripeCatalog.js';
import {
  adminClient,
  extraSeatPriceId,
  findActiveWorkVerificationSubscriptionId,
  isExtraSeatPriceId,
  liveStripeCustomerId,
  liveStripeSubscriptionId,
  stripeClient,
  stripeIdempotencyKey,
  subscriptionItemPriceId,
} from './stripe.js';

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
  },
): Promise<{
  checkoutUrl: string | null;
  updated: boolean;
  extraSeats: number;
  allowedSeats: number;
}> {
  const add = Math.max(1, Math.floor(addQuantity));
  const currentExtra = await readExtraFcSeats(supabase, orgId);
  const targetExtra = currentExtra + add;

  if (opts.billingExempt) {
    await persistExtraFcSeats(supabase, orgId, targetExtra);
    return {
      checkoutUrl: null,
      updated: true,
      extraSeats: targetExtra,
      allowedSeats: allowedFcSeats(targetExtra),
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
        allowedSeats: allowedFcSeats(currentExtra),
      };
    }
    throw paymentRequired(
      'Add Field Capture seats after Work Verification billing is active.',
      'subscription_required',
    );
  }

  const stripe = stripeClient();
  const priceId = extraSeatPriceId();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const existing = sub.items.data.find((item) => isExtraSeatPriceId(subscriptionItemPriceId(item)));
  if (existing) {
    await stripe.subscriptionItems.update(
      existing.id,
      { quantity: targetExtra, proration_behavior: 'create_prorations' },
      { idempotencyKey: stripeIdempotencyKey('extra-seats', orgId, targetExtra, existing.id) },
    );
  } else {
    await stripe.subscriptionItems.create(
      {
        subscription: subscriptionId,
        price: priceId,
        quantity: targetExtra,
        proration_behavior: 'create_prorations',
      },
      { idempotencyKey: stripeIdempotencyKey('extra-seats', orgId, targetExtra, 'create') },
    );
  }
  await persistExtraFcSeats(adminClient(), orgId, targetExtra);
  return {
    checkoutUrl: null,
    updated: true,
    extraSeats: targetExtra,
    allowedSeats: allowedFcSeats(targetExtra),
  };
}
