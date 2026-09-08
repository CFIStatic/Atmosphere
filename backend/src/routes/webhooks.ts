import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { config } from '../config.js';
import { persistExtraFcSeats } from '../lib/fieldCaptureSeats.js';
import {
  adminClient,
  atmospherePlanCodeForPriceId,
  cardDetails,
  extraSeatQuantityFromSubscription,
  invoiceChargeId,
  isConfiguredOnboardingPrice,
  isExtraSeatPriceId,
  mapSubscriptionStatus,
  shouldCancelOrgBillingForDeletedSubscription,
  meteringPlanForPrice,
  planForPrice,
  resolveOrgId,
  stripeClient,
  subscriptionItemPriceId,
  syncExtraFcSeatsFromCustomer,
  syncMeteringSubscription,
  toIso,
} from '../lib/stripe.js';
import {
  atmospherePlan,
  includedFcSeatsFromMetadata,
  parseAtmospherePlanCode,
} from '../lib/stripeCatalog.js';
import { ingestMention, verifyMentionSignature } from '../pm/orchestration/messaging.js';
import { mentionWebhookSchema } from '../pm/validation.js';
import {
  claimStripeEvent,
  releaseStripeEventClaim,
  requireAttributedOrg,
  requireCreditPurchaseId,
} from '../lib/stripeWebhook.js';
import { invoiceWebhookRecord, invoiceWebhookShouldApply } from '../lib/stripeInvoices.js';

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

  const admin = adminClient();
  let claimed = false;
  try {
    // Claim the event id. A replay returns false and we stop here.
    const isFirst = await claimStripeEvent(admin, event);

    if (!isFirst) {
      res.json({ received: true, duplicate: true });
      return;
    }
    claimed = true;

    await handleEvent(event, admin);
    res.json({ received: true });
  } catch (err) {
    // Release the claim so Stripe's retry is not treated as a duplicate.
    // 500 so Stripe retries — better a duplicate delivery than a lost payment.
    if (claimed) await releaseStripeEventClaim(admin, event.id);
    console.error(`[stripe] handler failed for ${event.type} (${event.id}):`, err);
    res.status(500).json({ error: 'Webhook handler failed', code: 'webhook_failed' });
  }
});

async function handleEvent(event: Stripe.Event, admin: any): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, admin);
      break;

    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await onInvoice(event.data.object as Stripe.Invoice, admin, event.type);
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
  const orgId = requireAttributedOrg(
    await resolveOrgId(admin, session.metadata, session.customer as string | null),
    `checkout ${session.id}`,
  );

  if (session.mode !== 'payment') return; // subscriptions settle via invoice.paid

  const purchaseId = requireCreditPurchaseId(session.mode, session.metadata?.purchase_id);
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

/** Subscription and same-day usage invoices: the receipt trail. */
async function onInvoice(invoice: Stripe.Invoice, admin: any, eventType: string): Promise<void> {
  const orgId = requireAttributedOrg(
    await resolveOrgId(admin, invoice.metadata, invoice.customer as string | null),
    `invoice ${invoice.id}`,
  );

  const line = invoice.lines?.data?.[0] as any;
  const chargeId = invoiceChargeId(invoice);
  const record = invoiceWebhookRecord(eventType, invoice);

  if (record.status === 'pending' && invoice.id) {
    const { data: existing } = await admin
      .from('payments')
      .select('status')
      .eq('stripe_invoice_id', invoice.id)
      .maybeSingle();
    if (!invoiceWebhookShouldApply(record, existing?.status)) {
      return;
    }
  }

  let charge: Stripe.Charge | null = null;
  if (chargeId) {
    charge = await stripeClient().charges.retrieve(chargeId);
  }
  const card = cardDetails(charge);

  const { error } = await admin.rpc('record_payment', {
    p_org: orgId,
    p_kind: 'subscription',
    p_status: record.status,
    p_amount_cents: record.paid ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? invoice.total ?? 0),
    p_currency: invoice.currency ?? 'usd',
    p_description: line?.description ?? invoice.description ?? 'Subscription',
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
    p_failure_reason: record.status === 'failed' ? 'Payment failed' : null,
  });
  if (error) throw new Error(`invoice record failed: ${error.message}`);

  if (record.status === 'failed') {
    // Leave the plan in place but flag it; Stripe will retry the charge and
    // send customer.subscription.deleted if it ultimately gives up.
    await admin.from('org_billing').update({ status: 'past_due' }).eq('org_id', orgId);
  }
}

