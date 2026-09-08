import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  atmospherePlanCodeForPriceId,
  extraSeatQuantityFromSubscription,
  invoiceChargeId,
  isConfiguredOnboardingPrice,
  isExtraSeatOnlySubscription,
  isExtraSeatPriceId,
  isStripePriceId,
  mapSubscriptionStatus,
  resolveSelfServePriceId,
  shouldCancelOrgBillingForDeletedSubscription,
  stripeIdempotencyKey,
} from './stripe.js';
import {
  LEGACY_EXTRA_FC_SEAT_PRICE_ID,
  LEGACY_SCALE_PRICE_ID,
  LEGACY_STARTER_PRICE_ID,
  LEGACY_WORK_VERIFICATION_PRICE_ID,
  LIVE_EXTRA_FC_SEAT_PRICE_ID,
  LIVE_SCALE_PRICE_ID,
  LIVE_STARTER_PRICE_ID,
  LIVE_WORK_VERIFICATION_PRICE_ID,
} from './stripeCatalog.js';
import { planFromMeteringRow } from './workspaceBilling.js';
import type Stripe from 'stripe';

describe('mapSubscriptionStatus', () => {
  it('maps Stripe statuses onto org_billing statuses', () => {
    assert.equal(mapSubscriptionStatus('active'), 'active');
    assert.equal(mapSubscriptionStatus('trialing'), 'trialing');
    assert.equal(mapSubscriptionStatus('past_due'), 'past_due');
    assert.equal(mapSubscriptionStatus('unpaid'), 'past_due');
    assert.equal(mapSubscriptionStatus('canceled'), 'canceled');
  });
});

describe('isConfiguredOnboardingPrice', () => {
  it('is false when STRIPE_ONBOARDING_PRICE_ID is unset', () => {
    assert.equal(isConfiguredOnboardingPrice('price_abc'), false);
    assert.equal(isConfiguredOnboardingPrice(null), false);
    assert.equal(isConfiguredOnboardingPrice(undefined), false);
  });

  it('recognizes live Starter, Work Verification, and Scale prices', () => {
    assert.equal(isConfiguredOnboardingPrice(LIVE_STARTER_PRICE_ID), true);
    assert.equal(isConfiguredOnboardingPrice(LIVE_WORK_VERIFICATION_PRICE_ID), true);
    assert.equal(isConfiguredOnboardingPrice(LIVE_SCALE_PRICE_ID), true);
  });
});

describe('self-serve price resolution', () => {
  it('defaults checkout to Work Verification and maps live catalog ids', () => {
    assert.equal(resolveSelfServePriceId(undefined), LIVE_WORK_VERIFICATION_PRICE_ID);
    assert.equal(resolveSelfServePriceId('starter'), LIVE_STARTER_PRICE_ID);
    assert.equal(resolveSelfServePriceId('scale'), LIVE_SCALE_PRICE_ID);
    assert.equal(atmospherePlanCodeForPriceId(LIVE_STARTER_PRICE_ID), 'starter');
    assert.equal(atmospherePlanCodeForPriceId(LIVE_SCALE_PRICE_ID), 'scale');
    assert.equal(atmospherePlanCodeForPriceId(LIVE_WORK_VERIFICATION_PRICE_ID), 'work_verification');
    assert.equal(atmospherePlanCodeForPriceId(LEGACY_STARTER_PRICE_ID), 'starter');
    assert.equal(atmospherePlanCodeForPriceId(LEGACY_SCALE_PRICE_ID), 'scale');
    assert.equal(atmospherePlanCodeForPriceId(LEGACY_WORK_VERIFICATION_PRICE_ID), 'work_verification');
    assert.equal(isExtraSeatPriceId(LEGACY_EXTRA_FC_SEAT_PRICE_ID), true);
  });
});

