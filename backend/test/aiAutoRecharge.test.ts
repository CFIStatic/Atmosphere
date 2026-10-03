/**
 * AI credit auto-recharge, with an in-memory store that follows the same rules
 * as claim_ai_auto_recharge / finish_ai_auto_recharge (those are exercised
 * against real Postgres by supabase/tests/05_ai_credit_auto_recharge.sh) and a
 * fake Stripe. No real card is charged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyAutoRechargeIntentFailed,
  applyAutoRechargeIntentSucceeded,
  autoRechargeLimits,
  readAutoRecharge,
  runAutoRecharge,
  updateAutoRecharge,
  type AutoRechargeAttempt,
  type AutoRechargeClaim,
  type AutoRechargeLimits,
  type AutoRechargeSettings,
  type AutoRechargeStore,
  type AutoRechargeStripe,
  type FinishInput,
  type OffSessionPaymentInput,
  type PaymentRecordInput,
} from '../src/metering/autoRecharge.js';
import { assertAiFeatureAllowed, isAiPaused } from '../src/metering/aiBudgetService.js';

const ORG = 'org-test-1';
const ENV = {
  STRIPE_AI_CREDIT_10_PRICE_ID: 'price_test_ai10',
  STRIPE_AI_CREDIT_25_PRICE_ID: 'price_test_ai25',
  STRIPE_AI_CREDIT_50_PRICE_ID: 'price_test_ai50',
} as NodeJS.ProcessEnv;
const NANOS_PER_CENT = 10_000_000;
const quietLog = { warn: () => {}, error: () => {} };

interface Attempt extends AutoRechargeAttempt {
  orgId: string;
  idempotencyKey: string;
  paymentIntentId: string | null;
  createdAtMs: number;
}

class MemoryStore implements AutoRechargeStore {
  settings = new Map<string, AutoRechargeSettings & { lastAttemptAtMs: number | null }>();
  attempts: Attempt[] = [];
  ledger: Array<{ orgId: string; creditNanos: number; paymentIntentId: string }> = [];
  payments = new Map<string, PaymentRecordInput>();
  customers = new Map<string, string>([[ORG, 'cus_test_1']]);
  failGrant = false;
  nowMs = Date.parse('2026-10-03T16:00:00.000Z');
  seq = 0;

  enable(orgId: string, packCode: AutoRechargeSettings['packCode'] = 'ai_25') {
    this.settings.set(orgId, {
      enabled: true,
      packCode,
      consentedAt: new Date(this.nowMs).toISOString(),
      disabledReason: null,
      disabledAt: null,
      lastAttemptAt: null,
      lastAttemptAtMs: null,
    });
  }

  balance(orgId: string) {
    return this.ledger.filter((row) => row.orgId === orgId).reduce((sum, row) => sum + row.creditNanos, 0);
  }

  async getSettings(orgId: string) {
    const s = this.settings.get(orgId);
    if (!s) return null;
    const { lastAttemptAtMs: _ignored, ...rest } = s;
    return rest;
  }

  async saveSettings(orgId: string, input: { enabled: boolean; packCode: AutoRechargeSettings['packCode']; actorId: string | null; consentedAt: string | null }) {
    const prev = this.settings.get(orgId);
    const next = {
      enabled: input.enabled,
      packCode: input.packCode,
      consentedAt: input.consentedAt,
      disabledReason: null,
      disabledAt: null,
      lastAttemptAt: prev?.lastAttemptAt ?? null,
      lastAttemptAtMs: prev?.lastAttemptAtMs ?? null,
    };
    this.settings.set(orgId, next);
    return (await this.getSettings(orgId))!;
  }

  async claim(orgId: string, limits: AutoRechargeLimits, _trigger: string): Promise<AutoRechargeClaim> {
    const no = (reason: string) => ({ claimed: false, reason, rechargeId: null, idempotencyKey: null, packCode: null });
    const s = this.settings.get(orgId);
    if (!s?.enabled) return no('disabled');
    if (this.attempts.some((a) => a.orgId === orgId && a.status === 'pending')) return no('in_flight');
    if (s.lastAttemptAtMs != null && s.lastAttemptAtMs > this.nowMs - limits.cooldownSeconds * 1000) return no('cooldown');
    const recent = this.attempts.filter((a) => a.orgId === orgId && a.createdAtMs > this.nowMs - 86_400_000).length;
    if (recent >= limits.maxPerDay) return no('daily_cap');
    const id = `rch_${++this.seq}`;
    const key = `ai-auto-recharge:${orgId}:${id}`;
    this.attempts.push({
      id,
      orgId,
      at: new Date(this.nowMs).toISOString(),
      status: 'pending',
      packCode: s.packCode,
      amountCents: null,
      failureMessage: null,
      idempotencyKey: key,
      paymentIntentId: null,
      createdAtMs: this.nowMs,
    });
    s.lastAttemptAtMs = this.nowMs;
    s.lastAttemptAt = new Date(this.nowMs).toISOString();
    return { claimed: true, reason: 'claimed', rechargeId: id, idempotencyKey: key, packCode: s.packCode };
  }

  async finish(rechargeId: string, input: FinishInput) {
    const a = this.attempts.find((row) => row.id === rechargeId);
    if (!a) throw new Error('unknown_recharge');
    if (a.status === 'succeeded') return;
    a.status = input.status;
    a.paymentIntentId = input.paymentIntentId ?? a.paymentIntentId;
    a.amountCents = input.amountCents ?? a.amountCents;
    a.failureMessage = input.status === 'failed' ? (input.failureMessage ?? null) : null;
    if (input.status === 'failed') {
      const s = this.settings.get(a.orgId)!;
      s.enabled = false;
      s.disabledReason = input.failureMessage ?? 'The automatic charge failed.';
      s.disabledAt = new Date(this.nowMs).toISOString();
    }
  }

  async stripeCustomerId(orgId: string) {
    return this.customers.get(orgId) ?? null;
  }

  async grantCredits(orgId: string, input: { creditNanos: number; paymentIntentId: string; note: string }) {
    if (this.failGrant) throw new Error('db down');
    // Unique on stripe_event_id (= PaymentIntent id), like ai_credit_ledger.
    if (this.ledger.some((row) => row.paymentIntentId === input.paymentIntentId)) return { applied: false };
    this.ledger.push({ orgId, creditNanos: input.creditNanos, paymentIntentId: input.paymentIntentId });
    return { applied: true };
  }

  async recordPayment(_orgId: string, input: PaymentRecordInput) {
    this.payments.set(input.paymentIntentId, input); // record_payment upserts on PI id
  }

  async recentAttempts(orgId: string, limit: number) {
    return this.attempts
      .filter((a) => a.orgId === orgId)
      .slice(-limit)
      .reverse()
      .map(({ id, at, status, packCode, amountCents, failureMessage }) => ({ id, at, status, packCode, amountCents, failureMessage }));
  }
}

class FakeStripe implements AutoRechargeStripe {
  prices = new Map<string, { unitAmount: number; currency: string; active: boolean; oneTime: boolean }>([
    ['price_test_ai10', { unitAmount: 1000, currency: 'usd', active: true, oneTime: true }],
    ['price_test_ai25', { unitAmount: 2500, currency: 'usd', active: true, oneTime: true }],
    ['price_test_ai50', { unitAmount: 5000, currency: 'usd', active: true, oneTime: true }],
  ]);
  paymentMethod: string | null = 'pm_test_visa';
  /** Charges actually made, keyed by idempotency key, like Stripe's replay cache. */
  charges = new Map<string, { id: string; input: OffSessionPaymentInput }>();
  calls: Array<{ input: OffSessionPaymentInput; idempotencyKey: string }> = [];
  outcome: 'succeeded' | 'requires_action' | 'processing' | 'decline' = 'succeeded';

  async retrievePrice(priceId: string) {
    const price = this.prices.get(priceId);
    if (!price) throw Object.assign(new Error('No such price'), { code: 'resource_missing' });
    return price;
  }

  async defaultPaymentMethod(_customerId: string) {
    return this.paymentMethod;
  }

  async createOffSessionPayment(input: OffSessionPaymentInput, idempotencyKey: string) {
    this.calls.push({ input, idempotencyKey });
    const replay = this.charges.get(idempotencyKey);
    if (replay) return { id: replay.id, status: 'succeeded', charge: null };
    if (this.outcome === 'decline') {
      throw Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        raw: { payment_intent: { id: `pi_declined_${this.calls.length}` } },
      });
    }
    const id = `pi_test_${this.calls.length}`;
    if (this.outcome === 'succeeded') this.charges.set(idempotencyKey, { id, input });
    return {
      id,
      status: this.outcome,
      charge: { id: `ch_test_${this.calls.length}`, receiptUrl: 'https://example.test/receipt', receiptEmail: 'owner@example.test', cardBrand: 'visa', cardLast4: '4242' },
    };
  }
}

