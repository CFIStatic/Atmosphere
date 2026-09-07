import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { persistExtraFcSeats, readExtraFcSeats } from './fieldCaptureSeats.js';
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
import { FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE } from './stripeCatalog.js';

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

  if (subscriptionId) {
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

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: opts.customerId,
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      client_reference_id: orgId,
      metadata: {
        org_id: orgId,
        extra_fc_seats: String(targetExtra),
        kind: FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE,
      },
      subscription_data: {
        metadata: {
          org_id: orgId,
          extra_fc_seats: String(targetExtra),
          kind: FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE,
        },
      },
      line_items: [{ price: priceId, quantity: targetExtra }],
    },
    { idempotencyKey: stripeIdempotencyKey('extra-seats-checkout', orgId, targetExtra) },
  );

  return {
    checkoutUrl: session.url,
    updated: false,
    extraSeats: targetExtra,
    allowedSeats: allowedFcSeats(targetExtra),
  };
}