describe('stripe helpers', () => {
  it('accepts Stripe price ids and rejects interpolation fodder', () => {
    assert.equal(isStripePriceId('price_1ABC'), true);
    assert.equal(isStripePriceId('price_'), false);
    assert.equal(isStripePriceId("price_1'),drop table"), false);
  });

  it('builds short stable idempotency keys', () => {
    assert.equal(stripeIdempotencyKey('onboarding', 'org-1', 'price_1'), 'onboarding:org-1:price_1');
  });

  it('reads a charge id from current and legacy Invoice shapes', () => {
    assert.equal(invoiceChargeId({ charge: 'ch_legacy' } as unknown as Stripe.Invoice), 'ch_legacy');
    assert.equal(
      invoiceChargeId({ latest_charge: 'ch_latest' } as unknown as Stripe.Invoice),
      'ch_latest',
    );
    assert.equal(
      invoiceChargeId({
        payments: { data: [{ payment: { charge: 'ch_payments' } }] },
      } as unknown as Stripe.Invoice),
      'ch_payments',
    );
    assert.equal(invoiceChargeId({} as Stripe.Invoice), null);
  });

  it('reads Work Verification terms from a metering join row', () => {
    const plan = planFromMeteringRow({
      metering_plan_versions: {
        base_monthly_fee_cents: 84900,
        included_jobs: 50,
        additional_job_price_cents: 3000,
        metering_plans: { name: 'Work Verification' },
      },
    });
    assert.equal(plan.name, 'Work Verification');
    assert.equal(plan.code, 'work_verification');
    assert.equal(plan.baseMonthlyFeeCents, 84900);
    assert.equal(plan.includedJobs, 50);
    assert.equal(plan.includedFcSeats, 3);
  });

  it('overlays Starter / Scale seats from the stored Atmosphere plan', () => {
    const starter = planFromMeteringRow(
      {
        metering_plan_versions: {
          base_monthly_fee_cents: 84900,
          included_jobs: 50,
          additional_job_price_cents: 3000,
          metering_plans: { name: 'Work Verification', code: 'work_verification' },
        },
      },
      { planCode: 'starter', includedFcSeats: 1 },
    );
    assert.equal(starter.name, 'Starter');
    assert.equal(starter.code, 'starter');
    assert.equal(starter.baseMonthlyFeeCents, 39900);
    assert.equal(starter.includedFcSeats, 1);

    const scale = planFromMeteringRow(null, { planCode: 'scale' });
    assert.equal(scale.name, 'Scale');
    assert.equal(scale.baseMonthlyFeeCents, 199900);
    assert.equal(scale.includedFcSeats, 10);
  });

  it('reads extra Field Capture seat quantity from a subscription', () => {
    assert.equal(isExtraSeatPriceId(LIVE_EXTRA_FC_SEAT_PRICE_ID), true);
    assert.equal(
      extraSeatQuantityFromSubscription({
        items: {
          data: [
            { price: { id: 'price_other' }, quantity: 1 },
            { price: { id: LIVE_EXTRA_FC_SEAT_PRICE_ID }, quantity: 2 },
          ],
        },
      }),
      2,
    );
  });

  it('does not cancel Work Verification when an extra-seat-only subscription ends', () => {
    const extraOnly = {
      metadata: { kind: 'field_capture_extra_seat', extra_fc_seats: '1' },
      items: { data: [{ price: { id: LIVE_EXTRA_FC_SEAT_PRICE_ID } }] },
    };
    assert.equal(isExtraSeatOnlySubscription(extraOnly), true);
    assert.equal(
      shouldCancelOrgBillingForDeletedSubscription({
        deletedSubscriptionId: 'sub_extra',
        storedSubscriptionId: 'sub_wv',
        subscription: extraOnly,
      }),
      false,
    );
    assert.equal(
      shouldCancelOrgBillingForDeletedSubscription({
        deletedSubscriptionId: 'sub_wv',
        storedSubscriptionId: 'sub_wv',
        subscription: {
          metadata: { onboarding: 'true' },
          items: { data: [{ price: { id: LIVE_WORK_VERIFICATION_PRICE_ID } }] },
        },
      }),
      true,
    );
  });
});
