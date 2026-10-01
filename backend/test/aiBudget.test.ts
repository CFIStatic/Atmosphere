import test from 'node:test';
import assert from 'node:assert/strict';
import { NANOS_PER_CENT, NANOS_PER_CREDIT } from '../src/lib/money.js';
import { aiBudgetConfig } from '../src/metering/aiBudgetConfig.js';
import {
  allowanceNanos,
  allocateUsage,
  applyCreditGrant,
  canGrantAiCredits,
  canPurchaseAiCredits,
  creditGrantFromCheckout,
  creditNanosForPaymentCents,
  customerAllowanceMessage,
  documentUploadOutcome,
  evaluateAllowance,
  monthlyAllowanceNanos,
  proratedPeriodChargeCents,
  recurringChargeFromItems,
  rollingCapNanos,
  spanEffectiveFrom,
  subscriptionAmountCents,
  videoUploadOutcome,
} from '../src/metering/aiBudget.js';
import { modelPriceTable, tokenCostNanos, tavilySearchCostNanos, whisperCostNanos } from '../src/metering/modelPriceTable.js';

const cfg = aiBudgetConfig({});

test('10% of a $125 plan is $12.50 of AI spend', () => {
  const charge = subscriptionAmountCents({ planCents: 12_500, extraSeats: 0, extraSeatCents: 12_500 });
  assert.equal(charge, 12_500);
  const nanos = allowanceNanos(charge, cfg.allowanceFraction);
  assert.equal(nanos, 12_500_000_000);
  assert.equal(nanos / NANOS_PER_CREDIT, 12.5);
});

test('extra seats are included in the charge the allowance is taken from', () => {
  const charge = subscriptionAmountCents({
    planCents: 84_900,
    extraSeats: 2,
    extraSeatCents: 12_500,
  });
  assert.equal(charge, 84_900 + 25_000);
  assert.equal(allowanceNanos(charge, 0.1), Math.round(charge * NANOS_PER_CENT * 0.1));
  const fromItems = recurringChargeFromItems([
    { unitAmountCents: 84_900, quantity: 1, interval: 'month' },
    { unitAmountCents: 12_500, quantity: 2, interval: 'month' },
  ]);
  assert.deepEqual(fromItems, { amountCents: 109_900, interval: 'month' });
});

test('a mid-period upgrade is prorated across the billing period', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-31T00:00:00.000Z');
  const change = new Date('2026-10-16T00:00:00.000Z');
  const before = subscriptionAmountCents({ planCents: 39_900, extraSeats: 0, extraSeatCents: 12_500 });
  const after = subscriptionAmountCents({ planCents: 84_900, extraSeats: 1, extraSeatCents: 12_500 });
  assert.equal(before, 39_900);
  assert.equal(after, 97_400);
  const charge = proratedPeriodChargeCents(start, end, [
    { amountCents: before, from: start, to: change },
    { amountCents: after, from: change, to: null },
  ]);
  assert.equal(charge, Math.round(39_900 * 0.5 + 97_400 * 0.5));
  const budget = allowanceNanos(charge, 0.1);
  assert.equal(budget, Math.round(charge * NANOS_PER_CENT * 0.1));
  assert.ok(budget > allowanceNanos(before, 0.1) / 2);
  assert.ok(budget < allowanceNanos(after, 0.1));
});

test('the first price observation covers the period; a later change starts at the change', () => {
  const periodStart = new Date('2026-10-01T00:00:00.000Z');
  const now = new Date('2026-10-10T00:00:00.000Z');
  assert.equal(spanEffectiveFrom({ hasExistingSpan: false, periodStart, at: now }).toISOString(), periodStart.toISOString());
  assert.equal(spanEffectiveFrom({ hasExistingSpan: true, periodStart, at: now }).toISOString(), now.toISOString());
});

test('the rolling window caps included allowance and can be turned off', () => {
  const monthly = allowanceNanos(12_500, 0.1);
  const cap = rollingCapNanos(monthly, 0.25, true);
  assert.equal(cap, Math.round(monthly * 0.25));
  assert.equal(rollingCapNanos(monthly, 0.25, false), null);
  const annual = allowanceNanos(399_000, 0.1);
  const monthSlice = monthlyAllowanceNanos(annual, new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'));
  assert.equal(monthSlice, Math.round(annual / 12));
  assert.equal(monthlyAllowanceNanos(monthly, new Date('2026-10-01Z'), new Date('2026-11-01Z')), monthly);
});

test('80% warns, 100% pauses non-essential AI, and credits keep it going', () => {
  const allowance = allowanceNanos(12_500, 0.1);
  const at80 = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: Math.round(allowance * 0.8),
    windowSpendNanos: 0,
    creditBalanceNanos: 0,
    config: cfg,
  });
  assert.equal(at80.state, 'warning');
  assert.equal(at80.paused, false);
  assert.match(customerAllowanceMessage({
    state: at80.state,
    resetAt: new Date('2026-11-01T00:00:00Z'),
    canManage: true,
    rollingLimited: false,
  }) ?? '', /allowance/i);
  assert.doesNotMatch(
    customerAllowanceMessage({
      state: at80.state,
      resetAt: new Date('2026-11-01T00:00:00Z'),
      canManage: true,
      rollingLimited: false,
    }) ?? '',
    /10%|margin|cogs|provider cost/i,
  );

  const at100 = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: allowance,
    windowSpendNanos: 0,
    creditBalanceNanos: 0,
    config: cfg,
  });
  assert.equal(at100.state, 'limited');
  assert.equal(at100.paused, true);

  const withCredits = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: allowance,
    windowSpendNanos: 0,
    creditBalanceNanos: 10_000_000_000,
    config: cfg,
  });
  assert.equal(withCredits.paused, false);
  assert.equal(withCredits.state, 'credits');
});