function setup() {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  const deps = { store, stripe, env: ENV, limits: { cooldownSeconds: 600, maxPerDay: 3, staleSeconds: 900 }, log: quietLog };
  return { store, stripe, deps };
}

test('auto-recharge is off by default: nothing is claimed or charged', async () => {
  const { store, stripe, deps } = setup();
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.deepEqual(outcome, { status: 'skipped', reason: 'disabled' });
  assert.equal(store.attempts.length, 0);
  assert.equal(stripe.calls.length, 0);
  const view = await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: true, env: ENV });
  assert.equal(view.enabled, false);
  assert.equal(view.packCode, 'ai_10');
});

test('when on and out of credits, one pack is bought off-session with an idempotency key and recorded', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG, 'ai_25');
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'succeeded');
  assert.equal(stripe.calls.length, 1);
  const call = stripe.calls[0]!;
  assert.equal(call.input.amount, 2500);
  assert.equal(call.input.currency, 'usd');
  assert.equal(call.input.customer, 'cus_test_1');
  assert.equal(call.input.paymentMethod, 'pm_test_visa');
  assert.equal(call.input.metadata.kind, 'ai_credits');
  assert.equal(call.input.metadata.auto_recharge, 'true');
  assert.equal(call.input.metadata.pack_code, 'ai_25');
  assert.equal(call.input.metadata.price_id, 'price_test_ai25');
  assert.equal(call.idempotencyKey, store.attempts[0]!.idempotencyKey);
  assert.match(call.idempotencyKey, /^ai-auto-recharge:org-test-1:rch_1$/);
  assert.equal(store.balance(ORG), 2500 * NANOS_PER_CENT);
  assert.equal(store.attempts[0]!.status, 'succeeded');
  assert.equal(store.attempts[0]!.paymentIntentId, 'pi_test_1');
  const payment = store.payments.get('pi_test_1');
  assert.equal(payment?.amountCents, 2500);
  assert.equal(payment?.cardLast4, '4242');
});

