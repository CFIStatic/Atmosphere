import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { config } from '../config.js';
import {
  adminClient,
  cardDetails,
  mapSubscriptionStatus,
  planForPrice,
  resolveOrgId,
  stripeClient,
  toIso,
} from '../lib/stripe.js';

export const webhookRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Stripe webhook — the only place credits are minted and subscriptions change.
 *
 * Three properties this handler must have:
 *
 *  - **Verified.** The raw body is checked against the signing secret. Without
 *    a secret configured we reject everything rather than trusting a payload
 *    from whoever can reach the URL.
 *  - **Idempotent.** Stripe retries on any non-2xx and guarantees at-least-once
 *    delivery, so every event arrives more than once eventually. The event id is
 *    recorded first and a replay returns 200 without re-applying anything.
 *  - **Honest about failure.** A handler that throws returns 500 so Stripe
 *    retries. Returning 200 on a failed write would silently lose a payment.
 */
webhookRouter.post('/stripe', async (req: Request, res: Response) => {
  if (!config.stripe.webhookSecret) {
    console.error('[stripe] webhook received but STRIPE_WEBHOOK_SECRET is not set');
    res.status(503).json({ error: 'Webhook not configured', code: 'webhook_unconfigured' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  let event: Stripe.Event;

  try {
    // req.body is a Buffer here — the raw-body parser is mounted for this path
    // specifically, because signature verification is over the exact bytes.
    event = stripeClient().webhooks.constructEvent(
      req.body as Buffer,
      signature as string,
      config.stripe.webhookSecret,
    );
  } catch (err) {
    console.warn('[stripe] signature verification failed:', (err as Error).message);
    res.status(400).json({ error: 'Invalid signature', code: 'invalid_signature' });
    return;
  }

  try {
    const admin = adminClient();

    // Claim the event id. A replay returns false and we stop here.
    const { data: isFirst, error: seenError } = await admin.rpc('stripe_event_seen', {
      p_event_id: event.id,
      p_type: event.type,
    });
    if (seenError) throw new Error(`event dedupe failed: ${seenError.message}`);

    if (!isFirst) {
      res.json({ received: true, duplicate: true });
      return;
    }

    await handleEvent(event, admin);
    res.json({ received: true });
  } catch (err) {
    // 500 so Stripe retries — better a duplicate delivery than a lost payment.
    console.error(`[stripe] handler failed for ${event.type} (${event.id}):`, err);
    res.status(500).json({ error: 'Webhook handler failed', code: 'webhook_failed' });
  }
});

async function handleEvent(event: Stripe.Event, admin: any): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, admin);
      break;

    case 'invoice.paid':
    case 'invoice.payment_failed':
      await onInvoice(event.data.object as Stripe.Invoice, admin, event.type === 'invoice.paid');
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionChanged(event.data.object as Stripe.Subscription, admin);
      break;

    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription, admin);
      break;

    case 'charge.refunded':
      await onChargeRefunded(event.data.object as Stripe.Charge, admin);
      break;

    default:
      // Everything else is subscribed-but-uninteresting; acknowledging keeps
      // Stripe from retrying it forever.
      break;
  }
}

/** A completed checkout: credits are granted here, against the purchase we opened. */
async function onCheckoutCompleted(session: Stripe.Checkout.Session, admin: any): Promise<void> {
  const orgId = await resolveOrgId(admin, session.metadata, session.customer as string | null);
  if (!orgId) {
    console.warn(`[stripe] checkout ${session.id} could not be attributed to an org`);
    return;
  }

  if (session.mode !== 'payment') return; // subscriptions settle via invoice.paid

  const purchaseId = session.metadata?.purchase_id;
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Credits first: a failure here must retry, so it happens before anything
  // that could swallow the error.
  if (purchaseId) {
    const { error } = await admin.rpc('complete_credit_purchase', {
      p_purchase_id: purchaseId,
      p_provider_ref: paymentIntentId ?? session.id,
    });
    if (error) throw new Error(`credit grant failed: ${error.message}`);
  }

  // Pull the charge so the history row carries a receipt link and card detail.
  let charge: Stripe.Charge | null = null;
  if (paymentIntentId) {
    const intent = await stripeClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    charge = (intent.latest_charge as Stripe.Charge) ?? null;
  }
  const card = cardDetails(charge);

  const { error: paymentError } = await admin.rpc('record_payment', {
    p_org: orgId,
    p_kind: 'credits',
    p_status: 'succeeded',
    p_amount_cents: session.amount_total ?? 0,
    p_currency: session.currency ?? 'usd',
    p_description: 'Usage credits',
    p_payment_intent_id: paymentIntentId,
    p_charge_id: charge?.id ?? null,
    p_receipt_url: charge?.receipt_url ?? null,
    p_receipt_email: session.customer_details?.email ?? charge?.receipt_email ?? null,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_purchase_id: purchaseId ?? null,
  });
  if (paymentError) throw new Error(`payment record failed: ${paymentError.message}`);
}

