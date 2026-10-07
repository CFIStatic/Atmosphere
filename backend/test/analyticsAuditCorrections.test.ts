/**
 * Analytics audit corrections (2026-10-07): one test per formula the staff
 * dashboard now relies on. TEST DATA only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  catalogMonthlyCents,
  customerMonthlyCents,
  monthsPerCycle,
  mrrSubscriptionFromStripe,
  subscriptionMonthlyCents,
  type MrrItem,
  type MrrSubscription,
} from '../src/lib/subscriptionMrr.js';
import {
  annotatePayment,
  customerSubscriptionsForMrr,
  invoicePaymentKind,
  invoiceTaxCents,
  isMissingAnalyticsColumn,
  isOldPaymentKindCheck,
  paidInvoiceTaxCents,
  persistSubscriptionAmounts,
} from '../src/lib/stripeAnalyticsFields.js';
import {
  classifyBilling,
  currentUtcMonth,
  paidMonthlyCents,
  periodNote,
  staffBudgetDisplay,
} from '../src/analytics/aiBudgetDisplay.js';
import { analyticsRangeSchema, parseIncludeInternal } from '../src/lib/validation.js';
import { mapSummary } from '../src/lib/analytics.js';
import { mapProductHealth } from '../src/analytics/productHealth.js';
import { loadInternalOrgIds, scopeUnpricedRows } from '../src/metering/periodAggregation.js';
import {
  attachSubscriptions,
  contactFromStripeCustomer,
} from '../src/analytics/contacts/stripeSource.js';

const item = (over: Partial<MrrItem> = {}): MrrItem => ({
  unitAmountCents: 84_900,
  quantity: 1,
  interval: 'month',
  intervalCount: 1,
  usageType: 'licensed',
  taxBehavior: 'exclusive',
  inclusiveTaxPercent: null,
  ...over,
});
const sub = (over: Partial<MrrSubscription> = {}): MrrSubscription => ({
  id: 'sub_test',
  status: 'active',
  livemode: true,
  items: [item()],
  discounts: [],
  ...over,
});

/* ------------------------------------------------------------ MRR model -- */

test('catalog: Starter $399, Work Verification $849, Scale $1,999, +$125 per Field Capture seat', () => {
  assert.equal(catalogMonthlyCents('starter', 'month', 0), 39_900);
  assert.equal(catalogMonthlyCents('work_verification', 'month', 0), 84_900);
  assert.equal(catalogMonthlyCents('scale', 'month', 0), 199_900);
  assert.equal(catalogMonthlyCents('scale', 'month', 3), 199_900 + 3 * 12_500);
  // Unknown plan codes fall back to the default plan, not $0 or a legacy price.
  assert.equal(catalogMonthlyCents('max_20x', 'month', 0), 84_900);
});

test('catalog: annual terms are 10 months prepaid, divided by 12', () => {
  assert.equal(catalogMonthlyCents('work_verification', 'year', 0), Math.round((84_900 * 10) / 12));
  assert.equal(catalogMonthlyCents('starter', 'year', 2), Math.round(((39_900 + 25_000) * 10) / 12));
});

test('monthsPerCycle normalises every Stripe interval to months', () => {
  assert.equal(monthsPerCycle('month'), 1);
  assert.equal(monthsPerCycle('month', 3), 3);
  assert.equal(monthsPerCycle('year'), 12);
  assert.ok(Math.abs(monthsPerCycle('week') - 12 / 52) < 1e-9);
});

test('only active and past_due subscriptions count; trialing and canceled are $0', () => {
  assert.equal(subscriptionMonthlyCents(sub()).mrrCents, 84_900);
  assert.equal(subscriptionMonthlyCents(sub({ status: 'past_due' })).mrrCents, 84_900);
  for (const status of ['trialing', 'canceled', 'incomplete', 'unpaid', 'incomplete_expired']) {
    assert.equal(subscriptionMonthlyCents(sub({ status })).mrrCents, 0, status);
  }
});

