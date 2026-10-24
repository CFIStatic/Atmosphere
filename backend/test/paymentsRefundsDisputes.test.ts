/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyJobPaymentDispute,
  disputeOutcome,
  planRefund,
  refundedStatus,
  staleHoldAction,
  sweepConfigFromEnv,
  type RefundLine,
} from '../src/payments/disputes.js';

const line = (o: Partial<RefundLine>): RefundLine => ({
  id: 'l', position: 0, amount_cents: 1000, release_status: 'held', release_cents: null,
  refunded_cents: 0, reversed_cents: 0, stripe_transfer_id: null, released_at: null, ...o,
});

test('planRefund takes held money first, then reverses newest released line', () => {
  const lines = [
    line({ id: 'a', position: 0, release_status: 'released', release_cents: 970, stripe_transfer_id: 'tr_a', released_at: '2026-10-01' }),
    line({ id: 'b', position: 1, release_status: 'released', release_cents: 970, stripe_transfer_id: 'tr_b', released_at: '2026-10-05' }),
    line({ id: 'c', position: 2, release_status: 'verified', amount_cents: 500 }),
  ];
  const plan = planRefund(lines, 1800);
  assert.deepEqual(plan.fromHeld, [{ lineId: 'c', cents: 500, fully: true }]);
  assert.deepEqual(plan.reversals, [
    { lineId: 'b', transferId: 'tr_b', cents: 970, fully: true },
    { lineId: 'a', transferId: 'tr_a', cents: 330, fully: false },
  ]);
  assert.equal(plan.unallocatedCents, 0);
});

test('planRefund respects earlier partial refunds and reversals', () => {
  const lines = [
    line({ id: 'a', release_status: 'held', refunded_cents: 600 }),
    line({ id: 'b', position: 1, release_status: 'released', release_cents: 970, reversed_cents: 900, stripe_transfer_id: 'tr_b' }),
  ];
  const plan = planRefund(lines, 1000);
  assert.deepEqual(plan.fromHeld, [{ lineId: 'a', cents: 400, fully: true }]);
  assert.deepEqual(plan.reversals, [{ lineId: 'b', transferId: 'tr_b', cents: 70, fully: true }]);
  // The rest is the platform fee portion, kept on the platform balance.
  assert.equal(plan.unallocatedCents, 530);
});

test('refundedStatus', () => {
  assert.equal(refundedStatus(1000, 1000, 'paid'), 'refunded');
  assert.equal(refundedStatus(1000, 1, 'paid'), 'partially_refunded');
  assert.equal(refundedStatus(1000, 0, 'paid'), 'paid');
  assert.equal(refundedStatus(1000, 1000, 'disputed'), 'disputed');
});

test('disputeOutcome', () => {
  assert.equal(disputeOutcome({ status: 'needs_response' }), 'open');
  assert.equal(disputeOutcome({ status: 'under_review' }), 'open');
  assert.equal(disputeOutcome({ status: 'won' }), 'won');
  assert.equal(disputeOutcome({ status: 'warning_closed' }), 'won');
  assert.equal(disputeOutcome({ status: 'lost' }), 'lost');
});

test('stale hold sweep config and policy', () => {
  assert.deepEqual(sweepConfigFromEnv({}), { alertDays: 30, autoRefundDays: 0 });
  assert.deepEqual(sweepConfigFromEnv({ PAYMENTS_HELD_ALERT_DAYS: '14', PAYMENTS_HELD_AUTO_REFUND_DAYS: '90' }), { alertDays: 14, autoRefundDays: 90 });
  assert.deepEqual(sweepConfigFromEnv({ PAYMENTS_HELD_ALERT_DAYS: 'x' }), { alertDays: 30, autoRefundDays: 0 });
  const now = new Date('2026-12-01T00:00:00Z');
  const cfg = { alertDays: 30, autoRefundDays: 0 };
  assert.equal(staleHoldAction('2026-11-20T00:00:00Z', false, cfg, now), 'none');
  assert.equal(staleHoldAction('2026-10-20T00:00:00Z', false, cfg, now), 'alert');
  assert.equal(staleHoldAction('2026-10-20T00:00:00Z', true, cfg, now), 'none');
  assert.equal(staleHoldAction('2026-08-01T00:00:00Z', true, cfg, now), 'none');
  assert.equal(staleHoldAction('2026-08-01T00:00:00Z', true, { alertDays: 30, autoRefundDays: 90 }, now), 'refund');
  assert.equal(staleHoldAction(null, false, cfg, now), 'none');
});