test('the adapter sends off_session + confirm to Stripe with the idempotency key', async () => {
  const { stripeAutoRechargeAdapter } = await import('../src/metering/autoRecharge.js');
  const seen: Array<{ params: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const fakeSdk = {
    paymentIntents: {
      async create(params: Record<string, unknown>, opts: Record<string, unknown>) {
        seen.push({ params, opts });
        return { id: 'pi_sdk_1', status: 'succeeded', latest_charge: null };
      },
    },
  };
  const adapter = stripeAutoRechargeAdapter(fakeSdk as never);
  const result = await adapter.createOffSessionPayment(
    { amount: 1000, currency: 'usd', customer: 'cus_1', paymentMethod: 'pm_1', description: 'x', metadata: { kind: 'ai_credits' } },
    'ai-auto-recharge:org:rch',
  );
  assert.equal(result.id, 'pi_sdk_1');
  assert.equal(seen[0]!.params.off_session, true);
  assert.equal(seen[0]!.params.confirm, true);
  assert.equal(seen[0]!.params.payment_method, 'pm_1');
  assert.deepEqual(seen[0]!.opts, { idempotencyKey: 'ai-auto-recharge:org:rch' });
});

test('two requests that hit zero at once charge once', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  const outcomes = await Promise.all([runAutoRecharge(deps, ORG, 'a'), runAutoRecharge(deps, ORG, 'b')]);
  assert.equal(outcomes.filter((o) => o.status === 'succeeded').length, 1);
  assert.ok(outcomes.some((o) => o.status === 'skipped' && ['in_flight', 'cooldown'].includes(o.reason)));
  assert.equal(stripe.charges.size, 1);
  assert.equal(store.ledger.length, 1);
});

