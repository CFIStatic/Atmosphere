import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from '../config.js';
import type { MeteringPeriodCalculation } from '../metering/types.js';
import { isStripeConfigured, stripeClient, stripeIdempotencyKey } from './stripe.js';

export interface OverageInvoiceLine {
  amountCents: number;
  description: string;
}

/** Usage beyond the included Work Verification allowance — not the $599 base fee. */
export function overageInvoiceLines(summary: MeteringPeriodCalculation): OverageInvoiceLine[] {
  const lines: OverageInvoiceLine[] = [];
  if (summary.jobOverageChargeCents > 0) {
    const extra = summary.excessJobs;
    lines.push({
      amountCents: summary.jobOverageChargeCents,
      description:
        extra === 1
          ? `1 additional job beyond ${summary.includedJobs} included`
          : `${extra} additional jobs beyond ${summary.includedJobs} included`,
    });
  }
  if (summary.computeOverageChargeCents > 0) {
    lines.push({
      amountCents: summary.computeOverageChargeCents,
      description: 'Additional compute beyond the included allowance',
    });
  }
  if (summary.videoProcessingChargeCents > 0) {
    lines.push({
      amountCents: summary.videoProcessingChargeCents,
      description: 'Video verification processing',
    });
  }
  return lines;
}

export function isOverageInvoiceForPeriod(
  invoice: { metadata?: Stripe.Metadata | null },
  orgId: string,
  periodStart: string,
): boolean {
  return (
    invoice.metadata?.org_id === orgId &&
    invoice.metadata?.kind === 'metering_overage' &&
    invoice.metadata?.period_start === periodStart
  );
}

/** Paid / open / voided invoices must not be charged again for the same period. */
export function overageInvoiceAlreadyIssued(status: string | null | undefined): boolean {
  return status === 'open' || status === 'paid' || status === 'uncollectible' || status === 'void';
}

async function findExistingOverageInvoice(
  stripe: Stripe,
  customerId: string,
  orgId: string,
  periodStart: string,
): Promise<Stripe.Invoice | null> {
  let startingAfter: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const batch = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const match = batch.data.find((invoice) =>
      isOverageInvoiceForPeriod(invoice, orgId, periodStart),
    );
    if (match) return match;
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
  }
  return null;
}

/**
 * After a period close, invoice overage on the org's Stripe customer.
 * The $599 platform fee is the subscription — this is only extra jobs / compute.
 * Idempotent on org + period start so a retried close does not double-bill.
 */
export async function invoiceMeteringOverage(
  supabase: SupabaseClient,
  orgId: string,
  summary: MeteringPeriodCalculation,
  statementId?: string,
): Promise<{ invoiceId: string | null; skipped: string | null }> {
  if (config.billing.paymentProvider !== 'stripe' || !isStripeConfigured()) {
    return { invoiceId: null, skipped: 'stripe_unconfigured' };
  }

  const lines = overageInvoiceLines(summary);
  if (lines.length === 0) return { invoiceId: null, skipped: 'no_overage' };

  const { data: billing, error } = await supabase
    .from('org_billing')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`overage customer lookup failed: ${error.message}`);

  const customerId = billing?.stripe_customer_id as string | undefined;
  if (!customerId) return { invoiceId: null, skipped: 'no_customer' };

  const stripe = stripeClient();
  const existing = await findExistingOverageInvoice(stripe, customerId, orgId, summary.periodStart);
  if (existing && overageInvoiceAlreadyIssued(existing.status)) {
    return { invoiceId: existing.id, skipped: 'already_invoiced' };
  }

  const periodKey = stripeIdempotencyKey('metering-overage', orgId, summary.periodStart);
  const invoice =
    existing ??
    (await stripe.invoices.create(
      {
        customer: customerId,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        description: `Work Verification usage ${summary.periodStart} – ${summary.periodEnd}`,
        metadata: {
          org_id: orgId,
          kind: 'metering_overage',
          period_start: summary.periodStart,
          period_end: summary.periodEnd,
          ...(statementId ? { statement_id: statementId } : {}),
        },
      },
      { idempotencyKey: periodKey },
    ));

  if (overageInvoiceAlreadyIssued(invoice.status)) {
    return { invoiceId: invoice.id, skipped: 'already_invoiced' };
  }

  const existingLineCount = invoice.lines?.data?.length ?? 0;
  if (existingLineCount === 0) {
    for (const [index, line] of lines.entries()) {
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: invoice.id,
          currency: 'usd',
          amount: line.amountCents,
          description: line.description,
        },
        { idempotencyKey: stripeIdempotencyKey(periodKey, 'line', index) },
      );
    }
  }

  const finalized =
    invoice.status === 'draft' ? await stripe.invoices.finalizeInvoice(invoice.id) : invoice;
  if (finalized.status === 'open') {
    try {
      await stripe.invoices.pay(finalized.id);
    } catch (err) {
      // invoice.payment_failed records the attempt; the period is already closed.
      console.error(`[stripe] overage invoice ${finalized.id} could not be collected:`, err);
    }
  }
  return { invoiceId: finalized.id, skipped: null };
}