test('test-mode subscriptions are $0', () => {
  assert.equal(subscriptionMonthlyCents(sub({ livemode: false })).mrrCents, 0);
});

test('annual price is divided by 12; metered usage is not recurring revenue', () => {
  const annual = sub({ items: [item({ unitAmountCents: 849_000, interval: 'year' })] });
  assert.deepEqual(subscriptionMonthlyCents(annual), { mrrCents: 70_750, interval: 'year' });
  const metered = sub({ items: [item(), item({ usageType: 'metered', unitAmountCents: 50 })] });
  assert.equal(subscriptionMonthlyCents(metered).mrrCents, 84_900);
});

test('extra seats: quantity x unit price', () => {
  const s = sub({ items: [item({ unitAmountCents: 39_900 }), item({ unitAmountCents: 12_500, quantity: 4 })] });
  assert.equal(subscriptionMonthlyCents(s).mrrCents, 39_900 + 50_000);
});

test('discounts: percent then amount off; once-only coupons do not change MRR', () => {
  const pct = sub({ discounts: [{ percentOff: 20, amountOffCents: null, duration: 'forever' }] });
  assert.equal(subscriptionMonthlyCents(pct).mrrCents, Math.round(84_900 * 0.8));
  const both = sub({
    discounts: [
      { percentOff: 10, amountOffCents: null, duration: 'repeating' },
      { percentOff: null, amountOffCents: 5_000, duration: 'forever' },
    ],
  });
  assert.equal(subscriptionMonthlyCents(both).mrrCents, Math.round(84_900 * 0.9 - 5_000));
  const once = sub({ discounts: [{ percentOff: 50, amountOffCents: null, duration: 'once' }] });
  assert.equal(subscriptionMonthlyCents(once).mrrCents, 84_900);
  // Annual amount-off is spread over 12 months.
  const annualOff = sub({
    items: [item({ unitAmountCents: 120_000, interval: 'year' })],
    discounts: [{ percentOff: null, amountOffCents: 12_000, duration: 'forever' }],
  });
  assert.equal(subscriptionMonthlyCents(annualOff).mrrCents, 10_000 - 1_000);
  // Never negative.
  const huge = sub({ discounts: [{ percentOff: null, amountOffCents: 999_999, duration: 'forever' }] });
  assert.equal(subscriptionMonthlyCents(huge).mrrCents, 0);
});

test('tax is excluded: inclusive prices are divided by (1 + rate)', () => {
  const incl = sub({ items: [item({ unitAmountCents: 110_000, taxBehavior: 'inclusive', inclusiveTaxPercent: 10 })] });
  assert.equal(subscriptionMonthlyCents(incl).mrrCents, 100_000);
});

test('customer MRR sums every paying subscription and ignores canceled ones', () => {
  const total = customerMonthlyCents([
    sub(),
    sub({ id: 'sub_seats', items: [item({ unitAmountCents: 12_500, quantity: 2 })] }),
    sub({ id: 'sub_old', status: 'canceled' }),
  ]);
  assert.equal(total.mrrCents, 84_900 + 25_000);
  assert.equal(total.interval, 'month');
  assert.equal(total.livemode, true);
});

test('Stripe adapter: price, interval, quantity, coupons (old and new API) and tax rates', () => {
  const mapped = mrrSubscriptionFromStripe({
    id: 'sub_1',
    status: 'active',
    livemode: true,
    items: {
      data: [
        {
          quantity: 2,
          price: { unit_amount: 12_500, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, tax_behavior: 'inclusive' },
          tax_rates: [{ inclusive: true, percentage: 25 }],
        },
        { price: { unit_amount: 3, recurring: { interval: 'month', usage_type: 'metered' } } },
      ],
    },
    discounts: [{ id: 'di_1', source: { coupon: { percent_off: 50, duration: 'forever' } } }],
    discount: { id: 'di_2', coupon: { amount_off: 1_000, duration: 'once' } },
  });
  assert.equal(mapped.items.length, 2);
  assert.equal(mapped.items[0]!.inclusiveTaxPercent, 25);
  assert.equal(mapped.items[1]!.usageType, 'metered');
  assert.deepEqual(
    mapped.discounts.map((d) => d.duration),
    ['forever', 'once'],
  );
  // 2 x 12,500 = 25,000 incl. 25% tax -> 20,000, then 50% off -> 10,000.
  assert.equal(subscriptionMonthlyCents(mapped).mrrCents, 10_000);
});

