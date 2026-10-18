import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  CHEST_MOUNT_PRICE_CENTS,
  LIVE_CHEST_MOUNT_PRICE_ID,
  LEGACY_CHEST_MOUNT_PRICE_ID,
} from '../src/lib/stripeCatalog.js';
import {
  checkoutTaxParams,
  chestMountLineItems,
  chestMountPriceId,
  ensureSubscriptionAutomaticTax,
  withChestMounts,
} from '../src/lib/stripeTax.js';
import {
  addExtraFieldCaptureSeats,
  extraSeatSubscriptionUpdate,
  type ExtraSeatStripe,
} from '../src/lib/stripeExtraSeats.js';
import {
  addPlatformSeatForInvite,
  summarizePlatformSeats,
  type PlatformSeatInviteDeps,
  type PlatformSeatStripe,
} from '../src/lib/platformSeats.js';

/* ----------------------------------------------------------- Stripe Tax */

test('Checkout turns on Stripe Tax and collects what it needs to calculate', () => {
  const params = checkoutTaxParams({ taxEnabled: true });
  assert.deepEqual(params.automatic_tax, { enabled: true });
  assert.equal(params.billing_address_collection, 'required');
  assert.deepEqual(params.tax_id_collection, { enabled: true });
  // Existing customers: Checkout must be allowed to save the address and name.
  assert.deepEqual(params.customer_update, { address: 'auto', name: 'auto' });
  assert.equal('shipping_address_collection' in params, false);
});

test('STRIPE_AUTOMATIC_TAX=off removes every tax param', () => {
  assert.deepEqual(checkoutTaxParams({ taxEnabled: false }), {});
});

test('a Chest Mount sale also collects a US/CA shipping address, tax or not', () => {
  const taxed = checkoutTaxParams({ taxEnabled: true, shipsHardware: true });
  assert.deepEqual(taxed.shipping_address_collection, { allowed_countries: ['US', 'CA'] });
  assert.deepEqual(taxed.customer_update, { address: 'auto', name: 'auto', shipping: 'auto' });
  const untaxed = checkoutTaxParams({ taxEnabled: false, shipsHardware: true });
  assert.deepEqual(untaxed, {
    shipping_address_collection: { allowed_countries: ['US', 'CA'] },
    customer_update: { shipping: 'auto' },
  });
});

test('an older subscription gets automatic_tax turned on once', async () => {
  const updates: Array<[string, Record<string, unknown>]> = [];
  const stripe = { subscriptions: { update: async (id: string, p: Record<string, unknown>) => void updates.push([id, p]) } };
  assert.equal(await ensureSubscriptionAutomaticTax(stripe, 'sub_1', { automatic_tax: { enabled: false } }, { taxEnabled: true }), 'enabled');
  assert.deepEqual(updates, [['sub_1', { automatic_tax: { enabled: true } }]]);
  assert.equal(await ensureSubscriptionAutomaticTax(stripe, 'sub_1', { automatic_tax: { enabled: true } }, { taxEnabled: true }), 'already');
  assert.equal(await ensureSubscriptionAutomaticTax(stripe, 'sub_1', {}, { taxEnabled: false }), 'skipped');
  assert.equal(updates.length, 1);
});

test('a customer without an address never blocks the seat change', async () => {
  const stripe = {
    subscriptions: {
      update: async () => {
        throw new Error('customer_tax_location_invalid');
      },
    },
  };
  assert.equal(await ensureSubscriptionAutomaticTax(stripe, 'sub_1', null, { taxEnabled: true }), 'failed');
});

/* ---------------------------------------------------------- Chest Mount */

test('the Chest Mount is the $99.99 price; the $49.99 one is legacy', () => {
  assert.equal(CHEST_MOUNT_PRICE_CENTS, 9_999);
  assert.equal(LIVE_CHEST_MOUNT_PRICE_ID, 'price_1UIvqJ1b5twUY3LyoDRKBus2');
  assert.notEqual(LIVE_CHEST_MOUNT_PRICE_ID, LEGACY_CHEST_MOUNT_PRICE_ID);
});

test('Chest Mount price: env wins; live id only with a live key; never on a test key', () => {
  assert.equal(chestMountPriceId({ envPriceId: 'price_testMount', secretKey: 'sk_test_x', enabled: true }), 'price_testMount');
  assert.equal(chestMountPriceId({ envPriceId: '', secretKey: 'sk_live_x', enabled: true }), LIVE_CHEST_MOUNT_PRICE_ID);
  assert.equal(chestMountPriceId({ envPriceId: '', secretKey: 'rk_live_x', enabled: true }), LIVE_CHEST_MOUNT_PRICE_ID);
  assert.equal(chestMountPriceId({ envPriceId: '', secretKey: 'sk_test_x', enabled: true }), null);
  assert.equal(chestMountPriceId({ envPriceId: '', secretKey: '', enabled: true }), null);
  assert.equal(chestMountPriceId({ envPriceId: 'price_testMount', secretKey: 'sk_live_x', enabled: false }), null);
});

test('N extra Field Capture seats → N Chest Mounts', () => {
  assert.deepEqual(chestMountLineItems(3, 'price_mount'), [{ price: 'price_mount', quantity: 3 }]);
  assert.deepEqual(chestMountLineItems(0, 'price_mount'), []);
  assert.deepEqual(chestMountLineItems(2, null), []);
});

