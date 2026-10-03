/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for the Supabase client */
/**
 * Settings › Billing usage summary.
 *
 * Production grants EXECUTE on customer_metering_summary to the service role
 * only, so the old user-JWT call failed on every Billing load with
 * "permission denied for function customer_metering_summary" and the summary
 * was null. The backend now reads it with the service role through
 * customer_metering_summary_for_member(p_org, p_user), which re-checks that the
 * caller is a member of the org.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerMeteringSummary } from '../src/metering/periodAggregation.js';
import { loadWorkspaceBilling } from '../src/lib/workspaceBilling.js';

const ORG = '8b2cc105-1eec-4123-90db-fdcbc5565252';
const USER = '111832c2-d6f9-4412-86ce-1fccc439eb40';
const SUMMARY = {
  periodStart: '2026-10-01',
  periodEnd: '2026-11-01',
  planName: 'Work Verification',
  processedJobs: 0,
  includedJobs: 50,
  excessJobs: 0,
  videoVerificationHours: 0,
  computeOverage: null,
  basePlatformChargeCents: 59900,
  jobOverageChargeCents: 0,
  videoProcessingChargeCents: 0,
  estimatedUpcomingBillCents: 59900,
};

function serviceClient(result: { data?: unknown; error?: unknown } = { data: SUMMARY, error: null }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return { data: result.data ?? null, error: result.error ?? null };
      },
    } as any,
  };
}

/** A user-JWT client: every table read is empty; the summary RPC is refused like production. */
function userClient() {
  const rpcs: string[] = [];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: null, error: null, count: 0 });
        }
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
        return () => chain;
      },
    },
  );
  return {
    rpcs,
    client: {
      from: () => chain,
      rpc: async (fn: string) => {
        rpcs.push(fn);
        if (fn === 'customer_metering_summary') {
          return { data: null, error: { code: '42501', message: 'permission denied for function customer_metering_summary' } };
        }
        return { data: null, error: null };
      },
    } as any,
  };
}

test('summary is read with the service role, scoped to the caller org and user', async () => {
  const svc = serviceClient();
  const summary = await getCustomerMeteringSummary(svc.client, ORG, USER);
  assert.deepEqual(summary, SUMMARY);
  assert.deepEqual(svc.calls, [{ fn: 'customer_metering_summary_for_member', args: { p_org: ORG, p_user: USER } }]);
});

test('a database refusal (caller not a member of the org) is not swallowed', async () => {
  const svc = serviceClient({ error: { code: '42501', message: 'forbidden' } });
  await assert.rejects(getCustomerMeteringSummary(svc.client, 'ffffffff-0000-0000-0000-000000000000', USER), {
    code: '42501',
  });
});

test('no service role or no user: refuse without calling the database', async () => {
  await assert.rejects(getCustomerMeteringSummary(null, ORG, USER), { code: 'service_role_unavailable' });
  const svc = serviceClient();
  await assert.rejects(getCustomerMeteringSummary(svc.client, ORG, ''), { code: '42501' });
  await assert.rejects(getCustomerMeteringSummary(svc.client, '', USER), { code: '42501' });
  assert.equal(svc.calls.length, 0);
});

test('Settings › Billing workspace fills the usage summary instead of logging permission denied', async () => {
  const user = userClient();
  const svc = serviceClient();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const workspace = await loadWorkspaceBilling(user.client, ORG, USER, 'owner@example.com', {
      serviceClient: svc.client,
    });
    assert.deepEqual(workspace.usage, SUMMARY);
  } finally {
    console.warn = warn;
  }
  assert.ok(!user.rpcs.includes('customer_metering_summary'), 'the user JWT never calls the service-role-only RPC');
  assert.deepEqual(svc.calls, [{ fn: 'customer_metering_summary_for_member', args: { p_org: ORG, p_user: USER } }]);
  assert.ok(!warnings.some((w) => w.includes('metering summary unavailable')), warnings.join('\n'));
});
