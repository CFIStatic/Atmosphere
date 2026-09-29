import test from 'node:test';
import assert from 'node:assert/strict';
import { officeSignupReturnBase } from './signupReturnBase.js';
import { signupCheckoutReturnUrl } from './signupOnboarding.js';

const FIELD = 'https://app.atmosphereteam.com';
const PLATFORM = 'https://platform.atmosphereteam.com';

test('signup checkout cancel and success stay on the platform host and keep next', () => {
  const base = officeSignupReturnBase([FIELD, PLATFORM], `${FIELD}/signup`);
  assert.equal(base, `${PLATFORM}/signup`);
  for (const kind of ['cancelled', 'success'] as const) {
    const url = new URL(
      signupCheckoutReturnUrl({
        base,
        kind,
        returnPath: '/job-progress?job=job-1',
        billingInterval: 'month',
      }),
    );
    assert.equal(url.origin, PLATFORM);
    assert.equal(url.pathname, '/signup');
    assert.equal(url.searchParams.get('step'), '2');
    assert.equal(url.searchParams.get('checkout'), kind);
    assert.equal(url.searchParams.get('next'), '/job-progress?job=job-1');
  }
});

test('a field-capture-only origin list still returns to the platform signup', () => {
  assert.equal(officeSignupReturnBase([FIELD]), `${PLATFORM}/signup`);
  assert.equal(
    officeSignupReturnBase(['https://field-capture-production.up.railway.app']),
    `${PLATFORM}/signup`,
  );
});

test('local office signup stays on the local host', () => {
  assert.equal(
    officeSignupReturnBase(['http://localhost:5174']),
    'http://localhost:5174/signup',
  );
});

test('an explicit platform return base is kept', () => {
  assert.equal(
    officeSignupReturnBase([FIELD], `${PLATFORM}/signup`),
    `${PLATFORM}/signup`,
  );
});
