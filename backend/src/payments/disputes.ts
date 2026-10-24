/**
 * Refunds, disputes and the stale-hold sweep for proof-based job payments
 * (separate charges and transfers).
 *
 * Money model: the homeowner's charge sits on the platform balance. Lines that
 * have not been released are still ours to refund. Released lines were
 * transferred to the contractor, so refunding them needs a Transfer reversal.
 *
 * Refund allocation (planRefund): unreleased lines first (no money moves
 * between accounts), newest released line last-in-first-out after that.
 * allocateRefund is idempotent: it compares the charge's cumulative refunded
 * amount with job_payments.refunded_cents and only allocates the difference,
 * so the API route and charge.refunded webhook replays share one code path.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { stripeClient } from '../lib/stripe.js';
import { verifyInvoiceLines } from './release.js';

export type RefundLine = {
  id: string;
  position: number;
  amount_cents: number;
  release_status: string;
  release_cents: number | null;
  refunded_cents: number;
  reversed_cents: number;
  stripe_transfer_id: string | null;
  released_at: string | null;
};

export type RefundPlan = {
  fromHeld: Array<{ lineId: string; cents: number; fully: boolean }>;
  reversals: Array<{ lineId: string; transferId: string; cents: number; fully: boolean }>;
  unallocatedCents: number;
};

const UNRELEASED = new Set(['unpaid', 'held', 'verified', 'frozen']);

/** Pure: split `cents` of new refund across lines. */
export function planRefund(lines: RefundLine[], cents: number): RefundPlan {
  let left = Math.max(0, Math.floor(cents));
  const plan: RefundPlan = { fromHeld: [], reversals: [], unallocatedCents: 0 };
  const held = lines.filter((l) => UNRELEASED.has(l.release_status)).sort((a, b) => b.position - a.position);
  for (const l of held) {
    if (!left) break;
    const room = Number(l.amount_cents) - Number(l.refunded_cents || 0);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    plan.fromHeld.push({ lineId: l.id, cents: take, fully: take === room });
    left -= take;
  }
  const released = lines
    .filter((l) => l.release_status === 'released' && l.stripe_transfer_id)
    .sort((a, b) => String(b.released_at ?? '').localeCompare(String(a.released_at ?? '')) || b.position - a.position);
  for (const l of released) {
    if (!left) break;
    const room = Number(l.release_cents ?? l.amount_cents) - Number(l.reversed_cents || 0);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    plan.reversals.push({ lineId: l.id, transferId: String(l.stripe_transfer_id), cents: take, fully: take === room });
    left -= take;
  }
  plan.unallocatedCents = left;
  return plan;
}

/** Pure: payment status after a cumulative refund. */
export function refundedStatus(amountCents: number, refundedCents: number, current: string): string {
  if (current === 'disputed' || current === 'dispute_lost') return current;
  if (refundedCents >= amountCents) return 'refunded';
  return refundedCents > 0 ? 'partially_refunded' : current;
}

const LINE_COLS = 'id, position, amount_cents, release_status, release_cents, refunded_cents, reversed_cents, stripe_transfer_id, released_at, invoice_id, org_id, job_id';

async function invoiceLines(admin: any, orgId: string, invoiceId: string): Promise<RefundLine[]> {
  const { data, error } = await admin.from('job_invoice_lines').select(LINE_COLS).eq('org_id', orgId).eq('invoice_id', invoiceId);
  if (error) throw new Error(`invoice ${invoiceId} lines load failed: ${error.message}`);
  return (data ?? []) as RefundLine[];
}

/**
 * Bring our records up to `totalRefundedCents` (the charge's cumulative
 * amount_refunded). Reverses released transfers as needed. Safe to replay.
 */