/* ---------------------------------------------------- webhook fields -- */

test('usage invoices are recorded as usage, everything else as subscription', () => {
  assert.equal(invoicePaymentKind({ metadata: { kind: 'same_day_usage' } }), 'usage');
  assert.equal(invoicePaymentKind({ metadata: { kind: 'metering_overage' } }), 'usage');
  assert.equal(invoicePaymentKind({ metadata: {} }), 'subscription');
  assert.equal(invoicePaymentKind({}), 'subscription');
});

test('invoice tax across API versions, scaled for partial payment', () => {
  assert.equal(invoiceTaxCents({ total_taxes: [{ amount: 300 }, { amount: 200 }] }), 500);
  assert.equal(invoiceTaxCents({ tax: 700 }), 700);
  assert.equal(invoiceTaxCents({ total_tax_amounts: [{ amount: 90 }] }), 90);
  assert.equal(invoiceTaxCents({}), 0);
  assert.equal(paidInvoiceTaxCents({ total: 11_000, tax: 1_000 }, 11_000), 1_000);
  assert.equal(paidInvoiceTaxCents({ total: 11_000, tax: 1_000 }, 5_500), 500);
});

test('pre-migration database errors are recognised (webhook must not fail)', () => {
  assert.ok(isMissingAnalyticsColumn('column "tax_cents" of relation "payments" does not exist'));
  assert.ok(isMissingAnalyticsColumn("Could not find the 'stripe_mrr_cents' column in the schema cache"));
  assert.ok(!isMissingAnalyticsColumn('duplicate key value violates unique constraint'));
  assert.ok(isOldPaymentKindCheck('new row for relation "payments" violates check constraint "payments_kind_check"'));
});

function recordingAdmin(error: { message: string } | null = null) {
  const calls: Array<{ table: string; patch: Record<string, unknown>; col: string; val: string }> = [];
  return {
    calls,
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (col: string, val: string) => {
          calls.push({ table, patch, col, val });
          return { error };
        },
      }),
    }),
  };
}

test('annotatePayment writes tax and mode; tolerates a missing column; rethrows other errors', async () => {
  const admin = recordingAdmin();
  await annotatePayment(admin, { column: 'stripe_invoice_id', value: 'in_1' }, { taxCents: 120.4, livemode: true });
  assert.deepEqual(admin.calls[0], {
    table: 'payments',
    patch: { tax_cents: 120, livemode: true },
    col: 'stripe_invoice_id',
    val: 'in_1',
  });
  await annotatePayment(admin, { column: 'stripe_invoice_id', value: null }, { taxCents: 1 });
  assert.equal(admin.calls.length, 1);
  await annotatePayment(recordingAdmin({ message: 'column "livemode" does not exist' }), { column: 'stripe_charge_id', value: 'ch_1' }, { livemode: false });
  await assert.rejects(
    annotatePayment(recordingAdmin({ message: 'permission denied' }), { column: 'stripe_charge_id', value: 'ch_1' }, { livemode: false }),
  );
});

test('persistSubscriptionAmounts stores the net monthly amount on org_billing', async () => {
  const admin = recordingAdmin();
  const now = new Date('2026-10-07T12:00:00Z');
  await persistSubscriptionAmounts(admin, 'org-1', { mrrCents: 70_750.4, interval: 'year', livemode: true }, now);
  assert.deepEqual(admin.calls[0]!.patch, {
    stripe_mrr_cents: 70_750,
    stripe_interval: 'year',
    stripe_amount_synced_at: now.toISOString(),
    stripe_livemode: true,
  });
  assert.equal(admin.calls[0]!.table, 'org_billing');
});

