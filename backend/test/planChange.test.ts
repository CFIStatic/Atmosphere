import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planChangeIdempotencyKey, planChangeInterval, planItemUpdateParams } from '../src/lib/planChange.js';
import { resolveSelfServePriceId, stripeIdempotencyKey } from '../src/lib/stripe.js';

test('a plan change updates the plan item in place and keeps extra seats', () => {
  const sub = {
    metadata: { billing_interval: 'year', atmosphere_interval: 'year' },
    items: {
      data: [
        {
          id: 'si_plan',
          quantity: 1,
          price: {
            id: 'price_work_year',
            recurring: { interval: 'year' },
            metadata: { atmosphere_plan_code: 'work_verification' },
          },
        },
        {
          id: 'si_seats',
          quantity: 4,
          price: {
            id: 'price_seat_year',
            recurring: { interval: 'year' },
            metadata: { atmosphere_plan_code: 'extra_fc_seat' },
          },
        },
      ],
    },
  };
  const interval = planChangeInterval(sub);
  assert.equal(interval, 'year');
  const nextPrice = resolveSelfServePriceId('scale', interval);
  assert.equal(nextPrice, resolveSelfServePriceId('scale', 'year'));
  assert.notEqual(nextPrice, resolveSelfServePriceId('scale', 'month'));
  const update = planItemUpdateParams(sub.items.data, nextPrice!);
  assert.deepEqual(update, {
    items: [{ id: 'si_plan', price: nextPrice }],
    proration_behavior: 'create_prorations',
  });
  assert.equal(update.items.some((item) => item.id === 'si_seats'), false);
  assert.equal(JSON.stringify(update).includes('deleted'), false);
});

test('switching back to a plan within 24 hours does not reuse the Stripe idempotency key', () => {
  const input = { orgId: 'org-1', planCode: 'scale', interval: 'month', priceId: 'price_scale_month' };
  const first = planChangeIdempotencyKey({ ...input, nonce: '11111111-1111-4111-8111-111111111111' });
  const back = planChangeIdempotencyKey({ ...input, nonce: '22222222-2222-4222-8222-222222222222' });
  const stable = stripeIdempotencyKey('plan-change', input.orgId, input.planCode, input.interval, input.priceId);
  assert.notEqual(first, back);
  assert.notEqual(first, stable);
  assert.notEqual(back, stable);
  const route = readFileSync(
    fileURLToPath(new URL('../src/routes/aiAllowance.ts', import.meta.url)),
    'utf8',
  );
  assert.match(route, /planChangeIdempotencyKey\(\{[\s\S]*nonce:\s*randomUUID\(\)/);
});
