/**
 * Contractor payments: pure rules (no I/O), shared by the routes and tests.
 *
 * Money model (Stripe Connect):
 *  - Each workspace onboards one connected account with the Express dashboard.
 *    Atmosphere owns pricing (fees_collector "application") and negative
 *    balance liability (losses_collector "application").
 *  - Homeowner payments are destination charges via Stripe Checkout:
 *    on_behalf_of + transfer_data.destination = the contractor's account, and
 *    Atmosphere keeps application_fee_amount = PAYMENTS_APPLICATION_FEE_BPS of
 *    the charge (basis points; 300 = 3.00%), plus an optional flat fee.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import type { HomeownerPermissions } from '../shared/homeownerPermissions.js';

export const DEFAULT_APPLICATION_FEE_BPS = 300;
export const MAX_APPLICATION_FEE_BPS = 2000;
export const MIN_CHARGE_CENTS = 100;
export const MAX_CHARGE_CENTS = 10_000_000; // $100,000

export type FeeConfig = { bps: number; flatCents: number };

export function feeConfigFromEnv(env: NodeJS.Dict<string> = process.env): FeeConfig {
  const bpsRaw = Number(env.PAYMENTS_APPLICATION_FEE_BPS ?? DEFAULT_APPLICATION_FEE_BPS);
  const flatRaw = Number(env.PAYMENTS_APPLICATION_FEE_FLAT_CENTS ?? 0);
  const bps = Number.isFinite(bpsRaw) ? Math.min(Math.max(Math.round(bpsRaw), 0), MAX_APPLICATION_FEE_BPS) : DEFAULT_APPLICATION_FEE_BPS;
  const flatCents = Number.isFinite(flatRaw) ? Math.max(Math.round(flatRaw), 0) : 0;
  return { bps, flatCents };
}

/** Atmosphere's cut of one charge, never more than the charge itself. */
export function applicationFeeCents(amountCents: number, fee: FeeConfig): number {
  const pct = Math.round((amountCents * fee.bps) / 10_000);
  return Math.min(Math.max(pct + fee.flatCents, 0), amountCents);
}

/**
 * Payments is off unless PAYMENTS_CONNECT_ENABLED=1, and a live Stripe key is
 * refused anywhere except production (staging and local must use sk_test_).
 */
export type PaymentsGate = { enabled: boolean; reason?: 'disabled' | 'live_key_outside_production' | 'no_key' };

export function paymentsGate(
  secretKey: string,
  env: NodeJS.Dict<string> = process.env,
): PaymentsGate {
  if (!/^(1|true|yes)$/i.test(String(env.PAYMENTS_CONNECT_ENABLED ?? ''))) return { enabled: false, reason: 'disabled' };
  if (!secretKey) return { enabled: false, reason: 'no_key' };
  const production = (env.NODE_ENV ?? 'development') === 'production' && !/staging/i.test(String(env.APP_ENV ?? env.RAILWAY_ENVIRONMENT_NAME ?? ''));
  if (/^(sk|rk)_live_/.test(secretKey) && !production) return { enabled: false, reason: 'live_key_outside_production' };
  return { enabled: true };
}

export function assertPaymentsEnabled(gate: PaymentsGate): void {
  if (gate.enabled) return;
  const message =
    gate.reason === 'live_key_outside_production'
      ? 'Payments are off here: this server has a live Stripe key outside production.'
      : 'Payments are not turned on for this server yet.';
  throw new HttpError(503, message, 'payments_unavailable');
}

/** Owner and admin create, edit and send invoices; members view; viewers read only. */
export type PermissionRole = 'owner' | 'admin' | 'member' | 'viewer';
export function mayManageInvoices(role: PermissionRole | string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
export function assertMayManageInvoices(role: PermissionRole | string | null | undefined): void {
  if (!mayManageInvoices(role)) {
    throw new HttpError(403, 'Only the owner or an admin can create or send invoices.', 'invoice_admin_only');
  }
}

export type Evidence = { proofId: string; atSeconds: number | null; quote: string | null };
export type LineInput = { description: string; quantity: number; unitCents: number; evidence: Evidence[] };

export function lineAmountCents(quantity: number, unitCents: number): number {
  return Math.round(quantity * unitCents);
}

export function invoiceTotalCents(lines: Array<Pick<LineInput, 'quantity' | 'unitCents'>>): number {
  return lines.reduce((sum, l) => sum + lineAmountCents(l.quantity, l.unitCents), 0);
}

export function assertChargeable(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < MIN_CHARGE_CENTS || amountCents > MAX_CHARGE_CENTS) {
    throw new HttpError(400, 'Amount must be between $1.00 and $100,000.', 'invalid_amount');
  }
}

