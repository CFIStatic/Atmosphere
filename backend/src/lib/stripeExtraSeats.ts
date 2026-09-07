import type { SupabaseClient } from '@supabase/supabase-js';
import { persistExtraFcSeats, readExtraFcSeats } from './fieldCaptureSeats.js';
import { paymentRequired } from './errors.js';
import { allowedFcSeats } from './stripeCatalog.js';
import {
  adminClient,
  extraSeatPriceId,
  findActiveWorkVerificationSubscriptionId,
  isExtraSeatPriceId,
  stripeClient,
  stripeIdempotencyKey,
  subscriptionItemPriceId,
} from './stripe.js';

export async function addExtraFieldCaptureSeats(
  supabase: SupabaseClient,
  orgId: string,
  addQuantity: number,
  opts: { customerId: string; subscriptionId?: string | null },
): Promise<{
  checkoutUrl: string | null;
  updated: boolean;
  extraSeats: number;
  allowedSeats: number;
}> {
  const add = Math.max(1, Math.floor(addQuantity));
  const currentExtra = await readExtraFcSeats(supabase, orgId);
  const targetExtra = currentExtra + add;
  const priceId = extraSeatPriceId();
  const stripe = stripeClient();
  const subscriptionId =
    opts.subscriptionId || (await findActiveWorkVerificationSubscriptionId(opts.customerId));

  if (!subscriptionId) {
    throw paymentRequired(
      'Add Field Capture seats after Work Verification billing is active.',
      'subscription_required',
    );
  }

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
