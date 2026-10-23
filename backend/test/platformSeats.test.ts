/**
 * Platform-only seats ($75/mo): Global Admin access on the Platform, refused by
 * Field Capture, never a Field Capture seat, added free on comped workspaces
 * with no Stripe call, and capped by the seats the workspace has.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  rejectPlatformSeatInFieldCapture,
  setPlatformSeatLookupForTests,
} from '../src/middleware/rejectPlatformSeat.js';
import {
  PLATFORM_SEAT_NO_FIELD_CAPTURE_MESSAGE,
  PLATFORM_SEAT_UNAVAILABLE_MESSAGE,
  addPlatformSeatForInvite,
  decidePlatformSeatAction,
  parseSeatType,
  summarizePlatformSeats,
  type PlatformSeatInviteDeps,
  type PlatformSeatInviteInput,
  type PlatformSeatStripe,
} from '../src/lib/platformSeats.js';
import { isFieldCaptureSeat } from '../src/lib/fieldCaptureSeats.js';
import { planItemUpdateParams } from '../src/lib/planChange.js';
import { isSeatAddOnLineItem, platformSeatQuantityFromSubscription } from '../src/lib/stripe.js';

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

/* ------------------------------------------------- Field Capture is blocked */

test('Field Capture refuses a Platform seat with platform_seat_no_field_capture', async () => {
  const PLATFORM = 'user-platform';
  setPlatformSeatLookupForTests(async (req) => (req as unknown as { user: { id: string } }).user.id === PLATFORM);
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: { id: string } }).user = { id: req.get('x-test-user')! };
    next();
  });
  app.use(rejectPlatformSeatInFieldCapture);
  app.get('/api/field-app/me', (_q, s) => s.json({ ok: true }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const blocked = await fetch(`${base}/api/field-app/me`, { headers: { 'x-test-user': PLATFORM } });
    assert.equal(blocked.status, 403);
    const body = (await blocked.json()) as { code?: string; error?: string };
    assert.equal(body.code, 'platform_seat_no_field_capture');
    assert.equal(body.error, PLATFORM_SEAT_NO_FIELD_CAPTURE_MESSAGE);
    const crew = await fetch(`${base}/api/field-app/me`, { headers: { 'x-test-user': 'user-crew' } });
    assert.equal(crew.status, 200, 'Field Capture seats and free Global Admins still get in');
  } finally {
    setPlatformSeatLookupForTests(null);
    server.close();
  }
});

test('every Field Capture API route sits behind the Platform seat block', () => {
  const s = src('routes/fieldApp.ts');
  const auth = s.indexOf('fieldAppRouter.use(requireAuth);');
  const block = s.indexOf('fieldAppRouter.use(rejectPlatformSeatInFieldCapture);');
  assert.ok(auth > 0 && block > auth, 'after sign-in');
  for (const route of ["fieldAppRouter.get('/me'", "fieldAppRouter.get('/today'", "fieldAppRouter.post('/jobs'", "'/jobs/:jobId/proof'"]) {
    assert.ok(s.indexOf(route) > block, `${route} is behind the block`);
  }
});

