import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USAGE_CUSTOMER_MARKUP,
  billableNanosFromCost,
  resolveTokenLedgerAmounts,
  usageCustomerMarkup,
} from './customerMarkup.js';

test('usageCustomerMarkup defaults to 10×', () => {
  assert.equal(DEFAULT_USAGE_CUSTOMER_MARKUP, 10);
  assert.equal(usageCustomerMarkup({}), 10);
  assert.equal(usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: '' }), 10);
  assert.equal(usageCustomerMarkup({ TOKEN_BILLABLE_MARKUP: '' }), 10);
});

test('usageCustomerMarkup reads USAGE_CUSTOMER_MARKUP then TOKEN_BILLABLE_MARKUP', () => {
  assert.equal(usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: '8' }), 8);
  assert.equal(usageCustomerMarkup({ TOKEN_BILLABLE_MARKUP: '12' }), 12);
  assert.equal(
    usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: '8', TOKEN_BILLABLE_MARKUP: '12' }),
    8,
  );
});

test('usageCustomerMarkup rejects values below 1×', () => {
  assert.equal(usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: '0' }), 10);
  assert.equal(usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: '0.5' }), 10);
  assert.equal(usageCustomerMarkup({ USAGE_CUSTOMER_MARKUP: 'nope' }), 10);
});

test('billableNanosFromCost is round(cost × 10) by default', () => {
  assert.equal(billableNanosFromCost(1_280_000), 12_800_000);
  assert.equal(billableNanosFromCost(18_400_000), 184_000_000);
  assert.equal(billableNanosFromCost(1), 10);
  assert.equal(billableNanosFromCost(0), 0);
  assert.equal(billableNanosFromCost(-4), 0);
});

test('billableNanosFromCost honors an explicit markup and rounds once', () => {
  assert.equal(billableNanosFromCost(100, 10), 1_000);
  assert.equal(billableNanosFromCost(3, 10), 30);
  assert.equal(billableNanosFromCost(1, 2.5), 3);
});

test('resolveTokenLedgerAmounts treats a lone priceNanos as legacy cost', () => {
  assert.deepEqual(resolveTokenLedgerAmounts({ priceNanos: 1_280_000 }), {
    costNanos: 1_280_000,
    priceNanos: 12_800_000,
  });
});

test('resolveTokenLedgerAmounts marks up cost when billable is omitted', () => {
  assert.deepEqual(resolveTokenLedgerAmounts({ costNanos: 9_200_000 }), {
    costNanos: 9_200_000,
    priceNanos: 92_000_000,
  });
});

test('resolveTokenLedgerAmounts keeps an explicit cost + billable pair', () => {
  assert.deepEqual(
    resolveTokenLedgerAmounts({ costNanos: 1_000, priceNanos: 4_000 }),
    { costNanos: 1_000, priceNanos: 4_000 },
  );
});

test('resolveTokenLedgerAmounts does not invent amounts for empty input', () => {
  assert.deepEqual(resolveTokenLedgerAmounts({}), { costNanos: 0, priceNanos: 0 });
  assert.deepEqual(resolveTokenLedgerAmounts({ costNanos: 0, priceNanos: 0 }), {
    costNanos: 0,
    priceNanos: 0,
  });
});