test('customer subscriptions: lists status all, prefers the event copy, falls back on error', async () => {
  const active = { id: 'sub_a', status: 'active', livemode: true, items: { data: [{ price: { unit_amount: 39_900, recurring: { interval: 'month' } } }] } };
  const stale = { ...active, status: 'canceled' };
  const seats = { id: 'sub_s', status: 'active', livemode: true, items: { data: [{ quantity: 2, price: { unit_amount: 12_500, recurring: { interval: 'month' } } }] } };
  let listArgs: any = null;
  const stripe = { subscriptions: { list: async (args: any) => ((listArgs = args), { data: [stale, seats] }) } } as any;
  const subs = await customerSubscriptionsForMrr(stripe, 'cus_1', active);
  assert.equal(listArgs.status, 'all');
  assert.equal(listArgs.customer, 'cus_1');
  assert.equal(customerMonthlyCents(subs).mrrCents, 39_900 + 25_000);
  const failing = { subscriptions: { list: async () => { throw new Error('stripe down'); } } } as any;
  const fallback = await customerSubscriptionsForMrr(failing, 'cus_1', active);
  assert.equal(customerMonthlyCents(fallback).mrrCents, 39_900);
});

/* -------------------------------------------------------- AI budgets -- */

const NOW = new Date('2026-10-07T17:00:00Z');

test('budget class: comp, test mode, trialing, canceled, none, paying', () => {
  assert.equal(classifyBilling({ stripe_subscription_id: 'comp_x', status: 'active' }), 'comp');
  assert.equal(classifyBilling({ stripe_subscription_id: 'sub_x', status: 'active', stripe_livemode: false }), 'test_mode');
  assert.equal(classifyBilling({ stripe_subscription_id: 'sub_x', status: 'trialing' }), 'trialing');
  assert.equal(classifyBilling({ stripe_subscription_id: 'sub_x', status: 'canceled' }), 'canceled');
  assert.equal(classifyBilling({ stripe_subscription_id: null, status: 'active' }), 'no_subscription');
  assert.equal(classifyBilling(null), 'no_subscription');
  assert.equal(classifyBilling({ stripe_subscription_id: 'sub_x', status: 'past_due' }), 'past_due');
});

test('what the org pays: stored Stripe amount first, catalog fallback, else $0', () => {
  assert.deepEqual(paidMonthlyCents({ stripe_subscription_id: 'sub_x', status: 'active', stripe_mrr_cents: 33_000 }), { cents: 33_000, source: 'stripe' });
  assert.deepEqual(
    paidMonthlyCents({ stripe_subscription_id: 'sub_x', status: 'active', atmosphere_plan_code: 'scale', extra_fc_seats: 2 }),
    { cents: 199_900 + 25_000, source: 'catalog' },
  );
  assert.deepEqual(
    paidMonthlyCents({ stripe_subscription_id: 'sub_x', status: 'active', atmosphere_plan_code: 'starter', billing_interval: 'annual' }),
    { cents: Math.round((39_900 * 10) / 12), source: 'catalog' },
  );
  assert.deepEqual(paidMonthlyCents({ stripe_subscription_id: 'sub_x', status: 'trialing', stripe_mrr_cents: 84_900 }), { cents: 0, source: null });
});