/** Subscription invoices: the receipt trail and the period roll-forward. */
async function onInvoice(invoice: Stripe.Invoice, admin: any, paid: boolean): Promise<void> {
  const orgId = await resolveOrgId(admin, invoice.metadata, invoice.customer as string | null);
  if (!orgId) return;

  const line = invoice.lines?.data?.[0] as any;
  const chargeId = (invoice as any).charge as string | null;

  let charge: Stripe.Charge | null = null;
  if (chargeId) {
    charge = await stripeClient().charges.retrieve(chargeId);
  }
  const card = cardDetails(charge);

  const { error } = await admin.rpc('record_payment', {
    p_org: orgId,
    p_kind: 'subscription',
    p_status: paid ? 'succeeded' : 'failed',
    p_amount_cents: paid ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0),
    p_currency: invoice.currency ?? 'usd',
    p_description: line?.description ?? 'Subscription',
    p_invoice_id: invoice.id,
    p_charge_id: chargeId,
    p_receipt_url: charge?.receipt_url ?? null,
    p_hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    p_invoice_pdf_url: invoice.invoice_pdf ?? null,
    p_receipt_email: invoice.customer_email ?? null,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_period_start: toIso(line?.period?.start),
    p_period_end: toIso(line?.period?.end),
    p_failure_reason: paid ? null : 'Payment failed',
  });
  if (error) throw new Error(`invoice record failed: ${error.message}`);

  if (!paid) {
    // Leave the plan in place but flag it; Stripe will retry the charge and
    // send customer.subscription.deleted if it ultimately gives up.
    await admin.from('org_billing').update({ status: 'past_due' }).eq('org_id', orgId);
  }
}

/** Stripe is the source of truth for what a customer is paying for. */
async function onSubscriptionChanged(sub: Stripe.Subscription, admin: any): Promise<void> {
  const orgId = await resolveOrgId(admin, sub.metadata, sub.customer as string | null);
  if (!orgId) return;

  const item = sub.items?.data?.[0] as any;
  const plan = await planForPrice(admin, item?.price?.id);
  if (!plan) {
    console.warn(`[stripe] price ${item?.price?.id} is not mapped to a plan; skipping sync`);
    return;
  }

  // Period boundaries moved from the subscription onto its items in recent API
  // versions; read whichever the account's version provides.
  const periodStart = toIso(item?.current_period_start ?? (sub as any).current_period_start);
  const periodEnd = toIso(item?.current_period_end ?? (sub as any).current_period_end);

  const { error } = await admin.rpc('stripe_sync_subscription', {
    p_org: orgId,
    p_plan: plan.code,
    p_interval: plan.interval,
    p_seats: item?.quantity ?? 1,
    p_subscription_id: sub.id,
    p_status: mapSubscriptionStatus(sub.status),
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw new Error(`subscription sync failed: ${error.message}`);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, admin: any): Promise<void> {
  const orgId = await resolveOrgId(admin, sub.metadata, sub.customer as string | null);
  if (!orgId) return;

  const { error } = await admin.rpc('stripe_cancel_subscription', { p_org: orgId });
  if (error) throw new Error(`subscription cancel failed: ${error.message}`);
}

/**
 * A refund is recorded as its own history row rather than mutating the original
 * payment, so the customer's history shows both the charge and the money back.
 * Credits already spent are deliberately not clawed back automatically.
 */
async function onChargeRefunded(charge: Stripe.Charge, admin: any): Promise<void> {
  const orgId = await resolveOrgId(admin, charge.metadata, charge.customer as string | null);
  if (!orgId) return;

  const card = cardDetails(charge);
  const { error } = await admin.rpc('record_payment', {
    p_org: orgId,
    p_kind: 'refund',
    p_status: 'refunded',
    p_amount_cents: -(charge.amount_refunded ?? 0),
    p_currency: charge.currency ?? 'usd',
    p_description: 'Refund',
    p_charge_id: `${charge.id}_refund`,
    p_receipt_url: charge.receipt_url ?? null,
    p_receipt_email: charge.receipt_email ?? null,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
  });
  if (error) throw new Error(`refund record failed: ${error.message}`);
}