/** Stripe is the source of truth for what a customer is paying for. */
async function onSubscriptionChanged(sub: Stripe.Subscription, admin: any): Promise<void> {
  const orgId = requireAttributedOrg(
    await resolveOrgId(admin, sub.metadata, sub.customer as string | null),
    `subscription ${sub.id}`,
  );

  const items = sub.items?.data ?? [];
  const item = items[0] as any;
  const priceId = subscriptionItemPriceId(item);
  // Period boundaries moved from the subscription onto its items in recent API
  // versions; read whichever the account's version provides.
  const periodStart = toIso(item?.current_period_start ?? (sub as any).current_period_start);
  const periodEnd = toIso(item?.current_period_end ?? (sub as any).current_period_end);

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const extraOnThisSub = extraSeatQuantityFromSubscription(sub);
  try {
    await syncExtraFcSeatsFromCustomer(admin, orgId, customerId);
  } catch (err) {
    if (extraOnThisSub > 0 || items.some((row) => isExtraSeatPriceId(subscriptionItemPriceId(row)))) {
      await persistExtraFcSeats(admin, orgId, extraOnThisSub);
    } else {
      throw err;
    }
  }

  for (const row of items) {
    const rowPriceId = subscriptionItemPriceId(row);
    const plan = await planForPrice(admin, rowPriceId);
    if (plan) {
      const { error } = await admin.rpc('stripe_sync_subscription', {
        p_org: orgId,
        p_plan: plan.code,
        p_interval: plan.interval,
        p_seats: row.quantity ?? 1,
        p_subscription_id: sub.id,
        p_status: mapSubscriptionStatus(sub.status),
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      });
      if (error) throw new Error(`subscription sync failed: ${error.message}`);
      return;
    }
  }

  // Signup Checkout uses metering_plan_versions.stripe_price_id (or
  // STRIPE_ONBOARDING_PRICE_ID), which is not in billing_plans. Still mark the
  // org subscribed so the onboarding step can complete.
  let metering = priceId ? await meteringPlanForPrice(admin, priceId) : null;
  let meteringPriceId = priceId;
  if (!metering) {
    for (const row of items) {
      const rowPriceId = subscriptionItemPriceId(row);
      if (!rowPriceId) continue;
      metering = await meteringPlanForPrice(admin, rowPriceId);
      if (metering) {
        meteringPriceId = rowPriceId;
        break;
      }
    }
  }
  const isOnboarding =
    sub.metadata?.onboarding === 'true' ||
    isConfiguredOnboardingPrice(meteringPriceId) ||
    items.some((row) => isConfiguredOnboardingPrice(subscriptionItemPriceId(row)));
  if (metering || isOnboarding) {
    const fromMeta = sub.metadata?.atmosphere_plan_code;
    const fromPrice =
      atmospherePlanCodeForPriceId(meteringPriceId) ??
      items
        .map((row) => atmospherePlanCodeForPriceId(subscriptionItemPriceId(row)))
        .find(Boolean) ??
      (metering?.code && metering.code !== 'field_capture_extra_seat' ? metering.code : null);
    const plan = atmospherePlan(parseAtmospherePlanCode(fromMeta ?? fromPrice));
    const includedFromMeta = includedFcSeatsFromMetadata(
      sub.metadata,
      ...items.map((row) => {
        const price = row.price;
        return typeof price === 'object' && price ? price.metadata : null;
      }),
    );
    await syncMeteringSubscription(admin, orgId, {
      subscriptionId: sub.id,
      status: sub.status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      planCode: plan.code,
      includedFcSeats: includedFromMeta ?? plan.includedFcSeats,
    });
    return;
  }

  if (items.some((row) => isExtraSeatPriceId(subscriptionItemPriceId(row)))) {
    return;
  }

  throw new Error(`[stripe] price ${priceId ?? 'unknown'} is not mapped to a plan`);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, admin: any): Promise<void> {
  const orgId = requireAttributedOrg(
    await resolveOrgId(admin, sub.metadata, sub.customer as string | null),
    `subscription ${sub.id}`,
  );
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const { data: billing } = await admin
    .from('org_billing')
    .select('stripe_subscription_id')
    .eq('org_id', orgId)
    .maybeSingle();

  if (
    !shouldCancelOrgBillingForDeletedSubscription({
      deletedSubscriptionId: sub.id,
      storedSubscriptionId: (billing?.stripe_subscription_id as string | undefined) ?? null,
      subscription: sub,
    })
  ) {
    await syncExtraFcSeatsFromCustomer(admin, orgId, customerId);
    return;
  }

  const { error } = await admin.rpc('stripe_cancel_subscription', { p_org: orgId });
  if (error) throw new Error(`subscription cancel failed: ${error.message}`);
  await persistExtraFcSeats(admin, orgId, 0);
}

