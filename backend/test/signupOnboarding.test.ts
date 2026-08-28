import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNUP_BILLING_STEP,
  billingOnboardingGate,
  signupCheckoutReturnUrl,
} from '../src/lib/signupOnboarding.js';
import {
  WEBSITE_SIGNUP_ONBOARDING,
  createOrgSchema,
  joinOrgSchema,
  onboardingCheckoutSchema,
} from '../src/lib/validation.js';

/**
 * Pins the three-step signup backend: create org, then Stripe, then the app.
 * No invite step is required to finish.
 */

test('Stripe returns to the billing step, not a removed invite step', () => {
  const url = signupCheckoutReturnUrl({
    base: 'https://app.example/signup',
    kind: 'success',
    returnPath: '/jobs',
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('step'), SIGNUP_BILLING_STEP);
  assert.equal(parsed.searchParams.get('step'), '3');
  assert.equal(parsed.searchParams.get('checkout'), 'success');
  assert.equal(parsed.searchParams.get('next'), '/jobs');
  assert.equal(parsed.searchParams.get('invite'), null);
});

test('cancelled checkout also returns to billing', () => {
  const url = signupCheckoutReturnUrl({
    base: 'http://localhost:5174/signup',
    kind: 'cancelled',
  });
  assert.match(url, /[?&]step=3(?:&|$)/);
  assert.match(url, /[?&]checkout=cancelled(?:&|$)/);
});

test('the org creator must pay when Stripe is on, then they are done', () => {
  const unpaid = billingOnboardingGate({
    paymentProvider: 'stripe',
    isCreator: true,
    subscriptionId: null,
    subscriptionStatus: null,
  });
  assert.equal(unpaid.required, true);
  assert.equal(unpaid.complete, false);

  const paid = billingOnboardingGate({
    paymentProvider: 'stripe',
    isCreator: true,
    subscriptionId: 'sub_123',
    subscriptionStatus: 'active',
  });
  assert.equal(paid.required, true);
  assert.equal(paid.complete, true);
  assert.equal(paid.hasSubscription, true);
});

test('a trialing subscription also finishes signup', () => {
  const trial = billingOnboardingGate({
    paymentProvider: 'stripe',
    isCreator: true,
    subscriptionId: 'sub_trial',
    subscriptionStatus: 'trialing',
  });
  assert.equal(trial.complete, true);
});

test('joiners skip billing even when Stripe is configured', () => {
  const joiner = billingOnboardingGate({
    paymentProvider: 'stripe',
    isCreator: false,
    subscriptionId: null,
    subscriptionStatus: null,
  });
  assert.equal(joiner.required, false);
  assert.equal(joiner.complete, true);
});

test('without Stripe, the creator is not blocked on payment', () => {
  const local = billingOnboardingGate({
    paymentProvider: 'dev',
    isCreator: true,
    subscriptionId: null,
    subscriptionStatus: null,
  });
  assert.equal(local.required, false);
  assert.equal(local.complete, true);
});

test('a canceled or past-due subscription does not finish signup', () => {
  for (const subscriptionStatus of ['canceled', 'past_due', 'incomplete']) {
    const gate = billingOnboardingGate({
      paymentProvider: 'stripe',
      isCreator: true,
      subscriptionId: 'sub_stale',
      subscriptionStatus,
    });
    assert.equal(gate.complete, false, subscriptionStatus);
  }
});

test('an active org_billing row without a Stripe subscription is still unpaid', () => {
  const freeDefault = billingOnboardingGate({
    paymentProvider: 'stripe',
    isCreator: true,
    subscriptionId: null,
    subscriptionStatus: 'active',
  });
  assert.equal(freeDefault.required, true);
  assert.equal(freeDefault.complete, false);
  assert.equal(freeDefault.hasSubscription, false);
});

test('checkout returnPath must be a same-origin relative path', () => {
  assert.doesNotThrow(() => onboardingCheckoutSchema.parse({ returnPath: '/jobs' }));
  assert.throws(() => onboardingCheckoutSchema.parse({ returnPath: 'https://evil.example/' }));
  assert.throws(() => onboardingCheckoutSchema.parse({ returnPath: '//evil.example' }));
});

test('the website signup defaults are a valid create-org payload', () => {
  const parsed = createOrgSchema.parse({
    name: 'Meridian Services',
    ...WEBSITE_SIGNUP_ONBOARDING,
    usageIntents: [...WEBSITE_SIGNUP_ONBOARDING.usageIntents],
  });
  assert.equal(parsed.name, 'Meridian Services');
  assert.equal(parsed.role, 'field_technician');
  assert.deepEqual(parsed.usageIntents, ['field_work', 'exploring']);
});

test('create org accepts a company name alone — the wizard no longer asks the questionnaire', () => {
  const parsed = createOrgSchema.parse({ name: 'Meridian Services' });
  assert.equal(parsed.role, WEBSITE_SIGNUP_ONBOARDING.role);
  assert.equal(parsed.workType, WEBSITE_SIGNUP_ONBOARDING.workType);
  assert.equal(parsed.contractorType, WEBSITE_SIGNUP_ONBOARDING.contractorType);
  assert.deepEqual(parsed.usageIntents, [...WEBSITE_SIGNUP_ONBOARDING.usageIntents]);
});

test('join org accepts a join code alone', () => {
  const parsed = joinOrgSchema.parse({ joinCode: '8f3a9c2b' });
  assert.equal(parsed.joinCode, '8F3A9C2B');
  assert.equal(parsed.role, WEBSITE_SIGNUP_ONBOARDING.role);
  assert.deepEqual(parsed.usageIntents, [...WEBSITE_SIGNUP_ONBOARDING.usageIntents]);
});

async function withTestServer(
  run: (base: string) => Promise<void>,
): Promise<void> {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

test('signup, org, and billing routes reject unauthenticated or invalid requests', async () => {
  await withTestServer(async (base) => {
    const signup = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'long-enough' }),
    });
    assert.equal(signup.status, 400);
    const signupBody = (await signup.json()) as { code?: string };
    assert.equal(signupBody.code, 'validation_error');

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'crew@office.example', password: 'short' }),
    });
    assert.equal(login.status, 400);

    for (const [method, path, body] of [
      ['GET', '/api/billing/onboarding', undefined],
      ['GET', '/api/billing/workspace', undefined],
      ['POST', '/api/billing/checkout/onboarding', {}],
      ['POST', '/api/org', { name: 'Meridian Services' }],
      ['POST', '/api/org/join', { joinCode: '8F3A9C2B' }],
    ] as const) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(res.status, 401, `${method} ${path}`);
      const json = (await res.json()) as { code?: string };
      assert.equal(json.code, 'unauthorized', `${method} ${path}`);
    }
  });
});
