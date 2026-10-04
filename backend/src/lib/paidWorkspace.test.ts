import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';
import {
  PRODUCT_ACTION_LOCKED_CODE,
  PRODUCT_ACTION_LOCKED_MESSAGE,
  assertOrgProductActionsAllowed,
  productActionsLocked,
} from './paidWorkspace.js';

const here = dirname(fileURLToPath(import.meta.url));

function billingClient(row: { stripe_subscription_id?: string | null; status?: string | null } | null) {
  return {
    from(table: string) {
      const data =
        table === 'org_billing'
          ? row
          : table === 'orgs'
            ? { created_by: 'user-1' }
            : table === 'profiles'
              ? { email: 'owner@example.com' }
              : null;
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

test('unpaid stripe workspaces lock upload, record, share, and invite', () => {
  assert.equal(
    productActionsLocked({
      paymentProvider: 'stripe',
      subscriptionId: null,
      subscriptionStatus: null,
    }),
    true,
  );
  assert.equal(
    productActionsLocked({
      paymentProvider: 'stripe',
      subscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    }),
    false,
  );
  assert.equal(
    productActionsLocked({
      paymentProvider: 'dev',
      subscriptionId: null,
      subscriptionStatus: null,
    }),
    false,
  );
});

test('assertOrgProductActionsAllowed refuses an unpaid stripe org with 402', async () => {
  await assert.rejects(
    () => assertOrgProductActionsAllowed(billingClient(null), 'org-1', 'stripe'),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 402);
      assert.equal(err.code, PRODUCT_ACTION_LOCKED_CODE);
      assert.equal(err.message, PRODUCT_ACTION_LOCKED_MESSAGE);
      return true;
    },
  );
});

test('a paid stripe org and non-stripe billing are allowed', async () => {
  await assert.doesNotReject(
    () =>
      assertOrgProductActionsAllowed(
        billingClient({ stripe_subscription_id: 'sub_123', status: 'active' }),
        'org-1',
        'stripe',
      ),
  );
  await assert.doesNotReject(
    () => assertOrgProductActionsAllowed(billingClient(null), 'org-1', 'dev'),
  );
});

test('write paths call the server lock', () => {
  const files = [
    'routes/proofOfWork.ts',
    'routes/fieldApp.ts',
    'routes/sharedJobs.ts',
    'routes/evidencePortal.ts',
    'routes/org.ts',
    'routes/jobIntake.ts',
    'routes/mediaCatalog.ts',
  ];
  for (const file of files) {
    const src = readFileSync(resolve(here, '..', file), 'utf8');
    assert.match(src, /assertOrgProductActionsAllowed/);
  }
});