test('the webhook replay of a paid auto-recharge does not add credits twice', async () => {
  const { store, deps } = setup();
  store.enable(ORG, 'ai_10');
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'succeeded');
  const intent = {
    id: 'pi_test_1',
    amount_received: 1000,
    currency: 'usd',
    metadata: { kind: 'ai_credits', auto_recharge: 'true', recharge_id: 'rch_1', pack_code: 'ai_10', credit_nanos: String(1000 * NANOS_PER_CENT) },
  };
  assert.equal(await applyAutoRechargeIntentSucceeded(store, ORG, intent, null, ENV), true);
  assert.equal(await applyAutoRechargeIntentSucceeded(store, ORG, intent, null, ENV), true);
  assert.equal(store.ledger.length, 1);
  assert.equal(store.balance(ORG), 1000 * NANOS_PER_CENT);
  assert.equal(store.payments.size, 1);
});

test('the cooldown stops a loop right after a purchase', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  assert.equal((await runAutoRecharge(deps, ORG, 'test')).status, 'succeeded');
  const again = await runAutoRecharge(deps, ORG, 'test');
  assert.deepEqual(again, { status: 'skipped', reason: 'cooldown' });
  store.nowMs += 11 * 60_000;
  assert.equal((await runAutoRecharge(deps, ORG, 'test')).status, 'succeeded');
  assert.equal(stripe.charges.size, 2);
});

test('the 24-hour cap stops a loop even with no cooldown', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  const noCooldown = { ...deps, limits: { cooldownSeconds: 0, maxPerDay: 3, staleSeconds: 900 } };
  const results = [];
  for (let i = 0; i < 6; i += 1) {
    store.nowMs += 1000;
    results.push(await runAutoRecharge(noCooldown, ORG, 'loop'));
  }
  assert.equal(results.filter((r) => r.status === 'succeeded').length, 3);
  assert.deepEqual(results[3], { status: 'skipped', reason: 'daily_cap' });
  assert.equal(stripe.charges.size, 3);
  store.nowMs += 86_400_000;
  assert.equal((await runAutoRecharge(noCooldown, ORG, 'next-day')).status, 'succeeded');
});

test('a declined card turns auto-recharge off, shows a notice, and grants nothing', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  stripe.outcome = 'decline';
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.equal(outcome.code, 'insufficient_funds');
  assert.equal(store.ledger.length, 0);
  assert.equal(store.attempts[0]!.status, 'failed');
  assert.equal(store.attempts[0]!.paymentIntentId, 'pi_declined_1');
  const settings = await store.getSettings(ORG);
  assert.equal(settings?.enabled, false);
  assert.match(settings?.disabledReason ?? '', /declined, so auto-recharge is off\. Buy credits manually/);
  const view = await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: true, env: ENV });
  assert.equal(view.enabled, false);
  assert.match(view.notice?.message ?? '', /Buy credits manually/);
  // Falls back to manual: the next exhaustion does not try again.
  store.nowMs += 86_400_000;
  stripe.outcome = 'succeeded';
  assert.deepEqual(await runAutoRecharge(deps, ORG, 'test'), { status: 'skipped', reason: 'disabled' });
  assert.equal(stripe.charges.size, 0);
});

test('a charge that needs the cardholder (3DS) turns auto-recharge off', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  stripe.outcome = 'requires_action';
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.equal(outcome.code, 'authentication_required');
  assert.equal((await store.getSettings(ORG))?.enabled, false);
  assert.match((await store.getSettings(ORG))?.disabledReason ?? '', /bank asked to confirm/);
  assert.equal(store.ledger.length, 0);
});

