import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NANOS_PER_CENT } from '../src/lib/money.js';
import {
  creditPackRefundLegs,
  creditRefundDebitNanos,
  proratedPeriodChargeCents,
} from '../src/metering/aiBudget.js';
import { clawBackAiCreditCharge, recordSubscriptionPriceSpan } from '../src/metering/aiBudgetService.js';

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261002140000_ai_budget_span_and_refund.sql', import.meta.url)),
  'utf8',
);
const webhooks = readFileSync(
  fileURLToPath(new URL('../src/routes/webhooks.ts', import.meta.url)),
  'utf8',
);

test('overlapping open price spans cannot inflate the allowance', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: null, error: null };
    },
    from() {
      throw new Error('price spans must be closed and inserted in SQL, not from the API');
    },
  };

  await recordSubscriptionPriceSpan(client as never, 'org-1', {
    amountCents: 97_400,
    interval: 'month',
    at: new Date('2026-10-16T00:00:00.000Z'),
    periodStart: new Date('2026-10-01T00:00:00.000Z'),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, 'record_subscription_price_span');
  assert.equal(calls[0]!.args.p_org, 'org-1');
  assert.equal(calls[0]!.args.p_amount_cents, 97_400);
  assert.match(sql, /create unique index if not exists ai_budget_price_spans_one_open_idx/);
  assert.match(sql, /on public\.ai_budget_price_spans \(org_id\)\s+where effective_to is null/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('ai-budget-price-span'\)/);
  assert.match(sql, /set effective_to = p_at/);
  assert.match(sql, /insert into public\.ai_budget_price_spans/);

  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-31T00:00:00.000Z');
  const change = new Date('2026-10-16T00:00:00.000Z');
  const overlapped = proratedPeriodChargeCents(start, end, [
    { amountCents: 39_900, from: start, to: null },
    { amountCents: 97_400, from: change, to: null },
  ]);
  const closed = proratedPeriodChargeCents(start, end, [
    { amountCents: 39_900, from: start, to: change },
    { amountCents: 97_400, from: change, to: null },
  ]);
  assert.equal(overlapped, closed);
  assert.equal(overlapped, Math.round(39_900 * 0.5 + 97_400 * 0.5));
  assert.ok(overlapped < 39_900 + 97_400);
});

test('a credit-pack refund or dispute debits once per id and stops at zero', async () => {
  const granted = 5_000 * NANOS_PER_CENT;
  assert.equal(creditRefundDebitNanos(5_000, 2_500, granted), granted / 2);
  const legs = creditPackRefundLegs({
    chargeAmountCents: 5_000,
    grantedCreditNanos: granted,
    refunds: [
      { id: 're_full', amountCents: 5_000, status: 'succeeded' },
      { id: 're_failed', amountCents: 5_000, status: 'failed' },
    ],
  });
  assert.deepEqual(legs, [{ refundId: 're_full', debitNanos: granted }]);

  let balance = granted / 5;
  const seen = new Map<string, number>();
  const requested: number[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, 'refund_ai_credits');
      const refundId = String(args.p_refund_id);
      const debitRequested = Number(args.p_debit_nanos);
      requested.push(debitRequested);
      if (seen.has(refundId)) {
        return {
          data: [{ applied: false, debited_nanos: seen.get(refundId), shortfall_nanos: 0, balance_nanos: balance }],
          error: null,
        };
      }
      const debited = Math.min(debitRequested, Math.max(balance, 0));
      const shortfall = debitRequested - debited;
      balance -= debited;
      seen.set(refundId, debited);
      assert.ok(balance >= 0);
      return {
        data: [{ applied: true, debited_nanos: debited, shortfall_nanos: shortfall, balance_nanos: balance }],
        error: null,
      };
    },
    from(table: string) {
      assert.equal(table, 'payments');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { description: 'Subscription', amount_cents: 12_500 }, error: null };
        },
      };
    },
  };

  const pack = {
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    legs: [{ id: 're_full', amountCents: 5_000, status: 'succeeded' }],
    note: 'refund of credit pack ch_pack',
  };
  await clawBackAiCreditCharge(client as never, 'org-1', pack);
  assert.equal(seen.get('re_full'), granted / 5);
  assert.equal(balance, 0);
  assert.equal(requested[0], granted);

  await clawBackAiCreditCharge(client as never, 'org-1', pack);
  assert.equal(balance, 0);
  assert.equal(seen.size, 1);

  await clawBackAiCreditCharge(client as never, 'org-1', {
    ...pack,
    legs: [{ id: 'dp_1', amountCents: 5_000, status: 'succeeded' }],
    note: 'dispute dp_1 on credit pack ch_pack',
  });
  assert.equal(balance, 0);
  assert.equal(seen.get('dp_1'), 0);
  assert.equal(requested[requested.length - 1], granted);

  await clawBackAiCreditCharge(client as never, 'org-1', {
    chargeId: 'ch_sub',
    chargeAmountCents: 12_500,
    metadata: { kind: 'subscription' },
    legs: [{ id: 're_sub', amountCents: 12_500, status: 'succeeded' }],
    note: 'refund',
  });
  assert.equal(seen.has('re_sub'), false);

  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('ai-credit-draw'\)/);
  assert.match(sql, /where stripe_event_id = p_refund_id/);
  assert.match(sql, /v_debit := least\(v_requested, v_balance\)/);
  assert.match(sql, /v_shortfall := v_requested - v_debit/);
  assert.match(sql, /shortfall_nanos=/);
  assert.match(sql, /-v_debit,\s+'refund'/);
  assert.match(webhooks, /case 'charge\.dispute\.created'/);
  assert.match(webhooks, /clawBackAiCreditCharge/);
});