test('allowance = 10% of what the org pays; comp shows comp; non-paying shows $0', () => {
  const paying = staffBudgetDisplay(
    { stripe_subscription_id: 'sub_x', status: 'active', atmosphere_plan_code: 'work_verification', period_end: '2026-11-01T00:00:00Z' },
    { allowanceFraction: 0.1, aiCostNanos: 4_245 * 10_000_000, now: NOW },
  );
  assert.equal(paying.allowanceMonthlyNanos, 8_490 * 10_000_000);
  assert.equal(paying.allowanceLabel, '$84.90');
  assert.equal(paying.usedOfAllowancePct, 50);
  assert.equal(paying.displayResetAt, '2026-11-01T00:00:00Z');

  const comp = staffBudgetDisplay({ stripe_subscription_id: 'comp_jettx', status: 'active' }, { allowanceFraction: 0.1, aiCostNanos: 1, now: NOW });
  assert.equal(comp.allowanceLabel, 'comp');
  assert.equal(comp.allowanceMonthlyNanos, null);
  assert.equal(comp.usedOfAllowancePct, null);

  const free = staffBudgetDisplay({ stripe_subscription_id: null, status: 'active' }, { allowanceFraction: 0.1, aiCostNanos: 1, now: NOW });
  assert.equal(free.allowanceLabel, '$0');
  assert.equal(free.allowanceMonthlyNanos, 0);
});

test('periods ending in 2126 show no reset; ended periods show awaiting renewal', () => {
  assert.equal(periodNote('2126-10-01T00:00:00Z', NOW), 'no_reset_comp_term');
  assert.equal(periodNote('2026-09-30T00:00:00Z', NOW), 'ended_awaiting_renewal');
  assert.equal(periodNote('2026-10-30T00:00:00Z', NOW), null);
  assert.equal(periodNote(null, NOW), null);
  const far = staffBudgetDisplay({ stripe_subscription_id: 'comp_x', status: 'active', period_end: '2126-10-01T00:00:00Z' }, { allowanceFraction: 0.1, aiCostNanos: 0, now: NOW });
  assert.equal(far.displayResetAt, null);
  assert.equal(far.periodNote, 'no_reset_comp_term');
});

test('AI cost window is the current UTC calendar month', () => {
  const { start, end } = currentUtcMonth(new Date('2026-10-31T23:30:00-05:00'));
  // 23:30 CT on Oct 31 is already November in UTC.
  assert.equal(start.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-12-01T00:00:00.000Z');
});

/* ------------------------------------------------- exclusion toggle -- */

test('Include internal & test accounts is off unless explicitly on', () => {
  assert.equal(parseIncludeInternal(undefined), false);
  assert.equal(parseIncludeInternal(''), false);
  assert.equal(parseIncludeInternal('0'), false);
  assert.equal(parseIncludeInternal('nope'), false);
  assert.equal(parseIncludeInternal('1'), true);
  assert.equal(parseIncludeInternal('true'), true);
  assert.equal(parseIncludeInternal(true), true);
  const parsed = analyticsRangeSchema.parse({ from: '2026-09-01', to: '2026-10-01' });
  assert.equal(parsed.includeInternal, false);
  assert.equal(analyticsRangeSchema.parse({ from: '2026-09-01', to: '2026-10-01', internal: '1' }).includeInternal, true);
});

test('internal orgs are left out of repricing unless the toggle is on', async () => {
  const rows = [{ org_id: 'int' }, { org_id: 'cust' }] as any[];
  assert.deepEqual(scopeUnpricedRows(rows, new Set(['int']), false).map((r) => r.org_id), ['cust']);
  assert.equal(scopeUnpricedRows(rows, new Set(['int']), true).length, 2);
  const ok = { rpc: async () => ({ data: [{ org_id: 'int' }], error: null }) } as any;
  assert.deepEqual([...(await loadInternalOrgIds(ok))], ['int']);
  const preMigration = { rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) } as any;
  assert.equal((await loadInternalOrgIds(preMigration)).size, 0);
});

/* --------------------------------------------------------- payloads -- */