/**
 * A refund is recorded as its own history row rather than mutating the original
 * payment, so the customer's history shows both the charge and the money back.
 * Credits already spent are deliberately not clawed back automatically.
 */
async function onChargeRefunded(charge: Stripe.Charge, admin: any): Promise<void> {
  const orgId = requireAttributedOrg(
    await resolveOrgId(admin, charge.metadata, charge.customer as string | null),
    `charge ${charge.id}`,
  );

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

/**
 * @atmosphere mention intake — iMessage / WhatsApp / Signal / SMS bridges.
 *
 * Authenticated by HMAC over the raw body (header `X-Atmosphere-Signature:
 * sha256=<hex>`), never by a user session. Writes go through the service-role
 * client because a text message has no JWT; org scoping comes from the signed
 * payload's orgId, which the bridge is entrusted to set correctly for the
 * tenant it serves.
 */
webhookRouter.post('/atmosphere-mention', async (req: Request, res: Response) => {
  if (!config.pm.mentionWebhookSecret) {
    console.error('[mention] webhook received but ATMOSPHERE_MENTION_WEBHOOK_SECRET is not set');
    res.status(503).json({ error: 'Webhook not configured', code: 'webhook_unconfigured' });
    return;
  }

  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

  const signature =
    (req.headers['x-atmosphere-signature'] as string | undefined) ||
    (req.headers['x-hub-signature-256'] as string | undefined);

  if (!verifyMentionSignature(raw, signature, config.pm.mentionWebhookSecret)) {
    res.status(401).json({ error: 'Invalid signature', code: 'invalid_signature' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON', code: 'invalid_json' });
    return;
  }

  const payload = mentionWebhookSchema.safeParse(parsed);
  if (!payload.success) {
    res.status(400).json({
      error: 'Invalid payload',
      code: 'invalid_payload',
      details: payload.error.flatten(),
    });
    return;
  }

  try {
    const admin = adminClient();
    const result = await ingestMention(admin, payload.data);
    res.json({
      received: true,
      duplicate: result.duplicate,
      communicationId: result.communication.id,
      projectId: result.matchedProjectId,
      approvalId: result.approvalId,
    });
  } catch (err) {
    console.error('[mention] handler failed:', err);
    res.status(500).json({ error: 'Webhook handler failed', code: 'webhook_failed' });
  }
});
