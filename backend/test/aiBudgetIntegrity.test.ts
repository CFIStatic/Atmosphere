import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NANOS_PER_CENT } from '../src/lib/money.js';
import {
  creditDisputeStanding,
  creditPackClawbackTarget,
  creditRefundDebitNanos,
  disputeUpdateApplies,
  proratedPeriodChargeCents,
  type CreditDisputeStanding,
} from '../src/metering/aiBudget.js';
import { recordSubscriptionPriceSpan, syncCreditPackClawback } from '../src/metering/aiBudgetService.js';

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

type ClawbackCall = Record<string, unknown>;

/** In-memory stand-in for apply_ai_credit_clawback, including the balance floor. */
function clawbackClient(initialBalance: number) {
  let balance = initialBalance;
  const events = new Map<string, { debited: number; restored: number }>();
  const charges = new Map<string, {
    granted: number;
    chargeAmount: number;
    refunded: number;
    disputeAmount: number;
    standing: CreditDisputeStanding | null;
    eventAt: Date | null;
    clawed: number;
  }>();
  const calls: ClawbackCall[] = [];
  const client = {
    calls,
    balance: () => balance,
    clawed: (chargeId: string) => charges.get(chargeId)?.clawed ?? 0,
    standing: (chargeId: string) => charges.get(chargeId)?.standing ?? null,
    async rpc(name: string, args: ClawbackCall) {
      assert.equal(name, 'apply_ai_credit_clawback');
      calls.push(args);
      const eventId = String(args.p_event_id);
      const chargeId = String(args.p_charge_id);
      if (events.has(eventId)) {
        const prior = events.get(eventId)!;
        return {
          data: [{
            applied: false,
            debited_nanos: prior.debited,
            restored_nanos: prior.restored,
            shortfall_nanos: 0,
            balance_nanos: balance,
            clawed_nanos: charges.get(chargeId)?.clawed ?? 0,
          }],
          error: null,
        };
      }
      const state = charges.get(chargeId) ?? {
        granted: 0,
        chargeAmount: 0,
        refunded: 0,
        disputeAmount: 0,
        standing: null as CreditDisputeStanding | null,
        eventAt: null as Date | null,
        clawed: 0,
      };
      state.granted = Math.max(state.granted, Number(args.p_granted_nanos));
      state.chargeAmount = Math.max(state.chargeAmount, Number(args.p_charge_amount_cents));
      state.refunded = Math.max(state.refunded, Number(args.p_amount_refunded_cents ?? 0));
      if (args.p_dispute_standing != null) {
        const incomingAt = args.p_event_at ? new Date(String(args.p_event_at)) : null;
        if (disputeUpdateApplies({
          storedStanding: state.standing,
          storedEventAt: state.eventAt,
          incomingStanding: args.p_dispute_standing as CreditDisputeStanding,
          incomingEventAt: incomingAt,
        })) {
          state.standing = args.p_dispute_standing as CreditDisputeStanding;
          state.disputeAmount = Number(args.p_dispute_amount_cents ?? 0);
          state.eventAt = incomingAt;
        }
      }
      charges.set(chargeId, state);
      const target = creditPackClawbackTarget({
        chargeAmountCents: state.chargeAmount,
        grantedCreditNanos: state.granted,
        amountRefundedCents: state.refunded,
        disputeAmountCents: state.disputeAmount,
        disputeStanding: state.standing,
      });
      const delta = target - state.clawed;
      let debited = 0;
      let restored = 0;
      let shortfall = 0;
      if (delta > 0) {
        debited = Math.min(delta, Math.max(balance, 0));
        shortfall = delta - debited;
        balance -= debited;
        state.clawed += debited;
      } else if (delta < 0) {
        restored = -delta;
        balance += restored;
        state.clawed -= restored;
      }
      assert.ok(balance >= 0);
      assert.ok(state.clawed <= state.granted);
      events.set(eventId, { debited, restored });
      return {
        data: [{
          applied: true,
          debited_nanos: debited,
          restored_nanos: restored,
          shortfall_nanos: shortfall,
          balance_nanos: balance,
          clawed_nanos: state.clawed,
        }],
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
  return client;
}

test('a later larger refund debits only the increase for that charge', async () => {
  const granted = 5_000 * NANOS_PER_CENT;
  const otherPack = 5_000 * NANOS_PER_CENT;
  assert.equal(creditRefundDebitNanos(5_000, 2_500, granted), granted / 2);
  assert.equal(creditPackClawbackTarget({
    chargeAmountCents: 5_000,
    grantedCreditNanos: granted,
    amountRefundedCents: 5_000,
  }), granted);

  const client = clawbackClient(granted + otherPack);
  const pack = {
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
  };
  await syncCreditPackClawback(client as never, 'org-1', {
    ...pack,
    eventId: 'evt_refund_partial',
    amountRefundedCents: 2_500,
    note: 'refund of credit pack ch_pack',
  });
  assert.equal(client.clawed('ch_pack'), granted / 2);
  assert.equal(client.balance(), granted / 2 + otherPack);

  await syncCreditPackClawback(client as never, 'org-1', {
    ...pack,
    eventId: 'evt_refund_rest',
    amountRefundedCents: 5_000,
    note: 'refund of credit pack ch_pack',
  });
  assert.equal(client.clawed('ch_pack'), granted);
  assert.equal(client.balance(), otherPack);
  assert.equal(client.calls[1]!.p_event_id, 'evt_refund_rest');
  assert.equal(client.calls[1]!.p_charge_id, 'ch_pack');
  assert.equal(client.calls[1]!.p_amount_refunded_cents, 5_000);
  assert.equal(client.calls[1]!.p_dispute_standing, null);

  await syncCreditPackClawback(client as never, 'org-1', {
    ...pack,
    eventId: 'evt_refund_rest',
    amountRefundedCents: 5_000,
    note: 'refund of credit pack ch_pack',
  });
  assert.equal(client.balance(), otherPack);
  assert.equal(client.calls.length, 3);

  await syncCreditPackClawback(client as never, 'org-1', {
    eventId: 'evt_sub',
    chargeId: 'ch_sub',
    chargeAmountCents: 12_500,
    amountRefundedCents: 12_500,
    metadata: { kind: 'subscription' },
    note: 'refund',
  });
  assert.equal(client.calls.length, 3);

  assert.match(webhooks, /amountRefundedCents: charge\.amount_refunded/);
  assert.match(webhooks, /syncCreditPackClawback\(admin, orgId, \{\s*eventId,/);
  assert.doesNotMatch(webhooks, /refunds\?\.data/);
  assert.match(sql, /p_event_id/);
  assert.match(sql, /greatest\(v_refund_share, v_dispute_share\)/);
  assert.match(sql, /v_delta := v_target - v_clawed/);
  assert.match(sql, /v_debit := least\(v_delta, v_balance\)/);
  assert.match(sql, /shortfall_nanos=/);
});

test('a dispute and a refund share one pack cap, and a won dispute restores only the uncovered part', async () => {
  const granted = 5_000 * NANOS_PER_CENT;
  const otherPack = 5_000 * NANOS_PER_CENT;
  assert.equal(creditDisputeStanding('won'), 'won');
  assert.equal(creditDisputeStanding('needs_response'), 'open');
  assert.equal(creditPackClawbackTarget({
    chargeAmountCents: 5_000,
    grantedCreditNanos: granted,
    amountRefundedCents: 5_000,
    disputeAmountCents: 5_000,
    disputeStanding: 'open',
  }), granted);
  assert.equal(creditPackClawbackTarget({
    chargeAmountCents: 5_000,
    grantedCreditNanos: granted,
    amountRefundedCents: 0,
    disputeAmountCents: 5_000,
    disputeStanding: 'won',
  }), 0);
  assert.equal(creditPackClawbackTarget({
    chargeAmountCents: 5_000,
    grantedCreditNanos: granted,
    amountRefundedCents: 1_000,
    disputeAmountCents: 2_500,
    disputeStanding: 'won',
  }), granted / 5);

  const stacked = clawbackClient(granted + otherPack);
  await syncCreditPackClawback(stacked as never, 'org-1', {
    eventId: 'evt_dispute_open',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 0,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    disputeAmountCents: 5_000,
    disputeStatus: 'needs_response',
    note: 'dispute opened',
  });
  await syncCreditPackClawback(stacked as never, 'org-1', {
    eventId: 'evt_refund_same_pack',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    note: 'refund of credit pack ch_pack',
  });
  assert.equal(stacked.clawed('ch_pack'), granted);
  assert.equal(stacked.balance(), otherPack);

  await syncCreditPackClawback(stacked as never, 'org-1', {
    eventId: 'evt_dispute_won_but_refunded',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    disputeAmountCents: 5_000,
    disputeStatus: 'won',
    note: 'dispute won',
  });
  assert.equal(stacked.clawed('ch_pack'), granted);
  assert.equal(stacked.balance(), otherPack);

  const restored = clawbackClient(granted);
  await syncCreditPackClawback(restored as never, 'org-1', {
    eventId: 'evt_dispute_only',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 0,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    disputeAmountCents: 5_000,
    disputeStatus: 'needs_response',
    note: 'dispute opened',
  });
  assert.equal(restored.balance(), 0);
  await syncCreditPackClawback(restored as never, 'org-1', {
    eventId: 'evt_dispute_won',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 0,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    disputeAmountCents: 5_000,
    disputeStatus: 'won',
    note: 'dispute won',
  });
  assert.equal(restored.clawed('ch_pack'), 0);
  assert.equal(restored.balance(), granted);

  const short = clawbackClient(granted / 5);
  await syncCreditPackClawback(short as never, 'org-1', {
    eventId: 'evt_refund_short',
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    amountRefundedCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    note: 'refund of credit pack ch_pack',
  });
  assert.equal(short.balance(), 0);
  assert.equal(short.clawed('ch_pack'), granted / 5);

  assert.match(webhooks, /case 'charge\.dispute\.closed'/);
  assert.match(webhooks, /case 'charge\.refunded'/);
  assert.match(sql, /dispute_standing <> 'won'/);
  assert.match(sql, /v_shortfall := v_delta - v_debit/);
  assert.match(sql, /'adjustment'/);
  assert.match(sql, /stripe_charge_id = p_charge_id/);
});

test('a closed dispute stays closed when an older open event arrives', async () => {
  const granted = 5_000 * NANOS_PER_CENT;
  const pack = {
    chargeId: 'ch_pack',
    chargeAmountCents: 5_000,
    metadata: { kind: 'ai_credits', credit_nanos: String(granted) },
    disputeAmountCents: 5_000,
  };
  const opened = new Date('2026-10-01T12:00:00.000Z');
  const updated = new Date('2026-10-02T12:00:00.000Z');
  const closed = new Date('2026-10-03T12:00:00.000Z');

  assert.equal(disputeUpdateApplies({
    storedStanding: 'won',
    storedEventAt: closed,
    incomingStanding: 'open',
    incomingEventAt: opened,
  }), false);
  assert.equal(disputeUpdateApplies({
    storedStanding: 'lost',
    storedEventAt: closed,
    incomingStanding: 'open',
    incomingEventAt: opened,
  }), false);
  assert.equal(disputeUpdateApplies({
    storedStanding: 'open',
    storedEventAt: updated,
    incomingStanding: 'won',
    incomingEventAt: closed,
  }), true);

  const afterWon = clawbackClient(granted);
  await syncCreditPackClawback(afterWon as never, 'org-1', {
    ...pack,
    eventId: 'evt_created',
    amountRefundedCents: 0,
    disputeStatus: 'needs_response',
    eventAt: opened,
    note: 'dispute created',
  });
  await syncCreditPackClawback(afterWon as never, 'org-1', {
    ...pack,
    eventId: 'evt_closed_won',
    amountRefundedCents: 0,
    disputeStatus: 'won',
    eventAt: closed,
    note: 'dispute won',
  });
  assert.equal(afterWon.balance(), granted);
  assert.equal(afterWon.standing('ch_pack'), 'won');

  await syncCreditPackClawback(afterWon as never, 'org-1', {
    ...pack,
    eventId: 'evt_created',
    amountRefundedCents: 0,
    disputeStatus: 'needs_response',
    eventAt: opened,
    note: 'dispute created',
  });
  assert.equal(afterWon.balance(), granted);
  assert.equal(afterWon.standing('ch_pack'), 'won');

  await syncCreditPackClawback(afterWon as never, 'org-1', {
    ...pack,
    eventId: 'evt_created_late',
    amountRefundedCents: 0,
    disputeStatus: 'warning_needs_response',
    eventAt: opened,
    note: 'dispute created late',
  });
  assert.equal(afterWon.clawed('ch_pack'), 0);
  assert.equal(afterWon.balance(), granted);
  assert.equal(afterWon.standing('ch_pack'), 'won');

  const afterLost = clawbackClient(granted);
  await syncCreditPackClawback(afterLost as never, 'org-1', {
    ...pack,
    eventId: 'evt_closed_lost',
    amountRefundedCents: 0,
    disputeStatus: 'lost',
    eventAt: closed,
    note: 'dispute lost',
  });
  assert.equal(afterLost.clawed('ch_pack'), granted);
  assert.equal(afterLost.balance(), 0);
  await syncCreditPackClawback(afterLost as never, 'org-1', {
    ...pack,
    eventId: 'evt_created_after_lost',
    amountRefundedCents: 0,
    disputeStatus: 'needs_response',
    eventAt: opened,
    note: 'dispute created',
  });
  assert.equal(afterLost.clawed('ch_pack'), granted);
  assert.equal(afterLost.balance(), 0);
  assert.equal(afterLost.standing('ch_pack'), 'lost');

  const outOfOrder = clawbackClient(granted);
  await syncCreditPackClawback(outOfOrder as never, 'org-1', {
    ...pack,
    eventId: 'evt_closed_first',
    amountRefundedCents: 0,
    disputeStatus: 'won',
    eventAt: closed,
    note: 'dispute closed',
  });
  await syncCreditPackClawback(outOfOrder as never, 'org-1', {
    ...pack,
    eventId: 'evt_updated_earlier',
    amountRefundedCents: 0,
    disputeStatus: 'under_review',
    eventAt: updated,
    note: 'dispute updated',
  });
  assert.equal(outOfOrder.standing('ch_pack'), 'won');
  assert.equal(outOfOrder.clawed('ch_pack'), 0);
  assert.equal(outOfOrder.balance(), granted);

  const closedLast = clawbackClient(granted);
  await syncCreditPackClawback(closedLast as never, 'org-1', {
    ...pack,
    eventId: 'evt_updated_open',
    amountRefundedCents: 0,
    disputeStatus: 'under_review',
    eventAt: updated,
    note: 'dispute updated',
  });
  assert.equal(closedLast.clawed('ch_pack'), granted);
  await syncCreditPackClawback(closedLast as never, 'org-1', {
    ...pack,
    eventId: 'evt_closed_later',
    amountRefundedCents: 0,
    disputeStatus: 'won',
    eventAt: closed,
    note: 'dispute closed',
  });
  assert.equal(closedLast.standing('ch_pack'), 'won');
  assert.equal(closedLast.clawed('ch_pack'), 0);
  assert.equal(closedLast.balance(), granted);

  assert.match(webhooks, /case 'charge\.dispute\.updated'/);
  assert.match(webhooks, /event\.created/);
  assert.match(sql, /when 'open' then 1/);
  assert.match(sql, /v_incoming_rank > v_stored_rank/);
  assert.match(sql, /p_event_at >= v_state\.dispute_event_at/);
  assert.match(sql, /where stripe_event_id = p_event_id/);
});
