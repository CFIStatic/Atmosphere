import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStripeSecretKey } from './stripeSecret.js';

describe('resolveStripeSecretKey', () => {
  it('returns empty when neither name is set', () => {
    assert.equal(resolveStripeSecretKey({}), '');
  });

  it('reads STRIPE_SECRET_KEY', () => {
    assert.equal(resolveStripeSecretKey({ STRIPE_SECRET_KEY: 'sk_test_canonical' }), 'sk_test_canonical');
  });

  it('falls back to Railway alias Stripe_Secret_Key', () => {
    assert.equal(
      resolveStripeSecretKey({ Stripe_Secret_Key: 'sk_live_railway' }),
      'sk_live_railway',
    );
  });

  it('prefers STRIPE_SECRET_KEY when both are set', () => {
    assert.equal(
      resolveStripeSecretKey({
        STRIPE_SECRET_KEY: 'sk_test_canonical',
        Stripe_Secret_Key: 'sk_live_railway',
      }),
      'sk_test_canonical',
    );
  });

  it('treats whitespace-only STRIPE_SECRET_KEY as unset and uses the alias', () => {
    assert.equal(
      resolveStripeSecretKey({
        STRIPE_SECRET_KEY: '   ',
        Stripe_Secret_Key: 'sk_live_railway',
      }),
      'sk_live_railway',
    );
  });

  it('treats whitespace-only values as unset', () => {
    assert.equal(
      resolveStripeSecretKey({
        STRIPE_SECRET_KEY: '  ',
        Stripe_Secret_Key: '\t',
      }),
      '',
    );
  });
});