test('one heavy day cannot spend the whole included month unless the window is off or credits remain', () => {
  const allowance = allowanceNanos(12_500, 0.1);
  const cap = rollingCapNanos(allowance, 0.25, true)!;
  const blocked = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: cap,
    windowSpendNanos: cap,
    creditBalanceNanos: 0,
    config: cfg,
  });
  assert.equal(blocked.rollingLimited, true);
  assert.equal(blocked.paused, true);
  assert.ok(blocked.includedRemainingNanos > 0);

  const bought = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: cap,
    windowSpendNanos: cap,
    creditBalanceNanos: 1_000_000_000,
    config: cfg,
  });
  assert.equal(bought.paused, false);

  const off = evaluateAllowance({
    periodAllowanceNanos: allowance,
    monthlyAllowanceNanos: allowance,
    periodSpendNanos: allowance,
    windowSpendNanos: allowance,
    creditBalanceNanos: 0,
    config: { ...cfg, rollingEnabled: false },
  });
  assert.equal(off.rollingCapNanos, null);
  assert.equal(off.paused, true);
  assert.equal(off.rollingLimited, false);
});

test('uploads are stored either way; analysis waits only when the allowance is paused', () => {
  assert.deepEqual(videoUploadOutcome(false), { stored: true, analysis: 'queued' });
  assert.deepEqual(videoUploadOutcome(true), { stored: true, analysis: 'budget_hold' });
  assert.deepEqual(documentUploadOutcome(true), { stored: true, analysis: 'budget_hold' });
  const draw = allocateUsage({
    costNanos: 100,
    includedRemainingNanos: 40,
    windowSpendNanos: 0,
    rollingCapNanos: null,
    creditBalanceNanos: 50,
  });
  assert.deepEqual(draw, { allowanceNanos: 40, creditNanos: 50, blocked: true });
  const covered = allocateUsage({
    costNanos: 100,
    includedRemainingNanos: 0,
    windowSpendNanos: 0,
    rollingCapNanos: null,
    creditBalanceNanos: 100,
  });
  assert.equal(covered.blocked, false);
  assert.equal(covered.creditNanos, 100);
});

test('a credit Checkout grants 1:1 AI spend once, and a replay does not mint again', () => {
  assert.equal(creditNanosForPaymentCents(1_000, 1), 10_000_000_000);
  assert.equal(creditNanosForPaymentCents(2_500, 1) / NANOS_PER_CREDIT, 25);
  const grant = creditGrantFromCheckout(
    {
      id: 'cs_test_1',
      mode: 'payment',
      amount_total: 1_000,
      payment_status: 'paid',
      metadata: { kind: 'ai_credits', pack_cents: '1000' },
    },
    1,
  );
  assert.ok(grant);
  assert.equal(grant?.creditNanos, 10 * NANOS_PER_CREDIT);
  const first = applyCreditGrant({
    entries: [],
    stripeEventId: 'evt_1',
    deltaNanos: grant!.creditNanos,
  });
  assert.equal(first.applied, true);
  assert.equal(first.balanceNanos, 10 * NANOS_PER_CREDIT);
  const replay = applyCreditGrant({
    entries: first.entries,
    stripeEventId: 'evt_1',
    deltaNanos: grant!.creditNanos,
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.balanceNanos, first.balanceNanos);
  assert.equal(
    creditGrantFromCheckout({ id: 'cs_x', mode: 'subscription', metadata: { kind: 'ai_credits' } }, 1),
    null,
  );
});

test('only org admins can buy and only internal staff can grant', () => {
  assert.equal(canPurchaseAiCredits('global_admin'), true);
  assert.equal(canPurchaseAiCredits('office_manager'), true);
  assert.equal(canPurchaseAiCredits('employee'), false);
  assert.equal(canPurchaseAiCredits('field_technician'), false);
  assert.equal(canPurchaseAiCredits(null), false);
  assert.equal(canGrantAiCredits('internal'), true);
  assert.equal(canGrantAiCredits('investor'), false);
  assert.equal(canGrantAiCredits(null), false);
});

test('the price table prices tokens, Whisper minutes, and Tavily searches', () => {
  const table = modelPriceTable({});
  const gemini = tokenCostNanos(table, {
    provider: 'google',
    tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
  });
  assert.equal(gemini, 500_000_000);
  const claude = tokenCostNanos(table, {
    modelId: 'claude-sonnet-4-6',
    tokens: { inputTokens: 1_000_000, outputTokens: 0 },
  });
  assert.equal(claude, 3_000_000_000);
  assert.equal(whisperCostNanos(table, 60), Math.round(0.006 * NANOS_PER_CREDIT));
  assert.equal(tavilySearchCostNanos(table, 1), Math.round(0.008 * NANOS_PER_CREDIT));
});

test('allowance fraction, window, and credit ratio are config, not scattered constants', () => {
  const custom = aiBudgetConfig({
    AI_BUDGET_FRACTION: '0.2',
    AI_BUDGET_ROLLING_ENABLED: 'false',
    AI_BUDGET_ROLLING_FRACTION: '0.5',
    AI_CREDIT_USD_RATIO: '1',
  });
  assert.equal(custom.allowanceFraction, 0.2);
  assert.equal(custom.rollingEnabled, false);
  assert.equal(custom.rollingFraction, 0.5);
  assert.equal(custom.creditUsdRatio, 1);
  assert.equal(allowanceNanos(12_500, custom.allowanceFraction) / NANOS_PER_CREDIT, 25);
});