export async function allocateRefund(admin: any, paymentId: string, totalRefundedCents: number): Promise<RefundPlan | null> {
  const { data: pay, error } = await admin
    .from('job_payments')
    .select('id, org_id, invoice_id, amount_cents, refunded_cents, status')
    .eq('id', paymentId)
    .maybeSingle();
  if (error || !pay) throw new Error(`job payment ${paymentId} load failed`);
  const delta = Math.floor(totalRefundedCents) - Number(pay.refunded_cents || 0);
  if (delta <= 0) return null;
  const lines = pay.invoice_id ? await invoiceLines(admin, pay.org_id, pay.invoice_id) : [];
  const plan = planRefund(lines, delta);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const stripe = plan.reversals.length ? stripeClient() : null;
  for (const r of plan.reversals) {
    const line = byId.get(r.lineId)!;
    const newReversed = Number(line.reversed_cents || 0) + r.cents;
    const reversal = await stripe!.transfers.createReversal(
      r.transferId,
      { amount: r.cents, metadata: { kind: 'job_line_refund', line_id: r.lineId, payment_id: pay.id } },
      // Keyed on the cumulative target so a replay never reverses twice.
      { idempotencyKey: `atm-line-reversal-${r.lineId}-${newReversed}` },
    );
    const { error: e } = await admin
      .from('job_invoice_lines')
      .update({ reversed_cents: newReversed, stripe_reversal_id: reversal.id, ...(r.fully ? { release_status: 'reversed' } : {}) })
      .eq('id', r.lineId)
      .eq('org_id', pay.org_id);
    if (e) throw new Error(`line ${r.lineId} reversal write failed after ${reversal.id}: ${e.message}`);
  }
  for (const h of plan.fromHeld) {
    const line = byId.get(h.lineId)!;
    const { error: e } = await admin
      .from('job_invoice_lines')
      .update({ refunded_cents: Number(line.refunded_cents || 0) + h.cents, ...(h.fully ? { release_status: 'refunded' } : {}) })
      .eq('id', h.lineId)
      .eq('org_id', pay.org_id);
    if (e) throw new Error(`line ${h.lineId} refund write failed: ${e.message}`);
  }
  if (plan.unallocatedCents) logger.warn('job_refund_unallocated', { paymentId: pay.id, cents: plan.unallocatedCents });
  const total = Number(pay.refunded_cents || 0) + delta;
  const { error: pe } = await admin
    .from('job_payments')
    .update({ refunded_cents: total, status: refundedStatus(Number(pay.amount_cents), total, pay.status), updated_at: new Date().toISOString() })
    .eq('id', pay.id)
    .eq('org_id', pay.org_id);
  if (pe) throw new Error(`job payment ${pay.id} refund write failed: ${pe.message}`);
  return plan;
}

/** Owner/admin refund from the job file. amountCents omitted = refund what is left. */
export async function refundJobPayment(
  admin: any,
  orgId: string,
  paymentId: string,
  opts: { amountCents?: number; actorId: string; reason?: string },
): Promise<{ refundId: string; plan: RefundPlan | null }> {
  const { data: pay } = await admin
    .from('job_payments')
    .select('id, org_id, amount_cents, refunded_cents, status, stripe_payment_intent_id')
    .eq('id', paymentId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!pay) throw new HttpError(404, 'No such payment.', 'not_found');
  if (!['paid', 'partially_refunded'].includes(pay.status)) {
    throw new HttpError(409, pay.status === 'disputed' ? 'This payment is disputed. Stripe handles the money until the dispute closes.' : 'Only paid payments can be refunded.', 'not_refundable');
  }
  const left = Number(pay.amount_cents) - Number(pay.refunded_cents || 0);
  const amount = Math.floor(opts.amountCents ?? left);
  if (!(amount > 0) || amount > left) throw new HttpError(400, `Refund must be between $0.01 and $${(left / 100).toFixed(2)}.`, 'bad_refund_amount');
  if (!pay.stripe_payment_intent_id) throw new HttpError(409, 'The payment has not settled yet.', 'charge_pending');
  const target = Number(pay.refunded_cents || 0) + amount;
  const refund = await stripeClient().refunds.create(
    {
      payment_intent: pay.stripe_payment_intent_id,
      amount,
      reason: 'requested_by_customer',
      metadata: { kind: 'job_payment_refund', payment_id: pay.id, org_id: orgId, actor_id: opts.actorId, note: (opts.reason ?? '').slice(0, 200) },
    },
    { idempotencyKey: `atm-job-refund-${pay.id}-${target}` },
  );
  const plan = await allocateRefund(admin, pay.id, target);
  return { refundId: refund.id, plan };
}