test('the Field Capture app shows the message and signs out', () => {
  const app = readFileSync(new URL('../../fieldcapture/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /function isPlatformSeatBlocked\(err\)/);
  assert.match(app, /platform_seat_no_field_capture/);
  const fail = app.slice(app.indexOf('function failPlatformSeat('), app.indexOf('function failPlatformSeat(') + 600);
  assert.match(fail, /signOutEverywhere\(\)/);
  assert.match(fail, /showLoginError\(/);
});

/* ----------------------------------------- never a Field Capture seat */

test('a Platform seat is never a Field Capture seat (or a chest mount)', () => {
  assert.equal(isFieldCaptureSeat({ role: 'global_admin', seatType: 'platform', usageIntents: ['field_work'] }), false);
  assert.equal(isFieldCaptureSeat({ role: 'employee', email: 'x@field.atmosphere.app', seatType: 'platform' }), false);
  assert.equal(isFieldCaptureSeat({ role: 'employee', seatType: 'field_capture' }), true);
  assert.equal(isFieldCaptureSeat({ role: 'global_admin' }), false, 'free Global Admins unchanged');
  assert.equal(parseSeatType('platform'), 'platform');
  assert.equal(parseSeatType(undefined), 'field_capture');
  assert.equal(parseSeatType('anything'), 'field_capture');
});

/* ----------------------------------------------------------- seat limit */

test('seat limit: a seat is free to use only while one is left; lapsed workspaces have none', () => {
  const live = summarizePlatformSeats({ purchased: 2, used: 2, status: 'active', billingExempt: false, priceConfigured: true });
  assert.deepEqual([live.allowed, live.used, live.remaining, live.priceCents], [2, 2, 0, 7500]);
  const lapsed = summarizePlatformSeats({ purchased: 5, used: 1, status: 'canceled', billingExempt: false, priceConfigured: true });
  assert.equal(lapsed.allowed, 0);
  assert.equal(lapsed.remaining, 0);
  assert.deepEqual(decidePlatformSeatAction({ remaining: 1, billingExempt: false, liveSubscriptionId: null, priceId: null }), { action: 'allow' });
  assert.deepEqual(decidePlatformSeatAction({ remaining: 0, billingExempt: true, liveSubscriptionId: 'sub_1', priceId: 'price_1' }), { action: 'grant_comped' });
  assert.deepEqual(decidePlatformSeatAction({ remaining: 0, billingExempt: false, liveSubscriptionId: 'sub_1', priceId: null }), { action: 'unavailable' });
  assert.deepEqual(decidePlatformSeatAction({ remaining: 0, billingExempt: false, liveSubscriptionId: 'sub_1', priceId: 'price_1' }), { action: 'charge_stripe', subscriptionId: 'sub_1' });
  assert.deepEqual(decidePlatformSeatAction({ remaining: 0, billingExempt: false, liveSubscriptionId: null, priceId: 'price_1' }), { action: 'checkout' });
});

/* ------------------------------------------------------ invite seat path */

function harness(overrides: Partial<PlatformSeatInviteInput> = {}, sub?: Awaited<ReturnType<PlatformSeatStripe['subscriptions']['retrieve']>>) {
  const calls = { persist: [] as number[], stripe: 0, created: [] as Record<string, unknown>[], updated: [] as Array<[string, Record<string, unknown>]>, checkout: 0 };
  const stripe: PlatformSeatStripe = {
    subscriptions: { retrieve: async () => sub ?? { items: { data: [{ id: 'si_plan', price: { id: 'price_plan' } }] } } },
    subscriptionItems: {
      update: async (id, params) => void calls.updated.push([id, params]),
      create: async (params) => void calls.created.push(params),
    },
    checkout: { sessions: { create: async () => ({ url: 'https://checkout.example.com/s' }) } },
  };
  const deps: PlatformSeatInviteDeps = {
    persist: async (_org, n) => void calls.persist.push(n),
    stripe: () => {
      calls.stripe += 1;
      return stripe;
    },
    isLiveSubscriptionId: (id) => (id?.startsWith('sub_') ? id : null),
    intervalOf: () => 'month',
    isPlatformSeatItem: (item) => (item.price as { id?: string } | undefined)?.id === 'price_platform',
    idempotencyKey: (...p) => p.join(':'),
    createCheckout: async () => {
      calls.checkout += 1;
      return 'https://checkout.example.com/s';
    },
  };
  const input: PlatformSeatInviteInput = {
    orgId: 'org-1',
    usage: summarizePlatformSeats({ purchased: 0, used: 0, status: 'active', billingExempt: false, priceConfigured: true }),
    billing: { purchased: 0, status: 'active', subscriptionId: 'comp_jack_org1', customerId: null, planCode: 'work_verification' },
    billingExempt: true,
    priceId: null,
    ...overrides,
  };
  return { calls, deps, input };
}

test('comped workspace: a Platform seat is added free', async () => {
  const { calls, deps, input } = harness();
  const out = await addPlatformSeatForInvite(input, deps);
  assert.equal(out.action, 'grant_comped');
  assert.deepEqual(calls.persist, [1]);
});

test('comped workspace: no Stripe call at all, even with a price and a customer configured', async () => {
  const { calls, deps, input } = harness({
    priceId: 'price_platform',
    billing: { purchased: 3, status: 'active', subscriptionId: 'comp_x', customerId: 'cus_123', planCode: 'work_verification' },
    usage: summarizePlatformSeats({ purchased: 3, used: 3, status: 'active', billingExempt: true, priceConfigured: true }),
    actorIsOwner: false,
    fromAppShell: true,
  });
  await addPlatformSeatForInvite(input, deps);
  assert.equal(calls.stripe, 0);
  assert.equal(calls.checkout, 0);
  assert.deepEqual(calls.persist, [4]);
});

test('a seat that is still free is used without adding anything', async () => {
  const { calls, deps, input } = harness({
    billingExempt: false,
    usage: summarizePlatformSeats({ purchased: 2, used: 1, status: 'active', billingExempt: false, priceConfigured: false }),
  });
  assert.equal((await addPlatformSeatForInvite(input, deps)).action, 'allow');
  assert.equal(calls.stripe + calls.persist.length + calls.checkout, 0);
});

test("paid workspace without a Platform price: fails closed with 'Platform seats aren't available yet'", async () => {
  const { calls, deps, input } = harness({ billingExempt: false, priceId: null, billing: { purchased: 0, status: 'active', subscriptionId: 'sub_live', customerId: 'cus_1', planCode: 'work_verification' } });
  await assert.rejects(addPlatformSeatForInvite(input, deps), (err: HttpError) => {
    assert.equal(err.status, 402);
    assert.equal(err.code, 'platform_seat_unavailable');
    assert.equal(err.message, PLATFORM_SEAT_UNAVAILABLE_MESSAGE);
    return true;
  });
  assert.equal(calls.stripe, 0);
  assert.equal(calls.persist.length, 0);
});

test('live subscription: adds a $75 Platform line, then raises its quantity', async () => {
  const fresh = harness({ billingExempt: false, priceId: 'price_platform', billing: { purchased: 0, status: 'active', subscriptionId: 'sub_live', customerId: 'cus_1', planCode: 'work_verification' } });
  assert.equal((await addPlatformSeatForInvite(fresh.input, fresh.deps)).action, 'charge_stripe');
  assert.equal(fresh.calls.created.length, 1);
  assert.equal(fresh.calls.created[0].price, 'price_platform');
  assert.equal(fresh.calls.created[0].quantity, 1);
  assert.deepEqual(fresh.calls.persist, [1]);

  const more = harness(
    {
      billingExempt: false,
      priceId: 'price_platform',
      billing: { purchased: 2, status: 'active', subscriptionId: 'sub_live', customerId: 'cus_1', planCode: 'work_verification' },
      usage: summarizePlatformSeats({ purchased: 2, used: 2, status: 'active', billingExempt: false, priceConfigured: true }),
    },
    { items: { data: [{ id: 'si_plan', price: { id: 'price_plan' } }, { id: 'si_platform', quantity: 2, price: { id: 'price_platform' } }] } },
  );
  await addPlatformSeatForInvite(more.input, more.deps);
  assert.equal(more.calls.created.length, 0);
  assert.deepEqual(more.calls.updated.map(([id, p]) => [id, p.quantity]), [['si_platform', 3]]);
});

test('no live subscription: opens Checkout instead of inviting', async () => {
  const { calls, deps, input } = harness({ billingExempt: false, priceId: 'price_platform', billing: { purchased: 0, status: 'active', subscriptionId: null, customerId: 'cus_1', planCode: 'work_verification' } });
  await assert.rejects(addPlatformSeatForInvite(input, deps), (err: HttpError) => err.status === 402 && err.code === 'platform_seat_checkout');
  assert.equal(calls.checkout, 1);
  assert.equal(calls.persist.length, 0);
});

test('only the owner buys seats, and never from the phone app', async () => {
  const paid = { billingExempt: false, priceId: 'price_platform', billing: { purchased: 0, status: 'active', subscriptionId: 'sub_live', customerId: 'cus_1', planCode: 'work_verification' } };
  const admin = harness({ ...paid, actorIsOwner: false });
  await assert.rejects(addPlatformSeatForInvite(admin.input, admin.deps), (err: HttpError) => err.status === 403 && err.code === 'platform_seat_owner_only');
  const app = harness({ ...paid, fromAppShell: true });
  await assert.rejects(addPlatformSeatForInvite(app.input, app.deps), (err: HttpError) => err.status === 402 && err.code === 'platform_seat_limit_app');
  assert.equal(admin.calls.stripe + app.calls.stripe, 0);
});

/* --------------------------------------------- Stripe subscription lines */

test('a Platform line is never mistaken for the plan item, and its quantity syncs', () => {
  const items = [
    { id: 'si_platform', quantity: 4, price: { id: 'price_x', metadata: { atmosphere_plan_code: 'platform_seat' } } },
    { id: 'si_plan', price: { id: 'price_plan' } },
  ];
  assert.equal(isSeatAddOnLineItem(items[0]), true);
  assert.deepEqual(planItemUpdateParams(items as never, 'price_new').items, [{ id: 'si_plan', price: 'price_new' }]);
  assert.equal(platformSeatQuantityFromSubscription({ items: { data: items } }), 4);
});

test('every team invite is Field Capture + Platform: no Platform-only path in the invite route', () => {
  const s = src('routes/org.ts');
  const route = s.slice(s.indexOf("orgRouter.post('/invites'"), s.indexOf("orgRouter.post('/invites/:id/revoke'"));
  assert.doesNotMatch(route, /ensurePlatformSeatForInvite/);
  assert.doesNotMatch(route, /seat_type:/);
  assert.match(route, /ensureFieldCaptureSeatForInvite\(supabase, orgId/);
  assert.ok(route.indexOf('ensureFieldCaptureSeatForInvite') < route.indexOf(".from('org_invites')"), 'seat before the invite row');
});

test('one Global Admin per workspace: the invite route refuses admin invites (Platform seats still allowed)', () => {
  const s = src('routes/org.ts');
  const route = s.slice(s.indexOf("orgRouter.post('/invites'"), s.indexOf("orgRouter.post('/invites/:id/revoke'"));
  assert.match(route, /if \(isGlobalAdmin\(seat\)\)/);
  assert.match(route, /'global_admin_owner_only'/);
  assert.ok(route.indexOf("'global_admin_owner_only'") < route.indexOf(".from('org_invites')"), 'refused before any row is written');
});

test('one Global Admin per workspace: nobody promotes themselves through PATCH /api/org/me', () => {
  const s = src('routes/org.ts');
  const route = s.slice(s.indexOf("orgRouter.patch('/me'"), s.indexOf("orgRouter.patch('/',"));
  assert.match(route, /isGlobalAdmin\(role\) && !isGlobalAdmin\(currentRole\)/);
  assert.match(route, /'global_admin_owner_only'/);
});

test('one Global Admin per workspace: the database refuses admin invites too', () => {
  const read = (dir: string) =>
    readFileSync(new URL(`../../${dir}/20261018210000_global_admin_owner_only.sql`, import.meta.url), 'utf8');
  const sql = read('supabase/migrations');
  assert.equal(read('backend/supabase/migrations'), sql, 'mirrored');
  assert.match(sql, /raise exception 'global_admin_owner_only'/);
  assert.match(sql, /<> 'platform'/);
  assert.match(sql, /create trigger org_invites_admin_owner_only/);
});