test('summary payload maps the paying delta, churn, refunds, tax and honest AI cost fields', () => {
  const s = mapSummary({
    scope: 'internal',
    include_internal: false,
    range: { from: '2026-09-07', to: '2026-10-07', days: 30 },
    customers: { orgs_total: 9, orgs_paying: 3, orgs_paying_prev: 1, orgs_excluded: 14, paying_growth_mom_pct: 200 },
    users: {},
    seats: { seats_licensed: 18, seats_filled: 2, seat_utilization_pct: 11.1 },
    revenue: { mrr_cents: 254_800, churned_orgs_this_month: 1, usage_revenue_cents: 4_000, refunds_cents: -3_245, tax_excluded_cents: 900 },
    engagement: {},
    unit_economics: { model_cost_cents: 2_193, list_value_cents: 21_930, model_cost_30d_cents: 1_000 },
  });
  assert.equal(s.includeInternal, false);
  assert.equal(s.customers.orgsPayingPrev, 1);
  assert.equal(s.customers.payingGrowthMomPct, 200);
  assert.equal(s.customers.orgsExcluded, 14);
  assert.equal(s.revenue.churnedOrgsThisMonth, 1);
  assert.equal(s.revenue.refundsCents, -3_245);
  assert.equal(s.revenue.usageRevenueCents, 4_000);
  assert.deepEqual(s.unitEconomics, { modelCostCents: 2_193, listValueCents: 21_930, modelCost30dCents: 1_000 });
  assert.ok(!('billedUsageCents' in (s.unitEconomics as object)));
});

test('time to analysis is measured to first analysis and reports unknown first times', () => {
  const h = mapProductHealth({
    include_internal: true,
    analysis: {
      measured_to: 'first_analysis',
      current: { received: 20, analysed: 10, first_time_unknown: 10, median_seconds: 60, p90_seconds: 120 },
      weekly: [{ week_start: '2026-09-21', analysed: 3, first_time_unknown: 6, median_seconds: 15.1 }],
    },
  });
  assert.equal(h.includeInternal, true);
  assert.equal(h.analysis.measuredTo, 'first_analysis');
  assert.equal(h.analysis.current?.firstTimeUnknown, 10);
  assert.equal(h.analysis.current?.medianSeconds, 60);
  assert.equal(h.analysis.weekly[0]!.firstTimeUnknown, 6);
});

/* --------------------------------------------------------- contacts -- */

test('contacts: a canceled-only customer reads canceled, not none', () => {
  const customers = [{ id: 'cus_1', email: 'owner@example.test', subscriptions: { data: [] } }];
  const merged = attachSubscriptions(customers, [{ id: 'sub_old', customer: 'cus_1', status: 'canceled' } as any]);
  const contact = contactFromStripeCustomer(merged[0]!, new Map());
  assert.equal(contact?.status, 'canceled');
  // The active subscription wins over the canceled one; no duplicates.
  const both = attachSubscriptions(
    [{ id: 'cus_2', email: 'b@example.test', subscriptions: { data: [{ id: 'sub_live', status: 'active' } as any] } }],
    [{ id: 'sub_live', customer: 'cus_2', status: 'active' } as any, { id: 'sub_old', customer: { id: 'cus_2' }, status: 'canceled' } as any],
  );
  assert.equal(both[0]!.subscriptions?.data?.length, 2);
  assert.equal(contactFromStripeCustomer(both[0]!, new Map())?.status, 'active');
});

test('contacts: Jettx addresses and flagged orgs are marked internal', () => {
  const staff = contactFromStripeCustomer({ id: 'c', email: 'Someone@Jettx.ai' }, new Map());
  assert.equal(staff?.internal, true);
  const flagged = contactFromStripeCustomer({ id: 'c', email: 'a@example.test', metadata: { org_id: 'org-int' } }, new Map(), new Set(['org-int']));
  assert.equal(flagged?.internal, true);
  const customer = contactFromStripeCustomer({ id: 'c', email: 'a@example.test', metadata: { org_id: 'org-cust' } }, new Map(), new Set(['org-int']));
  assert.equal(customer?.internal, false);
});
