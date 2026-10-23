/**
 * Proof-based release (separate charges and transfers).
 *
 * The homeowner's payment lands on the platform balance. Each paid line is
 * "held" until the GC (owner/admin) confirms it; the AI pre-checks the line
 * against the job's existing video analysis and marks it "verified". Release
 * creates one Stripe Transfer per line (source_transaction = the charge, so
 * ACH funds transfer once they settle) with an idempotency key per line.
 * AI-only release is a company setting (org_payment_accounts.allow_ai_release),
 * default off.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import { stripeClient } from '../lib/stripe.js';
import {
  assertMayRelease,
  feeConfigFromEnv,
  lineReleaseCents,
  verifyLine,
  type ClipAnalysis,
  type Evidence,
} from './model.js';

const LINE_COLS = 'id, invoice_id, org_id, job_id, position, description, amount_cents, evidence, scope_item_id, release_status, held_at, released_at';

function evidenceOf(raw: unknown): Evidence[] {
  return Array.isArray(raw)
    ? raw.filter((e: any) => e && typeof e.proofId === 'string').map((e: any) => ({ proofId: e.proofId, atSeconds: e.atSeconds ?? null, quote: e.quote ?? null }))
    : [];
}

export async function clipAnalyses(admin: any, orgId: string, jobId: string): Promise<Map<string, ClipAnalysis>> {
  const { data } = await admin
    .from('job_proofs')
    .select('id, title, state, analysis_status, ai_summary, ai_findings, narration_text, transcript_text, labels')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null);
  const out = new Map<string, ClipAnalysis>();
  for (const p of (data ?? []) as any[]) {
    const text = [p.ai_summary, p.ai_findings ? JSON.stringify(p.ai_findings) : '', p.narration_text, p.transcript_text, (p.labels ?? []).join(' '), p.title]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    out.set(String(p.id), { id: String(p.id), title: p.title ?? null, analysisStatus: p.analysis_status ?? null, state: p.state ?? null, text });
  }
  return out;
}

async function scopeTitles(admin: any, orgId: string, jobId: string): Promise<Map<string, string>> {
  const { data } = await admin.from('job_scope_items').select('id, title').eq('org_id', orgId).eq('job_id', jobId);
  return new Map(((data ?? []) as any[]).map((s) => [String(s.id), String(s.title)]));
}

async function allowAiRelease(admin: any, orgId: string): Promise<boolean> {
  const { data } = await admin.from('org_payment_accounts').select('allow_ai_release').eq('org_id', orgId).maybeSingle();
  return Boolean((data as any)?.allow_ai_release);
}

/** Paid invoice: every unpaid line becomes held, then the AI checks them. */
export async function holdInvoiceLines(admin: any, orgId: string, invoiceId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('job_invoice_lines')
    .update({ release_status: 'held', held_at: now })
    .eq('org_id', orgId)
    .eq('invoice_id', invoiceId)
    .eq('release_status', 'unpaid');
  if (error) throw new Error(`invoice ${invoiceId} hold failed: ${error.message}`);
  await verifyInvoiceLines(admin, orgId, invoiceId);
}

/**
 * Run the AI check over held lines. A verified line moves to "verified"; a
 * line that no longer passes drops back to "held". Released lines are left
 * alone. With the company setting on, verified lines release automatically.
 */
export async function verifyInvoiceLines(admin: any, orgId: string, invoiceId: string, lineId?: string): Promise<void> {
  let q = admin.from('job_invoice_lines').select(LINE_COLS).eq('org_id', orgId).eq('invoice_id', invoiceId).in('release_status', ['held', 'verified']);
  if (lineId) q = q.eq('id', lineId);
  const { data: lines, error } = await q;
  if (error) throw new Error(`invoice ${invoiceId} lines load failed: ${error.message}`);
  if (!lines?.length) return;
  const jobId = String((lines as any[])[0].job_id);
  const [clips, scopes] = await Promise.all([clipAnalyses(admin, orgId, jobId), scopeTitles(admin, orgId, jobId)]);
  const verifiedIds: string[] = [];
  for (const l of lines as any[]) {
    const verdict = verifyLine({ description: l.description, evidence: evidenceOf(l.evidence) }, l.scope_item_id ? scopes.get(l.scope_item_id) ?? null : null, clips);
    const status = verdict.verified ? 'verified' : 'held';
    if (verdict.verified) verifiedIds.push(l.id);
    await admin
      .from('job_invoice_lines')
      .update({ release_status: status, ai_verdict: verdict, ai_verified_at: verdict.verified ? verdict.checkedAt : null })
      .eq('id', l.id)
      .eq('org_id', orgId)
      .neq('release_status', 'released');
  }
  if (verifiedIds.length && (await allowAiRelease(admin, orgId))) {
    for (const id of verifiedIds) await releaseLine(admin, orgId, id, { actorId: null, aiOnly: true });
  }
}

/** Transfer one held/verified line to the contractor's connected account. */
export async function releaseLine(
  admin: any,
  orgId: string,
  lineId: string,
  opts: { actorId: string | null; aiOnly: boolean },
): Promise<{ transferId: string; releasedCents: number }> {
  const { data: line } = await admin.from('job_invoice_lines').select(LINE_COLS).eq('id', lineId).eq('org_id', orgId).maybeSingle();
  if (!line) throw new HttpError(404, 'No such line.', 'not_found');
  assertMayRelease(line.release_status, { aiOnly: opts.aiOnly, allowAiRelease: opts.aiOnly ? await allowAiRelease(admin, orgId) : false });

  const { data: pay } = await admin
    .from('job_payments')
    .select('id, stripe_account_id, stripe_payment_intent_id, stripe_charge_id, transfer_group, status')
    .eq('org_id', orgId)
    .eq('invoice_id', line.invoice_id)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pay) throw new HttpError(409, 'No settled payment for this invoice.', 'line_not_held');

  const stripe = stripeClient();
  let chargeId: string | null = pay.stripe_charge_id ?? null;
  if (!chargeId && pay.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(pay.stripe_payment_intent_id);
    chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
    if (chargeId) await admin.from('job_payments').update({ stripe_charge_id: chargeId }).eq('id', pay.id).eq('org_id', orgId);
  }
  if (!chargeId) throw new HttpError(409, 'The payment has not settled yet.', 'charge_pending');

  // The flat fee (if any) comes off the first line released on the invoice.
  const { count } = await admin.from('job_invoice_lines').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('invoice_id', line.invoice_id).eq('release_status', 'released');
  const amount = lineReleaseCents(Number(line.amount_cents), feeConfigFromEnv(), !count);
  const transfer = await stripe.transfers.create(
    {
      amount,
      currency: 'usd',
      destination: pay.stripe_account_id,
      source_transaction: chargeId,
      transfer_group: pay.transfer_group ?? undefined,
      metadata: { kind: 'job_line_release', org_id: orgId, job_id: line.job_id, invoice_id: line.invoice_id, line_id: line.id },
    },
    { idempotencyKey: `atm-line-release-${line.id}` },
  );
  const now = new Date().toISOString();
  const { error } = await admin
    .from('job_invoice_lines')
    .update({
      release_status: 'released',
      released_at: now,
      released_by: opts.actorId,
      release_mode: opts.aiOnly ? 'ai_auto' : 'gc_confirmed',
      release_cents: amount,
      stripe_transfer_id: transfer.id,
    })
    .eq('id', line.id)
    .eq('org_id', orgId);
  if (error) throw new Error(`line ${line.id} release write failed after transfer ${transfer.id}: ${error.message}`);
  return { transferId: transfer.id, releasedCents: amount };
}