/* ------------------------------------------------------------- disputes */

export function disputeOutcome(dispute: { status: string }): 'open' | 'won' | 'lost' {
  if (dispute.status === 'won' || dispute.status === 'warning_closed') return 'won';
  if (dispute.status === 'lost') return 'lost';
  return 'open';
}

/**
 * charge.dispute.*: freeze unreleased lines (no release while disputed) and
 * flag released ones. With PAYMENTS_DISPUTE_REVERSE_RELEASED=1, released
 * lines are reversed at dispute open so the platform is not out of pocket.
 * Won: frozen lines go back to held and are re-verified. Lost: frozen lines
 * become refunded (the money went back to the cardholder).
 */
export async function applyJobPaymentDispute(admin: any, dispute: any, env: NodeJS.Dict<string> = process.env): Promise<boolean> {
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  const charge = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  let q = admin.from('job_payments').select('id, org_id, invoice_id, amount_cents, status, refunded_cents');
  q = pi ? q.eq('stripe_payment_intent_id', pi) : q.eq('stripe_charge_id', charge);
  const { data: pay } = await q.maybeSingle();
  if (!pay) return false;
  const outcome = disputeOutcome(dispute);
  const now = new Date().toISOString();
  const lines = pay.invoice_id ? await invoiceLines(admin, pay.org_id, pay.invoice_id) : [];
  const unreleased = lines.filter((l) => ['held', 'verified', 'unpaid', 'frozen'].includes(l.release_status)).map((l) => l.id);
  const released = lines.filter((l) => l.release_status === 'released').map((l) => l.id);

  let status = pay.status;
  if (outcome === 'open') {
    status = 'disputed';
    if (unreleased.length) await admin.from('job_invoice_lines').update({ release_status: 'frozen' }).eq('org_id', pay.org_id).in('id', unreleased).neq('release_status', 'unpaid');
    if (released.length) await admin.from('job_invoice_lines').update({ dispute_flag: true }).eq('org_id', pay.org_id).in('id', released);
    if (/^(1|true|yes)$/i.test(String(env.PAYMENTS_DISPUTE_REVERSE_RELEASED ?? ''))) {
      const stripe = stripeClient();
      for (const l of lines.filter((x) => x.release_status === 'released' && x.stripe_transfer_id)) {
        const cents = Number(l.release_cents ?? l.amount_cents) - Number(l.reversed_cents || 0);
        if (cents <= 0) continue;
        const rev = await stripe.transfers.createReversal(String(l.stripe_transfer_id), { amount: cents, metadata: { kind: 'job_line_dispute', line_id: l.id } }, { idempotencyKey: `atm-line-dispute-${l.id}-${dispute.id}` });
        await admin.from('job_invoice_lines').update({ release_status: 'reversed', reversed_cents: Number(l.reversed_cents || 0) + cents, stripe_reversal_id: rev.id }).eq('id', l.id).eq('org_id', pay.org_id);
      }
    }
  } else if (outcome === 'won') {
    status = Number(pay.refunded_cents || 0) > 0 ? 'partially_refunded' : 'paid';
    await admin.from('job_invoice_lines').update({ release_status: 'held' }).eq('org_id', pay.org_id).eq('invoice_id', pay.invoice_id).eq('release_status', 'frozen');
    await admin.from('job_invoice_lines').update({ dispute_flag: false }).eq('org_id', pay.org_id).eq('invoice_id', pay.invoice_id);
  } else {
    status = 'dispute_lost';
    await admin.from('job_invoice_lines').update({ release_status: 'refunded' }).eq('org_id', pay.org_id).eq('invoice_id', pay.invoice_id).eq('release_status', 'frozen');
  }
  const { error } = await admin
    .from('job_payments')
    .update({ status, stripe_dispute_id: dispute.id, dispute_status: dispute.status, disputed_at: outcome === 'open' ? now : undefined, updated_at: now })
    .eq('id', pay.id)
    .eq('org_id', pay.org_id);
  if (error) throw new Error(`job payment ${pay.id} dispute write failed: ${error.message}`);
  if (outcome === 'won' && pay.invoice_id) await verifyInvoiceLines(admin, pay.org_id, pay.invoice_id);
  logger.warn('job_payment_dispute', { paymentId: pay.id, disputeStatus: dispute.status, frozen: unreleased.length, flagged: released.length });
  return true;
}