/** Evidence must point at clips on this job. */
export function assertEvidenceOnJob(lines: LineInput[], jobProofIds: Set<string>): void {
  for (const line of lines) {
    for (const ev of line.evidence) {
      if (!jobProofIds.has(ev.proofId)) {
        throw new HttpError(400, 'Evidence must link a video on this job.', 'evidence_not_on_job');
      }
    }
  }
}

export type InvoiceRow = {
  id: string;
  job_id: string;
  number: number;
  title: string;
  kind: string;
  status: string;
  currency: string;
  total_cents: number;
  homeowner_note: string | null;
  internal_note: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
};
export type LineRow = {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity: number | string;
  unit_cents: number;
  amount_cents: number;
  evidence: unknown;
};
export type ProofInfo = { id: string; title: string | null; capturedAt: string | null };

function normEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object' && typeof (e as any).proofId === 'string')
    .map((e: any) => ({
      proofId: String(e.proofId),
      atSeconds: Number.isFinite(Number(e.atSeconds)) && e.atSeconds !== null ? Number(e.atSeconds) : null,
      quote: typeof e.quote === 'string' && e.quote.trim() ? e.quote.trim() : null,
    }));
}

/** Office view: everything, evidence enriched with clip titles. */
export function presentInvoice(inv: InvoiceRow, lines: LineRow[], proofs: Map<string, ProofInfo>, feeCents?: number) {
  return {
    id: inv.id,
    jobId: inv.job_id,
    number: inv.number,
    title: inv.title,
    kind: inv.kind,
    status: inv.status,
    currency: inv.currency,
    totalCents: Number(inv.total_cents),
    homeownerNote: inv.homeowner_note,
    internalNote: inv.internal_note,
    sentAt: inv.sent_at,
    paidAt: inv.paid_at,
    createdAt: inv.created_at,
    ...(feeCents !== undefined ? { applicationFeeCents: feeCents } : {}),
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        unitCents: Number(l.unit_cents),
        amountCents: Number(l.amount_cents),
        evidence: normEvidence(l.evidence).map((e) => ({
          ...e,
          clipTitle: proofs.get(e.proofId)?.title ?? null,
          capturedAt: proofs.get(e.proofId)?.capturedAt ?? null,
        })),
      })),
  };
}

export type OfficeInvoice = ReturnType<typeof presentInvoice>;

/**
 * Homeowner view (server-side): drafts and voided invoices never appear; the
 * internal note and Atmosphere's fee are removed; evidence pointing at clips
 * the homeowner may not see (videos off, not shared yet, held) is dropped,
 * and transcript quotes are dropped when transcripts are off.
 */
export function homeownerInvoice(
  inv: OfficeInvoice,
  perms: HomeownerPermissions | null | undefined,
  hiddenProofIds: Set<string>,
) {
  const seeVideos = perms ? perms.seeVideos : true;
  const seeQuotes = perms ? perms.seeTranscripts : true;
  const { internalNote: _internal, applicationFeeCents: _fee, ...rest } = inv as OfficeInvoice & { applicationFeeCents?: number };
  return {
    ...rest,
    lines: inv.lines.map((l) => ({
      ...l,
      evidence: seeVideos
        ? l.evidence
            .filter((e) => !hiddenProofIds.has(e.proofId))
            .map((e) => (seeQuotes ? e : { ...e, quote: null }))
        : [],
    })),
  };
}

export function homeownerVisibleInvoice(status: string): boolean {
  return status === 'sent' || status === 'paid';
}

/** Map a Checkout session to our payment status. */
export function paymentStatusFromSession(session: { status?: string | null; payment_status?: string | null }): 'pending' | 'processing' | 'paid' | 'expired' {
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') return 'paid';
  if (session.status === 'expired') return 'expired';
  if (session.status === 'complete') return 'processing'; // ACH: completed, funds pending
  return 'pending';
}