test('plan Checkout with no extras: zero mounts, no shipping step', () => {
  const session = withChestMounts([{ price: 'price_plan', quantity: 1 }], 0, 'price_mount');
  assert.deepEqual(session.line_items, [{ price: 'price_plan', quantity: 1 }]);
  assert.equal('shipping_address_collection' in session, false);
});

test('plan + 2 extra seats Checkout: 2 mounts (included seats get none) and shipping', () => {
  const session = withChestMounts(
    [
      { price: 'price_plan', quantity: 1 },
      { price: 'price_seat', quantity: 2 },
    ],
    2,
    'price_mount',
  );
  assert.deepEqual(session.line_items, [
    { price: 'price_plan', quantity: 1 },
    { price: 'price_seat', quantity: 2 },
    { price: 'price_mount', quantity: 2 },
  ]);
  assert.ok(session.shipping_address_collection);
});

test('no mount price configured (staging without one): no mount line, no shipping step', () => {
  const session = withChestMounts([{ price: 'price_plan', quantity: 1 }], 3, null);
  assert.deepEqual(session.line_items, [{ price: 'price_plan', quantity: 1 }]);
  assert.equal('shipping_address_collection' in session, false);
});

test('extra seats on a live subscription: quantity plus N mounts on the next invoice', () => {
  assert.deepEqual(
    extraSeatSubscriptionUpdate({ existingItemId: 'si_seat', priceId: 'price_seat', targetExtra: 4, added: 2, chestMountPrice: 'price_mount' }),
    {
      items: [{ id: 'si_seat', quantity: 4 }],
      proration_behavior: 'create_prorations',
      add_invoice_items: [{ price: 'price_mount', quantity: 2 }],
    },
  );
  assert.deepEqual(
    extraSeatSubscriptionUpdate({ existingItemId: null, priceId: 'price_seat', targetExtra: 1, added: 1, chestMountPrice: null }),
    { items: [{ price: 'price_seat', quantity: 1 }], proration_behavior: 'create_prorations' },
  );
});

function seatBillingClient(row: Record<string, unknown>) {
  return {
    from() {
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: [{ org_id: 'org-1' }], error: null }).then(resolve),
      };
      return chain;
    },
  };
}

test('addExtraFieldCaptureSeats on a live subscription: tax on, one update with the mounts', async () => {
  const before = config.stripe.chestMountPriceId;
  config.stripe.chestMountPriceId = 'price_testMount';
  try {
    const updates: Array<[string, Record<string, unknown>]> = [];
    const stripe: ExtraSeatStripe = {
      subscriptions: {
        retrieve: async () => ({
          items: { data: [{ id: 'si_plan', price: { id: 'price_plan', recurring: { interval: 'month' } } }] },
          automatic_tax: { enabled: false },
          metadata: {},
        }),
        update: async (id, params) => void updates.push([id, params]),
      },
    };
    const supabase = seatBillingClient({ extra_fc_seats: 1, status: 'active' });
    const out = await addExtraFieldCaptureSeats(supabase as never, 'org-1', 2, {
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      stripe,
      persistWith: supabase as never,
    });
    assert.equal(out.updated, true);
    assert.equal(out.extraSeats, 3);
    assert.deepEqual(updates[0], ['sub_1', { automatic_tax: { enabled: true } }]);
    assert.equal(updates.length, 2);
    const [, seatUpdate] = updates[1];
    assert.deepEqual(seatUpdate.add_invoice_items, [{ price: 'price_testMount', quantity: 2 }]);
    assert.equal((seatUpdate.items as Array<{ quantity: number }>)[0].quantity, 3);
  } finally {
    config.stripe.chestMountPriceId = before;
  }
});

test('Platform seat on a live subscription: tax on, and never a Chest Mount', async () => {
  const before = config.stripe.chestMountPriceId;
  config.stripe.chestMountPriceId = 'price_testMount';
  try {
    const created: Record<string, unknown>[] = [];
    const taxed: string[] = [];
    const stripe: PlatformSeatStripe = {
      subscriptions: { retrieve: async () => ({ items: { data: [{ id: 'si_plan', price: { id: 'price_plan' } }] } }) },
      subscriptionItems: {
        update: async () => undefined,
        create: async (params) => void created.push(params),
      },
      checkout: { sessions: { create: async () => ({ url: 'https://checkout.example.com/s' }) } },
    };
    const deps: PlatformSeatInviteDeps = {
      persist: async () => undefined,
      stripe: () => stripe,
      isLiveSubscriptionId: (id) => (id?.startsWith('sub_') ? id : null),
      intervalOf: () => 'month',
      isPlatformSeatItem: () => false,
      idempotencyKey: (...p) => p.join(':'),
      createCheckout: async () => 'https://checkout.example.com/s',
      ensureAutomaticTax: async (id) => void taxed.push(id),
    };
    await addPlatformSeatForInvite(
      {
        orgId: 'org-1',
        usage: summarizePlatformSeats({ purchased: 0, used: 0, status: 'active', billingExempt: false, priceConfigured: true }),
        billing: { purchased: 0, status: 'active', subscriptionId: 'sub_live', customerId: 'cus_1', planCode: 'work_verification' },
        billingExempt: false,
        priceId: 'price_platform',
      },
      deps,
    );
    assert.deepEqual(taxed, ['sub_live']);
    assert.equal(created.length, 1);
    assert.equal(created[0].price, 'price_platform');
    assert.equal(JSON.stringify(created).includes('price_testMount'), false);
    assert.equal('add_invoice_items' in created[0], false);
  } finally {
    config.stripe.chestMountPriceId = before;
  }
});