test('no saved card: no charge, auto-recharge off', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG);
  stripe.paymentMethod = null;
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'failed');
  assert.equal(stripe.calls.length, 0);
  assert.equal((await store.getSettings(ORG))?.enabled, false);
});

test('a Stripe price that does not match the pack is never charged', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG, 'ai_25');
  stripe.prices.set('price_test_ai25', { unitAmount: 2600, currency: 'usd', active: true, oneTime: true });
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.equal(outcome.code, 'price_unavailable');
  assert.equal(stripe.calls.length, 0);
});

test('without the pack price env var nothing is claimed or charged', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG, 'ai_50');
  const outcome = await runAutoRecharge({ ...deps, env: { STRIPE_AI_CREDIT_10_PRICE_ID: 'price_test_ai10' } }, ORG, 'test');
  assert.deepEqual(outcome, { status: 'skipped', reason: 'price_not_configured' });
  assert.equal(store.attempts.length, 0);
  assert.equal(stripe.calls.length, 0);
});

test('a charge that succeeded is not marked failed if recording it fails; the webhook finishes it', async () => {
  const { store, stripe, deps } = setup();
  store.enable(ORG, 'ai_10');
  store.failGrant = true;
  const outcome = await runAutoRecharge(deps, ORG, 'test');
  assert.equal(outcome.status, 'pending');
  assert.equal(stripe.charges.size, 1);
  assert.equal(store.attempts[0]!.status, 'pending');
  assert.equal((await store.getSettings(ORG))?.enabled, true);
  store.failGrant = false;
  const charged = [...stripe.charges.values()][0]!;
  await applyAutoRechargeIntentSucceeded(
    store,
    ORG,
    { id: charged.id, amount_received: 1000, currency: 'usd', metadata: charged.input.metadata },
    null,
    ENV,
  );
  assert.equal(store.attempts[0]!.status, 'succeeded');
  assert.equal(store.balance(ORG), 1000 * NANOS_PER_CENT);
});

test('payment_intent.payment_failed for an auto-recharge turns it off; other intents are ignored', async () => {
  const { store } = setup();
  store.enable(ORG);
  await store.claim(ORG, { cooldownSeconds: 0, maxPerDay: 3, staleSeconds: 900 }, 'test');
  assert.equal(
    await applyAutoRechargeIntentFailed(store, { id: 'pi_checkout', metadata: { kind: 'ai_credits' } }),
    false,
  );
  assert.equal((await store.getSettings(ORG))?.enabled, true);
  assert.equal(
    await applyAutoRechargeIntentFailed(store, {
      id: 'pi_x',
      metadata: { kind: 'ai_credits', auto_recharge: 'true', recharge_id: 'rch_1' },
      last_payment_error: { code: 'card_declined' },
    }),
    true,
  );
  assert.equal((await store.getSettings(ORG))?.enabled, false);
});

// --- Owner settings: server-side enforcement -------------------------------

test('only an owner can change auto-recharge', async () => {
  const { store, stripe } = setup();
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { orgId: ORG, actorId: 'u1', canManage: false, stripeEnabled: true, enabled: true, consent: true, env: ENV }),
    (err: { status?: number; code?: string }) => err.status === 403 && err.code === 'billing_forbidden',
  );
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { orgId: ORG, actorId: 'u1', canManage: false, stripeEnabled: true, enabled: false, env: ENV }),
    (err: { status?: number }) => err.status === 403,
  );
  assert.equal(store.settings.size, 0);
});

test('turning it on needs explicit consent to automatic charges', async () => {
  const { store, stripe } = setup();
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { orgId: ORG, actorId: 'u1', canManage: true, stripeEnabled: true, enabled: true, env: ENV }),
    (err: { status?: number; code?: string; message?: string }) =>
      err.status === 400 && err.code === 'consent_required' && /charge your saved card \$10/.test(err.message ?? ''),
  );
  assert.equal(store.settings.size, 0);
});

