import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceChargeId,
  isConfiguredOnboardingPrice,
  isStripePriceId,
  mapSubscriptionStatus,
  stripeIdempotencyKey,
} from './stripe.js';
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
        base_monthly_fee_cents: 59900,
        included_jobs: 50,
        additional_job_price_cents: 3000,
        metering_plans: { name: 'Work Verification' },
      },
    });
    assert.equal(plan.name, 'Work Verification');
    assert.equal(plan.baseMonthlyFeeCents, 59900);
    assert.equal(plan.includedJobs, 50);
  });
});
