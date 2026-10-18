import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyComplimentaryPlanChange,
  assertNotComplimentaryPurchase,
  COMPLIMENTARY_BILLING_CODE,
  loadOrgBillingExempt,
} from '../src/lib/complimentaryBilling.js';
import { HttpError } from '../src/lib/errors.js';

function fakeClient(billing: Record<string, unknown> | null, opts?: { updateRows?: number }) {
  const updates: Array<{ table: string; row: unknown; eq: unknown[] }> = [];
  return {
    updates,
    from(table: string) {
      const state: { update: unknown; eq: unknown[] } = { update: null, eq: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tiny fake query builder
      const self: Record<string, any> = {};
      self.select = () => {
        if (state.update !== null) {
          updates.push({ table, row: state.update, eq: state.eq });
          const n = opts?.updateRows ?? 1;
          return Promise.resolve({ data: Array.from({ length: n }, () => ({ org_id: 'org-1' })), error: null });
        }
        return self;
      };
      self.update = (row: unknown) => {
        state.update = row;
        return self;
      };
      self.eq = (...args: unknown[]) => {
        state.eq.push(args);
        return self;
      };
      self.maybeSingle = async () => {
        if (table === 'org_billing') return { data: billing, error: null };
        if (table === 'orgs') return { data: { created_by: 'u1' }, error: null };
        if (table === 'profiles') return { data: { email: 'owner@example.com' }, error: null };
        return { data: null, error: null };
      };
      return self;
    },
  };
}

test('comped workspaces are refused before any Stripe purchase', () => {
  for (const kind of ['credits', 'auto_recharge', 'subscription'] as const) {
    assert.throws(
      () => assertNotComplimentaryPurchase(true, kind),
      (err: unknown) =>
        err instanceof HttpError && err.status === 400 && err.code === COMPLIMENTARY_BILLING_CODE &&
        /complimentary/.test(err.message) && !/\$|https?:|checkout/i.test(err.message),
    );
    assert.doesNotThrow(() => assertNotComplimentaryPurchase(false, kind));
  }
});

test('comp_ ids and comped status are exempt; real sub_ ids are not', async () => {
  assert.equal(await loadOrgBillingExempt(fakeClient({ stripe_subscription_id: 'comp_jack_abc', status: 'active' }) as never, 'org-1', 'x@example.com'), true);
  assert.equal(await loadOrgBillingExempt(fakeClient({ stripe_subscription_id: null, status: 'comped' }) as never, 'org-1', 'x@example.com'), true);
  assert.equal(await loadOrgBillingExempt(fakeClient({ stripe_subscription_id: 'sub_1Abc', status: 'active' }) as never, 'org-1', 'x@example.com'), false);
  assert.equal(await loadOrgBillingExempt(fakeClient({ stripe_subscription_id: null, status: 'active' }) as never, 'org-1', 'x@example.com'), false);
});

test('BILLING_EXEMPT_EMAILS creators are exempt', async () => {
  const prev = process.env.BILLING_EXEMPT_EMAILS;
  process.env.BILLING_EXEMPT_EMAILS = 'Owner@Example.com';
  try {
    assert.equal(await loadOrgBillingExempt(fakeClient({ stripe_subscription_id: null, status: 'active' }) as never, 'org-1', 'teammate@example.com'), true);
  } finally {
    if (prev === undefined) delete process.env.BILLING_EXEMPT_EMAILS;
    else process.env.BILLING_EXEMPT_EMAILS = prev;
  }
});

test('a comped plan change writes the plan and seats to org_billing and keeps the comp id', async () => {
  const client = fakeClient({ stripe_subscription_id: 'comp_jack_abc', status: 'active' });
  const plan = await applyComplimentaryPlanChange(client as never, 'org-1', 'scale', { writer: client as never });
  assert.equal(plan.code, 'scale');
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].table, 'org_billing');
  assert.deepEqual(client.updates[0].row, { atmosphere_plan_code: 'scale', included_fc_seats: 10 });
  assert.deepEqual(client.updates[0].eq, [['org_id', 'org-1']]);
  assert.ok(!('stripe_subscription_id' in (client.updates[0].row as object)));
});

test('a comped plan change that updates no row fails loudly', async () => {
  const client = fakeClient({ stripe_subscription_id: 'comp_jack_abc' }, { updateRows: 0 });
  await assert.rejects(() => applyComplimentaryPlanChange(client as never, 'org-1', 'starter', { writer: client as never }), /not updated/);
});

test('purchase routes check for a comp before calling Stripe', () => {
  const allowance = readFileSync(new URL('../src/routes/aiAllowance.ts', import.meta.url), 'utf8');
  const credits = allowance.slice(allowance.indexOf("post('/credits/checkout'"), allowance.indexOf("post('/plan/checkout'"));
  assert.ok(credits.indexOf("'credits'") > 0 && credits.indexOf("'credits'") < credits.indexOf('ensureCustomer('));
  const plan = allowance.slice(allowance.indexOf("post('/plan/checkout'"), allowance.indexOf('function stripeEnabled'));
  const compBranch = plan.indexOf('applyComplimentaryPlanChange(');
  assert.ok(compBranch > 0);
  assert.ok(compBranch < plan.indexOf('stripeClient()'), 'comp branch runs before any Stripe call');
  assert.ok(compBranch < plan.indexOf('ensureCustomer('));
  const recharge = allowance.slice(allowance.indexOf("put('/auto-recharge'"));
  assert.ok(recharge.indexOf("'auto_recharge'") > 0 && recharge.indexOf("'auto_recharge'") < recharge.indexOf('updateAutoRecharge('));

  const billing = readFileSync(new URL('../src/routes/billing.ts', import.meta.url), 'utf8');
  const sub = billing.slice(billing.indexOf("post('/checkout/subscription'"), billing.indexOf("post('/portal'"));
  assert.ok(sub.indexOf("'subscription'") > 0 && sub.indexOf("'subscription'") < sub.indexOf('ensureCustomer('));
});