/** Minimal Supabase query mock: records updates, serves fixed rows. */
function fakeAdmin(tables: Record<string, any[]>) {
  const updates: Array<{ table: string; patch: any; filters: any[] }> = [];
  const from = (table: string) => {
    const filters: any[] = [];
    let patch: any = null;
    const q: any = {
      select: () => q,
      update: (p: any) => ((patch = p), q),
      eq: (c: string, v: any) => (filters.push(['eq', c, v]), q),
      neq: (c: string, v: any) => (filters.push(['neq', c, v]), q),
      in: (c: string, v: any[]) => (filters.push(['in', c, v]), q),
      not: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
      then: (res: any) => {
        if (patch) updates.push({ table, patch, filters: [...filters] });
        return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res);
      },
    };
    return q;
  };
  return { admin: { from }, updates };
}

test('dispute opened: freezes unreleased lines, flags released, marks payment disputed', async () => {
  const { admin, updates } = fakeAdmin({
    job_payments: [{ id: 'p1', org_id: 'o', invoice_id: 'i', amount_cents: 2000, status: 'paid', refunded_cents: 0 }],
    job_invoice_lines: [
      { id: 'a', release_status: 'released', stripe_transfer_id: 'tr', release_cents: 970, reversed_cents: 0, amount_cents: 1000 },
      { id: 'b', release_status: 'verified', amount_cents: 1000, refunded_cents: 0, reversed_cents: 0 },
    ],
  });
  const handled = await applyJobPaymentDispute(admin, { id: 'dp_1', status: 'needs_response', payment_intent: 'pi_1' }, {});
  assert.equal(handled, true);
  const freeze = updates.find((u) => u.patch.release_status === 'frozen');
  assert.deepEqual(freeze?.filters.find((f) => f[0] === 'in')?.[2], ['b']);
  const flag = updates.find((u) => u.patch.dispute_flag === true);
  assert.deepEqual(flag?.filters.find((f) => f[0] === 'in')?.[2], ['a']);
  const pay = updates.find((u) => u.table === 'job_payments');
  assert.equal(pay?.patch.status, 'disputed');
  assert.equal(pay?.patch.stripe_dispute_id, 'dp_1');
});

test('dispute lost: frozen lines become refunded, payment dispute_lost', async () => {
  const { admin, updates } = fakeAdmin({
    job_payments: [{ id: 'p1', org_id: 'o', invoice_id: 'i', amount_cents: 2000, status: 'disputed', refunded_cents: 0 }],
    job_invoice_lines: [{ id: 'b', release_status: 'frozen', amount_cents: 1000, refunded_cents: 0, reversed_cents: 0 }],
  });
  await applyJobPaymentDispute(admin, { id: 'dp_1', status: 'lost', payment_intent: 'pi_1' }, {});
  assert.ok(updates.some((u) => u.patch.release_status === 'refunded' && u.filters.some((f) => f[1] === 'release_status' && f[2] === 'frozen')));
  assert.equal(updates.find((u) => u.table === 'job_payments')?.patch.status, 'dispute_lost');
});

test('dispute for a non-job charge is not handled here', async () => {
  const { admin } = fakeAdmin({ job_payments: [] });
  assert.equal(await applyJobPaymentDispute(admin, { id: 'dp', status: 'needs_response', payment_intent: 'pi_x' }, {}), false);
});
