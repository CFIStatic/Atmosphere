import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConfiguredOnboardingPrice, mapSubscriptionStatus } from './stripe.js';

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