/* ---------------------------------------------------------- stale holds */

export type SweepConfig = { alertDays: number; autoRefundDays: number };

export function sweepConfigFromEnv(env: NodeJS.Dict<string> = process.env): SweepConfig {
  const n = (v: string | undefined, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
  return { alertDays: n(env.PAYMENTS_HELD_ALERT_DAYS, 30), autoRefundDays: n(env.PAYMENTS_HELD_AUTO_REFUND_DAYS, 0) };
}

/** Pure: what to do with one held line. autoRefundDays 0 = never auto-refund. */
export function staleHoldAction(heldAt: string | null, alerted: boolean, cfg: SweepConfig, now = new Date()): 'none' | 'alert' | 'refund' {
  if (!heldAt) return 'none';
  const days = (now.getTime() - Date.parse(heldAt)) / 86_400_000;
  if (cfg.autoRefundDays > 0 && days >= cfg.autoRefundDays) return 'refund';
  if (cfg.alertDays > 0 && days >= cfg.alertDays && !alerted) return 'alert';
  return 'none';
}

export async function sweepStaleHolds(admin: any, cfg = sweepConfigFromEnv(), now = new Date()): Promise<{ alerted: number; refunded: number }> {
  const { data, error } = await admin
    .from('job_invoice_lines')
    .select('id, org_id, job_id, invoice_id, amount_cents, refunded_cents, held_at, held_alerted_at, release_status')
    .in('release_status', ['held', 'verified'])
    .not('held_at', 'is', null)
    .order('held_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`stale hold sweep load failed: ${error.message}`);
  let alerted = 0;
  let refunded = 0;
  for (const l of (data ?? []) as any[]) {
    const action = staleHoldAction(l.held_at, Boolean(l.held_alerted_at), cfg, now);
    if (action === 'alert') {
      logger.warn('job_payment_held_stale', { orgId: l.org_id, jobId: l.job_id, lineId: l.id, heldAt: l.held_at });
      await admin.from('job_invoice_lines').update({ held_alerted_at: now.toISOString() }).eq('id', l.id).eq('org_id', l.org_id);
      alerted += 1;
    } else if (action === 'refund') {
      const { data: pay } = await admin
        .from('job_payments')
        .select('id')
        .eq('org_id', l.org_id)
        .eq('invoice_id', l.invoice_id)
        .in('status', ['paid', 'partially_refunded'])
        .order('paid_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pay) continue;
      const cents = Number(l.amount_cents) - Number(l.refunded_cents || 0);
      if (cents <= 0) continue;
      try {
        await refundJobPayment(admin, l.org_id, pay.id, { amountCents: cents, actorId: 'system:stale-hold-sweep', reason: 'Held too long without release' });
        refunded += 1;
      } catch (err) {
        logger.warn('job_payment_stale_refund_failed', { lineId: l.id, detail: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { alerted, refunded };
}
