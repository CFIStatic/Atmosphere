import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimStripeEvent,
  releaseStripeEventClaim,
  requireAttributedOrg,
  requireCreditPurchaseId,
} from '../src/lib/stripeWebhook.js';

test('requireAttributedOrg throws so Stripe retries instead of acknowledging a lost payment', () => {
  assert.equal(requireAttributedOrg('org-1', 'checkout cs_1'), 'org-1');
  assert.throws(
    () => requireAttributedOrg(null, 'checkout cs_1'),
    /could not be attributed to an org/,
  );
});

test('credit Checkout requires the purchase_id we opened', () => {
  assert.equal(requireCreditPurchaseId('payment', 'pur-1'), 'pur-1');
  assert.throws(() => requireCreditPurchaseId('payment', undefined), /missing purchase_id/);
  assert.equal(requireCreditPurchaseId('subscription', undefined), null);
});

test('a failed handler can release the event claim so the next delivery is not a duplicate', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'stripe_event_seen') return { data: true, error: null };
      if (name === 'stripe_event_forget') return { error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  };

  assert.equal(await claimStripeEvent(admin, { id: 'evt_1', type: 'checkout.session.completed' }), true);
  await releaseStripeEventClaim(admin, 'evt_1');
  assert.deepEqual(
    calls.map((c) => c.name),
    ['stripe_event_seen', 'stripe_event_forget'],
  );
  assert.equal(calls[1]?.args.p_event_id, 'evt_1');
});
