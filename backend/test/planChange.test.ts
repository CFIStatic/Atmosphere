import test from 'node:test';
import assert from 'node:assert/strict';
import { planChangeInterval, planItemUpdateParams } from '../src/lib/planChange.js';
import { resolveSelfServePriceId } from '../src/lib/stripe.js';

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
