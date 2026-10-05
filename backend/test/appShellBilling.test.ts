import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_SHELL_BILLING_MESSAGE,
  APP_SHELL_SEAT_MESSAGE,
  isAppShellRequest,
  rejectPurchasesInAppShell,
} from '../src/lib/appShell.js';
import { HttpError } from '../src/lib/errors.js';

const IPHONE_APP_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AtmosphereFieldCapture/1.0';
const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function req(ua: string | undefined) {
  return { get: (name: string) => (name.toLowerCase() === 'user-agent' ? ua : undefined) } as never;
}

test('only the app user agent counts as the app shell', () => {
  assert.equal(isAppShellRequest(req(IPHONE_APP_UA)), true);
  assert.equal(isAppShellRequest(req(SAFARI_UA)), false);
  assert.equal(isAppShellRequest(req(undefined)), false);
});

test('purchase routes refuse the app with a plain message and no link or price', () => {
  let passed: unknown = 'not called';
  rejectPurchasesInAppShell(req(IPHONE_APP_UA), {} as never, (err?: unknown) => {
    passed = err;
  });
  assert.ok(passed instanceof HttpError);
  assert.equal((passed as HttpError).status, 403);
  assert.equal((passed as HttpError).code, 'not_available_in_app');
  for (const message of [APP_SHELL_BILLING_MESSAGE, APP_SHELL_SEAT_MESSAGE]) {
    assert.doesNotMatch(message, /\$|https?:|stripe|checkout|price/i);
    assert.match(message, /atmosphereteam\.com/);
  }

  let browser: unknown = 'not called';
  rejectPurchasesInAppShell(req(SAFARI_UA), {} as never, (err?: unknown) => {
    browser = err;
  });
  assert.equal(browser, undefined);
});

test('every Checkout, portal, and auto-recharge route is guarded', () => {
  const billing = readFileSync(new URL('../src/routes/billing.ts', import.meta.url), 'utf8');
  for (const route of [
    "post('/checkout/subscription'",
    "post('/portal'",
    "post('/checkout/onboarding'",
    "post('/checkout/extra-seats'",
  ]) {
    assert.ok(billing.includes(`billingRouter.${route}, rejectPurchasesInAppShell,`), route);
  }
  const allowance = readFileSync(new URL('../src/routes/aiAllowance.ts', import.meta.url), 'utf8');
  for (const route of ["post('/credits/checkout'", "post('/plan/checkout'", "put('/auto-recharge'"]) {
    assert.ok(allowance.includes(`aiAllowanceRouter.${route}, rejectPurchasesInAppShell,`), route);
  }
});

test('an invite past the seats from the app never adds a paid seat or opens Checkout', () => {
  const seats = readFileSync(new URL('../src/lib/fieldCaptureInviteSeats.ts', import.meta.url), 'utf8');
  const guard = seats.indexOf('if (opts.fromAppShell)');
  assert.ok(guard > 0);
  assert.ok(guard > seats.indexOf("decision.action === 'grant_comped'"), 'free comped seats still work');
  assert.ok(guard < seats.indexOf('addExtraFieldCaptureSeats(supabase'), 'before any Stripe change');
  assert.ok(guard < seats.indexOf('fcSeatLimitError(seats.allowed'), 'before the priced message');
  const org = readFileSync(new URL('../src/routes/org.ts', import.meta.url), 'utf8');
  assert.match(org, /fromAppShell: isAppShellRequest\(req\)/);
});