test('turning it on needs a saved card, a pack price, and Stripe', async () => {
  const { store, stripe } = setup();
  const base = { orgId: ORG, actorId: 'u1', canManage: true, stripeEnabled: true, enabled: true, consent: true, env: ENV };
  stripe.paymentMethod = null;
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, base),
    (err: { status?: number; code?: string }) => err.status === 409 && err.code === 'no_saved_card',
  );
  stripe.paymentMethod = 'pm_test_visa';
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { ...base, packCode: 'ai_50', env: { STRIPE_AI_CREDIT_10_PRICE_ID: 'p' } }),
    (err: { code?: string }) => err.code === 'price_not_configured',
  );
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { ...base, stripeEnabled: false }),
    (err: { code?: string }) => err.code === 'stripe_unconfigured',
  );
  await assert.rejects(
    () => updateAutoRecharge({ store, stripe: () => stripe }, { ...base, packCode: 'ai_999' }),
    (err: { code?: string }) => err.code === 'unknown_pack',
  );
  assert.equal(store.settings.size, 0);
});

test('an owner turns it on with consent, and off at any time; turning on clears an old failure notice', async () => {
  const { store, stripe } = setup();
  const deps = { store, stripe: () => stripe };
  store.enable(ORG);
  await store.finish((await store.claim(ORG, { cooldownSeconds: 0, maxPerDay: 3, staleSeconds: 900 }, 't')).rechargeId!, {
    status: 'failed',
    failureMessage: 'Your card was declined, so auto-recharge is off.',
  });
  assert.ok((await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: true, env: ENV })).notice);

  const on = await updateAutoRecharge(deps, { orgId: ORG, actorId: 'u1', canManage: true, stripeEnabled: true, enabled: true, packCode: 'ai_50', consent: true, env: ENV });
  assert.equal(on.enabled, true);
  assert.equal(on.packCode, 'ai_50');
  assert.equal(on.notice, null);
  assert.ok((await store.getSettings(ORG))?.consentedAt);

  const off = await updateAutoRecharge(deps, { orgId: ORG, actorId: 'u1', canManage: true, stripeEnabled: false, enabled: false, env: ENV });
  assert.equal(off.enabled, false);
  assert.equal(off.packCode, 'ai_50');
});

test('members who are not owners see the setting but not the purchase history', async () => {
  const { store, deps } = setup();
  store.enable(ORG);
  await runAutoRecharge(deps, ORG, 'test');
  const member = await readAutoRecharge(store, ORG, { canManage: false, stripeEnabled: true, env: ENV });
  assert.equal(member.enabled, true);
  assert.deepEqual(member.recent, []);
  const owner = await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: true, env: ENV });
  assert.equal(owner.recent.length, 1);
  assert.equal(owner.recent[0]!.status, 'succeeded');
  assert.equal(owner.recent[0]!.amountCents, 2500);
});

test('the public settings carry pack prices only, never allowance amounts', async () => {
  const { store } = setup();
  const view = await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: true, env: ENV });
  const keys = JSON.stringify(view);
  assert.doesNotMatch(keys, /allowance|usedNanos|Nanos/i);
  assert.deepEqual(view.packs.map((p) => p.cents), [1000, 2500, 5000]);
  assert.equal(view.available, true);
  assert.equal((await readAutoRecharge(store, ORG, { canManage: true, stripeEnabled: false, env: ENV })).available, false);
});

test('limits default to a 10-minute cooldown and 3 per day, and env can only set sane values', () => {
  assert.deepEqual(autoRechargeLimits({}), { cooldownSeconds: 600, maxPerDay: 3, staleSeconds: 900 });
  assert.deepEqual(
    autoRechargeLimits({ AI_AUTO_RECHARGE_COOLDOWN_MINUTES: '30', AI_AUTO_RECHARGE_MAX_PER_DAY: '1' }),
    { cooldownSeconds: 1800, maxPerDay: 1, staleSeconds: 900 },
  );
  assert.equal(autoRechargeLimits({ AI_AUTO_RECHARGE_MAX_PER_DAY: '9999' }).maxPerDay, 10);
  assert.equal(autoRechargeLimits({ AI_AUTO_RECHARGE_MAX_PER_DAY: '-4' }).maxPerDay, 3);
  assert.equal(autoRechargeLimits({ AI_AUTO_RECHARGE_COOLDOWN_MINUTES: 'abc' }).cooldownSeconds, 600);
});

