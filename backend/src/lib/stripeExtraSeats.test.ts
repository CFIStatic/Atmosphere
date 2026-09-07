import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './errors.js';
import {
  isLiveStripeCustomerId,
  isLiveStripeSubscriptionId,
  liveStripeCustomerId,
  liveStripeSubscriptionId,
} from './stripe.js';
import {
  addExtraFieldCaptureSeats,
  canOpenStripeBillingPortal,
  decideFieldCaptureSeatAction,
} from './stripeExtraSeats.js';

function billingClient(row: Record<string, unknown>, updated = [{ org_id: 'org-1' }]) {
  return {
    from(table: string) {
      assert.equal(table, 'org_billing');
      const chain = {
        select() {
          return chain;
        },
        update() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: updated, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

describe('live Stripe ids', () => {
  it('accepts Stripe subscription and customer ids and rejects founder comps', () => {
    assert.equal(isLiveStripeSubscriptionId('sub_1ABC'), true);
    assert.equal(isLiveStripeSubscriptionId('comp_jack_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), false);
    assert.equal(isLiveStripeSubscriptionId(''), false);
    assert.equal(liveStripeSubscriptionId('comp_jack_x'), null);
    assert.equal(liveStripeSubscriptionId('sub_1ABC'), 'sub_1ABC');
    assert.equal(isLiveStripeCustomerId('cus_1ABC'), true);
    assert.equal(isLiveStripeCustomerId('not-a-customer'), false);
    assert.equal(liveStripeCustomerId('cus_1ABC'), 'cus_1ABC');
  });
});

describe('Field Capture seat action', () => {
  it('allows an invite when a seat remains', () => {
    assert.deepEqual(
      decideFieldCaptureSeatAction({
        remaining: 1,
        extraNeeded: 0,
        billingExempt: false,
        liveSubscriptionId: 'sub_1',
      }),
      { action: 'allow' },
    );
  });

  it('auto-adds a complimentary seat without Stripe', () => {
    assert.deepEqual(
      decideFieldCaptureSeatAction({
        remaining: 0,
        extraNeeded: 1,
        billingExempt: true,
        liveSubscriptionId: 'sub_1',
      }),
      { action: 'grant_comped', addQuantity: 1 },
    );
  });

  it('charges the live Work Verification subscription when over the included limit', () => {
    assert.deepEqual(
      decideFieldCaptureSeatAction({
        remaining: 0,
        extraNeeded: 1,
        billingExempt: false,
        liveSubscriptionId: 'sub_1ABC',
      }),
      { action: 'charge_stripe', addQuantity: 1, subscriptionId: 'sub_1ABC' },
    );
  });

  it('asks for Checkout when there is no live subscription', () => {
    assert.deepEqual(
      decideFieldCaptureSeatAction({
        remaining: 0,
        extraNeeded: 1,
        billingExempt: false,
        liveSubscriptionId: null,
      }),
      { action: 'checkout', addQuantity: 1 },
    );
  });
});

describe('billing portal gating', () => {
  it('refuses complimentary orgs and fake customer ids', () => {
    assert.equal(
      canOpenStripeBillingPortal({
        billingExempt: true,
        customerId: 'cus_1ABC',
      }),
      false,
    );
    assert.equal(
      canOpenStripeBillingPortal({
        billingExempt: false,
        customerId: 'comp_jack_cus',
      }),
      false,
    );
    assert.equal(
      canOpenStripeBillingPortal({
        billingExempt: false,
        customerId: 'cus_1ABC',
      }),
      true,
    );
  });
});

describe('addExtraFieldCaptureSeats', () => {
  it('bumps extra_fc_seats for an exempt org without calling Stripe', async () => {
    const supabase = billingClient({ extra_fc_seats: 0, status: 'active' });
    const result = await addExtraFieldCaptureSeats(supabase as never, 'org-1', 1, {
      billingExempt: true,
      subscriptionId: 'comp_jack_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      customerId: 'cus_1ABC',
    });
    assert.deepEqual(result, {
      checkoutUrl: null,
      updated: true,
      extraSeats: 1,
      allowedSeats: 4,
    });
  });

  it('returns a checkout URL when there is no live subscription', async () => {
    const supabase = billingClient({ extra_fc_seats: 0, status: 'incomplete' });
    const result = await addExtraFieldCaptureSeats(supabase as never, 'org-1', 1, {
      customerId: 'cus_1ABC',
      subscriptionId: 'comp_jack_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      createCheckout: async () => 'https://checkout.stripe.test/session',
    });
    assert.deepEqual(result, {
      checkoutUrl: 'https://checkout.stripe.test/session',
      updated: false,
      extraSeats: 0,
      allowedSeats: 3,
    });
  });

  it('does not retrieve a complimentary subscription id from Stripe', async () => {
    const supabase = billingClient({ extra_fc_seats: 0, status: 'active' });
    await assert.rejects(
      () =>
        addExtraFieldCaptureSeats(supabase as never, 'org-1', 1, {
          customerId: null,
          subscriptionId: 'comp_jack_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        }),
      (err: unknown) =>
        err instanceof HttpError && err.status === 402 && err.code === 'subscription_required',
    );
  });
});