// --- The AI gate --------------------------------------------------------------

const PERIOD_SPEND = 50_000_000_000_000;

function gateClient(state: { credit: number }) {
  return {
    async rpc(name: string) {
      if (name === 'ai_credit_balance') return { data: state.credit, error: null };
      if (name === 'ai_allowance_totals') {
        return {
          data: [{
            period_spend_nanos: PERIOD_SPEND,
            window_event_nanos: PERIOD_SPEND,
            window_allowance_nanos: 0,
            window_allocation_count: 0,
            credit_balance_nanos: state.credit,
            by_feature: { ask: PERIOD_SPEND },
          }],
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      const self: Record<string, unknown> = {};
      const chain = () => self;
      for (const m of ['select', 'eq', 'gte', 'lt', 'order', 'is', 'limit']) self[m] = chain;
      self.maybeSingle = async () =>
        table === 'org_billing'
          ? {
              data: {
                status: 'active',
                period_start: '2026-10-01T00:00:00.000Z',
                period_end: '2026-11-01T00:00:00.000Z',
                atmosphere_plan_code: 'starter',
                extra_fc_seats: 0,
                billing_interval: 'month',
              },
              error: null,
            }
          : { data: null, error: null };
      self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return self;
    },
  };
}

test('the AI gate buys a pack when credits run out and auto-recharge succeeds', async () => {
  const state = { credit: 0 };
  const calls: string[] = [];
  const view = await assertAiFeatureAllowed(gateClient(state) as never, ORG, {
    autoRecharge: async (orgId, trigger) => {
      calls.push(`${orgId}:${trigger}`);
      state.credit = 1000 * NANOS_PER_CENT;
      return true;
    },
  });
  assert.equal(view.paused, false);
  assert.deepEqual(calls, [`${ORG}:ai_gate`]);
});

test('the AI gate still blocks with ai_budget_limited when auto-recharge is off or fails', async () => {
  const state = { credit: 0 };
  let called = 0;
  await assert.rejects(
    () =>
      assertAiFeatureAllowed(gateClient(state) as never, ORG, {
        autoRecharge: async () => {
          called += 1;
          return false;
        },
      }),
    (err: { status?: number; code?: string }) => err.status === 402 && err.code === 'ai_budget_limited',
  );
  assert.equal(called, 1);
  await assert.rejects(
    () => assertAiFeatureAllowed(gateClient(state) as never, ORG, { autoRecharge: async () => { throw new Error('boom'); } }),
    (err: { code?: string }) => err.code === 'ai_budget_limited',
  );
});

test('the AI gate does not call auto-recharge while the org still has credits', async () => {
  const state = { credit: 5_000 * NANOS_PER_CENT };
  let called = 0;
  const view = await assertAiFeatureAllowed(gateClient(state) as never, ORG, {
    autoRecharge: async () => {
      called += 1;
      return true;
    },
  });
  assert.equal(view.paused, false);
  assert.equal(called, 0);
});

test('background work also recharges before it holds for budget', async () => {
  const state = { credit: 0 };
  assert.equal(
    await isAiPaused(gateClient(state) as never, ORG, {
      autoRecharge: async () => {
        state.credit = 1000 * NANOS_PER_CENT;
        return true;
      },
    }),
    false,
  );
  assert.equal(await isAiPaused(gateClient({ credit: 0 }) as never, ORG, { autoRecharge: false }), true);
});

test('the migration defaults auto-recharge off and guards claims in the database', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/20261003160000_ai_credit_auto_recharge.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /enabled\s+boolean not null default false/);
  assert.match(sql, /ai_credit_auto_recharges_pending_uidx[\s\S]*where status = 'pending'/);
  assert.match(sql, /ai_credit_auto_recharges_idem_uidx/);
  assert.match(sql, /revoke execute on function public\.claim_ai_auto_recharge[^;]*from public, anon, authenticated/);
  assert.match(sql, /if p_status = 'failed' then\s+update public\.ai_credit_auto_recharge_settings set\s+enabled = false/);
});
