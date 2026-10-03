/**
 * AI credit auto-recharge.
 *
 * Off by default. When an owner turns it on and the org runs out of AI
 * credits, the server buys one credit pack with the saved card using an
 * off-session PaymentIntent. Safety:
 *
 *  - The database starts each attempt (claim_ai_auto_recharge) under a row
 *    lock: on, nothing in flight, cooldown passed, 24-hour cap not reached.
 *  - The attempt id is the Stripe idempotency key, so a retry of the same
 *    attempt can never charge twice. Credits are granted against the
 *    PaymentIntent id, which is unique in the credit ledger, so the immediate
 *    grant and the webhook cannot both add credits.
 *  - Any failure turns auto-recharge off and stores a notice for the owner.
 *    They then buy credits manually.
 *
 * The pack amount comes from the existing credit-pack Stripe price
 * (STRIPE_AI_CREDIT_*_PRICE_ID). Nothing here creates Stripe objects.
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { badRequest, forbidden, HttpError } from '../lib/errors.js';
import {
  AI_CREDIT_PACKS,
  aiBudgetConfig,
  creditPackByCode,
  creditPackPriceId,
  type AiCreditPackCode,
} from './aiBudgetConfig.js';
import { creditNanosForPaymentCents } from './aiBudget.js';

export interface AutoRechargeLimits {
  cooldownSeconds: number;
  maxPerDay: number;
  staleSeconds: number;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/** Cooldown between attempts and a 24-hour cap. Both can only be tightened to zero via env, never removed. */
export function autoRechargeLimits(env: NodeJS.ProcessEnv = process.env): AutoRechargeLimits {
  return {
    cooldownSeconds: positiveInt(env.AI_AUTO_RECHARGE_COOLDOWN_MINUTES, 10, 24 * 60) * 60,
    maxPerDay: positiveInt(env.AI_AUTO_RECHARGE_MAX_PER_DAY, 3, 10),
    staleSeconds: 15 * 60,
  };
}

export interface AutoRechargeSettings {
  enabled: boolean;
  packCode: AiCreditPackCode;
  consentedAt: string | null;
  disabledReason: string | null;
  disabledAt: string | null;
  lastAttemptAt: string | null;
}

export interface AutoRechargeClaim {
  claimed: boolean;
  reason: string;
  rechargeId: string | null;
  idempotencyKey: string | null;
  packCode: string | null;
}

export interface AutoRechargeAttempt {
  id: string;
  at: string;
  status: 'pending' | 'succeeded' | 'failed';
  packCode: string;
  amountCents: number | null;
  failureMessage: string | null;
}

export interface FinishInput {
  status: 'succeeded' | 'failed';
  paymentIntentId?: string | null;
  chargeId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  creditNanos?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface PaymentRecordInput {
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  chargeId: string | null;
  receiptUrl: string | null;
  receiptEmail: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

export interface AutoRechargeStore {
  getSettings(orgId: string): Promise<AutoRechargeSettings | null>;
  saveSettings(
    orgId: string,
    input: { enabled: boolean; packCode: AiCreditPackCode; actorId: string | null; consentedAt: string | null },
  ): Promise<AutoRechargeSettings>;
  claim(orgId: string, limits: AutoRechargeLimits, trigger: string): Promise<AutoRechargeClaim>;
  finish(rechargeId: string, input: FinishInput): Promise<void>;
  stripeCustomerId(orgId: string): Promise<string | null>;
  grantCredits(orgId: string, input: { creditNanos: number; paymentIntentId: string; note: string }): Promise<{ applied: boolean }>;
  recordPayment(orgId: string, input: PaymentRecordInput): Promise<void>;
  recentAttempts(orgId: string, limit: number): Promise<AutoRechargeAttempt[]>;
}

export interface AutoRechargePrice {
  unitAmount: number | null;
  currency: string;
  active: boolean;
  oneTime: boolean;
}

export interface OffSessionPaymentInput {
  amount: number;
  currency: string;
  customer: string;
  paymentMethod: string;
  description: string;
  metadata: Record<string, string>;
}

export interface OffSessionPaymentResult {
  id: string;
  status: string;
  charge: {
    id: string | null;
    receiptUrl: string | null;
    receiptEmail: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
  } | null;
}

export interface AutoRechargeStripe {
  retrievePrice(priceId: string): Promise<AutoRechargePrice>;
  defaultPaymentMethod(customerId: string): Promise<string | null>;
  createOffSessionPayment(input: OffSessionPaymentInput, idempotencyKey: string): Promise<OffSessionPaymentResult>;
}

export type AutoRechargeOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'succeeded'; rechargeId: string; paymentIntentId: string; creditNanos: number }
  | { status: 'pending'; rechargeId: string; paymentIntentId: string | null; reason: string }
  | { status: 'failed'; rechargeId: string; code: string; message: string };

const MANUAL = 'Buy credits manually, then turn auto-recharge back on if you want it.';

export function autoRechargeFailureMessage(code: string | null | undefined): string {
  switch (code) {
    case 'authentication_required':
      return `Your bank asked to confirm the charge, so auto-recharge is off. ${MANUAL}`;
    case 'card_declined':
    case 'insufficient_funds':
    case 'expired_card':
    case 'incorrect_cvc':
    case 'processing_error':
      return `Your card was declined, so auto-recharge is off. ${MANUAL}`;
    case 'no_saved_card':
      return `There is no saved card to charge, so auto-recharge is off. ${MANUAL}`;
    case 'price_unavailable':
      return `Auto-recharge could not run, so it is off. ${MANUAL}`;
    default:
      return `The automatic charge did not go through, so auto-recharge is off. ${MANUAL}`;
  }
}

function stripeErrorCode(err: unknown): string {
  const e = err as { code?: string; decline_code?: string; raw?: { code?: string; decline_code?: string } } | null;
  return e?.decline_code ?? e?.raw?.decline_code ?? e?.code ?? e?.raw?.code ?? 'charge_failed';
}

function stripeErrorIntentId(err: unknown): string | null {
  const e = err as { payment_intent?: { id?: string }; raw?: { payment_intent?: { id?: string } } } | null;
  return e?.payment_intent?.id ?? e?.raw?.payment_intent?.id ?? null;
}

export interface AutoRechargeDeps {
  store: AutoRechargeStore;
  stripe: AutoRechargeStripe;
  env?: NodeJS.ProcessEnv;
  limits?: AutoRechargeLimits;
  log?: Pick<Console, 'warn' | 'error'>;
}

/**
 * Buy one pack if the org opted in and the database lets this attempt start.
 * Call only when the org is out of credits. Never throws for a payment
 * failure; the outcome says what happened.
 */
export async function runAutoRecharge(
  deps: AutoRechargeDeps,
  orgId: string,
  trigger: string,
): Promise<AutoRechargeOutcome> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console;
  const settings = await deps.store.getSettings(orgId);
  if (!settings?.enabled) return { status: 'skipped', reason: 'disabled' };

  const pack = creditPackByCode(settings.packCode);
  const priceId = pack ? creditPackPriceId(pack.code, env) : null;
  if (!pack || !priceId) return { status: 'skipped', reason: 'price_not_configured' };

  const claim = await deps.store.claim(orgId, deps.limits ?? autoRechargeLimits(env), trigger);
  if (!claim.claimed || !claim.rechargeId || !claim.idempotencyKey) {
    return { status: 'skipped', reason: claim.reason || 'not_claimed' };
  }
  const rechargeId = claim.rechargeId;

  const fail = async (code: string, paymentIntentId: string | null = null): Promise<AutoRechargeOutcome> => {
    const message = autoRechargeFailureMessage(code);
    await deps.store.finish(rechargeId, {
      status: 'failed',
      paymentIntentId,
      amountCents: pack.cents,
      currency: 'usd',
      failureCode: code,
      failureMessage: message,
    });
    return { status: 'failed', rechargeId, code, message };
  };

  let intent: OffSessionPaymentResult;
  let creditNanos: number;
  let amount: number;
  let currency: string;
  try {
    const customerId = await deps.store.stripeCustomerId(orgId);
    if (!customerId) return await fail('no_saved_card');

    const price = await deps.stripe.retrievePrice(priceId);
    // Fail closed if the Stripe price does not match the pack we show.
    if (!price.active || !price.oneTime || price.currency !== 'usd' || price.unitAmount !== pack.cents) {
      log.error(`[ai-auto-recharge] price ${priceId} for ${pack.code} does not match the pack; not charging org ${orgId}`);
      return await fail('price_unavailable');
    }
    amount = price.unitAmount;
    currency = price.currency;

    const paymentMethod = await deps.stripe.defaultPaymentMethod(customerId);
    if (!paymentMethod) return await fail('no_saved_card');

    creditNanos = creditNanosForPaymentCents(amount, aiBudgetConfig(env).creditUsdRatio);
    intent = await deps.stripe.createOffSessionPayment(
      {
        amount,
        currency,
        customer: customerId,
        paymentMethod,
        description: `AI credits ${pack.label} (auto-recharge)`,
        metadata: {
          org_id: orgId,
          kind: 'ai_credits',
          auto_recharge: 'true',
          recharge_id: rechargeId,
          pack_code: pack.code,
          pack_cents: String(pack.cents),
          credit_nanos: String(creditNanos),
          price_id: priceId,
        },
      },
      claim.idempotencyKey,
    );
  } catch (err) {
    log.warn(`[ai-auto-recharge] charge failed for org ${orgId}:`, (err as Error)?.message ?? err);
    return await fail(stripeErrorCode(err), stripeErrorIntentId(err));
  }

  if (intent.status !== 'succeeded') {
    if (intent.status === 'processing') {
      // The webhook finishes this attempt when Stripe settles it.
      return { status: 'pending', rechargeId, paymentIntentId: intent.id, reason: 'processing' };
    }
    const code = intent.status === 'requires_action' ? 'authentication_required' : 'charge_failed';
    return await fail(code, intent.id);
  }

  // The card was charged. From here a database error must not mark the
  // attempt failed: it stays pending and payment_intent.succeeded finishes it.
  try {
    await settleAutoRechargePayment(deps.store, orgId, {
      rechargeId,
      paymentIntentId: intent.id,
      amountCents: amount,
      currency,
      creditNanos,
      packLabel: pack.label,
      charge: intent.charge,
    });
  } catch (err) {
    log.error(`[ai-auto-recharge] charged ${intent.id} but could not record it yet; the webhook will retry`, err);
    return { status: 'pending', rechargeId, paymentIntentId: intent.id, reason: 'record_failed' };
  }
  return { status: 'succeeded', rechargeId, paymentIntentId: intent.id, creditNanos };
}

/** Grant, close the attempt, and add the receipt row. Safe to repeat for one PaymentIntent. */
export async function settleAutoRechargePayment(
  store: AutoRechargeStore,
  orgId: string,
  input: {
    rechargeId: string;
    paymentIntentId: string;
    amountCents: number;
    currency: string;
    creditNanos: number;
    packLabel: string;
    charge: OffSessionPaymentResult['charge'];
  },
): Promise<void> {
  await store.grantCredits(orgId, {
    creditNanos: input.creditNanos,
    paymentIntentId: input.paymentIntentId,
    note: `AI credits ${input.packLabel} auto-recharge (${input.amountCents} cents)`,
  });
  await store.finish(input.rechargeId, {
    status: 'succeeded',
    paymentIntentId: input.paymentIntentId,
    chargeId: input.charge?.id ?? null,
    amountCents: input.amountCents,
    currency: input.currency,
    creditNanos: input.creditNanos,
  });
  await store.recordPayment(orgId, {
    amountCents: input.amountCents,
    currency: input.currency,
    paymentIntentId: input.paymentIntentId,
    chargeId: input.charge?.id ?? null,
    receiptUrl: input.charge?.receiptUrl ?? null,
    receiptEmail: input.charge?.receiptEmail ?? null,
    cardBrand: input.charge?.cardBrand ?? null,
    cardLast4: input.charge?.cardLast4 ?? null,
  });
}

export function isAutoRechargeIntent(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.kind === 'ai_credits' && metadata?.auto_recharge === 'true' && Boolean(metadata?.recharge_id);
}

/** payment_intent.succeeded for an auto-recharge: the backstop if the immediate grant did not finish. */
export async function applyAutoRechargeIntentSucceeded(
  store: AutoRechargeStore,
  orgId: string,
  intent: {
    id: string;
    amount_received?: number | null;
    amount?: number | null;
    currency?: string | null;
    metadata?: Record<string, string> | null;
  },
  charge: OffSessionPaymentResult['charge'],
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!isAutoRechargeIntent(intent.metadata)) return false;
  const meta = intent.metadata!;
  const amountCents = Math.max(0, intent.amount_received ?? intent.amount ?? 0);
  const fromMeta = Number(meta.credit_nanos ?? '');
  const creditNanos =
    Number.isFinite(fromMeta) && fromMeta > 0
      ? Math.round(fromMeta)
      : creditNanosForPaymentCents(amountCents, aiBudgetConfig(env).creditUsdRatio);
  if (creditNanos <= 0) throw new Error(`[stripe] auto-recharge ${intent.id} has no credit amount`);
  await settleAutoRechargePayment(store, orgId, {
    rechargeId: meta.recharge_id,
    paymentIntentId: intent.id,
    amountCents,
    currency: intent.currency ?? 'usd',
    creditNanos,
    packLabel: creditPackByCode(meta.pack_code)?.label ?? meta.pack_code ?? 'pack',
    charge,
  });
  return true;
}

/** payment_intent.payment_failed for an auto-recharge: close it and turn auto-recharge off. */
export async function applyAutoRechargeIntentFailed(
  store: AutoRechargeStore,
  intent: {
    id: string;
    metadata?: Record<string, string> | null;
    last_payment_error?: { code?: string | null; decline_code?: string | null } | null;
  },
): Promise<boolean> {
  if (!isAutoRechargeIntent(intent.metadata)) return false;
  const code = intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? 'charge_failed';
  await store.finish(intent.metadata!.recharge_id, {
    status: 'failed',
    paymentIntentId: intent.id,
    failureCode: code,
    failureMessage: autoRechargeFailureMessage(code),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Owner settings (GET / PUT /api/billing/ai-allowance/auto-recharge)
// ---------------------------------------------------------------------------

export interface PublicAutoRecharge {
  enabled: boolean;
  packCode: AiCreditPackCode;
  packs: Array<{ code: AiCreditPackCode; label: string; cents: number; priceConfigured: boolean }>;
  available: boolean;
  canManage: boolean;
  notice: { message: string; at: string | null } | null;
  cooldownMinutes: number;
  maxPerDay: number;
  recent: AutoRechargeAttempt[];
}

const DEFAULT_SETTINGS: AutoRechargeSettings = {
  enabled: false,
  packCode: 'ai_10',
  consentedAt: null,
  disabledReason: null,
  disabledAt: null,
  lastAttemptAt: null,
};

export async function readAutoRecharge(
  store: AutoRechargeStore,
  orgId: string,
  opts: { canManage: boolean; stripeEnabled: boolean; env?: NodeJS.ProcessEnv },
): Promise<PublicAutoRecharge> {
  const env = opts.env ?? process.env;
  const settings = (await store.getSettings(orgId)) ?? DEFAULT_SETTINGS;
  const limits = autoRechargeLimits(env);
  const packs = AI_CREDIT_PACKS.map((pack) => ({
    code: pack.code,
    label: pack.label,
    cents: pack.cents,
    priceConfigured: Boolean(creditPackPriceId(pack.code, env)),
  }));
  return {
    enabled: settings.enabled,
    packCode: settings.packCode,
    packs,
    available: opts.stripeEnabled && packs.some((pack) => pack.priceConfigured),
    canManage: opts.canManage,
    notice:
      !settings.enabled && settings.disabledReason
        ? { message: settings.disabledReason, at: settings.disabledAt }
        : null,
    cooldownMinutes: Math.round(limits.cooldownSeconds / 60),
    maxPerDay: limits.maxPerDay,
    recent: opts.canManage ? await store.recentAttempts(orgId, 5) : [],
  };
}

export async function updateAutoRecharge(
  deps: { store: AutoRechargeStore; stripe: () => AutoRechargeStripe },
  input: {
    orgId: string;
    actorId: string | null;
    canManage: boolean;
    stripeEnabled: boolean;
    enabled: boolean;
    packCode?: string | null;
    consent?: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<PublicAutoRecharge> {
  if (!input.canManage) throw forbidden('Only an owner can change auto-recharge.', 'billing_forbidden');
  const env = input.env ?? process.env;
  const current = (await deps.store.getSettings(input.orgId)) ?? DEFAULT_SETTINGS;
  const pack = creditPackByCode(input.packCode ?? current.packCode);
  if (!pack) throw badRequest('Unknown credit pack.', 'unknown_pack');

  if (input.enabled) {
    if (input.consent !== true) {
      throw badRequest(
        `Confirm that we may charge your saved card ${pack.label} each time your AI credits run out.`,
        'consent_required',
      );
    }
    if (!input.stripeEnabled) throw badRequest('Payments are not configured on this server.', 'stripe_unconfigured');
    if (!creditPackPriceId(pack.code, env)) {
      throw badRequest(`The ${pack.label} credit pack is not available right now.`, 'price_not_configured');
    }
    const customerId = await deps.store.stripeCustomerId(input.orgId);
    const paymentMethod = customerId ? await deps.stripe().defaultPaymentMethod(customerId) : null;
    if (!paymentMethod) {
      throw new HttpError(
        409,
        'There is no saved card to charge. Buy credits manually or add a card to your subscription first.',
        'no_saved_card',
      );
    }
  }

  await deps.store.saveSettings(input.orgId, {
    enabled: input.enabled,
    packCode: pack.code,
    actorId: input.actorId,
    consentedAt: input.enabled ? new Date().toISOString() : current.consentedAt,
  });
  return readAutoRecharge(deps.store, input.orgId, { canManage: true, stripeEnabled: input.stripeEnabled, env });
}

// ---------------------------------------------------------------------------
// Supabase + Stripe adapters
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function settingsFromRow(row: Row | null): AutoRechargeSettings | null {
  if (!row) return null;
  const pack = creditPackByCode(row.pack_code);
  return {
    enabled: Boolean(row.enabled),
    packCode: (pack?.code ?? 'ai_10') as AiCreditPackCode,
    consentedAt: row.consented_at ?? null,
    disabledReason: row.disabled_reason ?? null,
    disabledAt: row.disabled_at ?? null,
    lastAttemptAt: row.last_attempt_at ?? null,
  };
}

/** Service-role store. The client must bypass RLS: these tables are read-only to members. */
export function supabaseAutoRechargeStore(client: SupabaseClient): AutoRechargeStore {
  return {
    async getSettings(orgId) {
      const { data, error } = await client
        .from('ai_credit_auto_recharge_settings')
        .select('enabled, pack_code, consented_at, disabled_reason, disabled_at, last_attempt_at')
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) {
        if (error.code === '42P01') return null; // migration not applied yet: off
        throw error;
      }
      return settingsFromRow(data as Row | null);
    },
    async saveSettings(orgId, input) {
      const { data, error } = await client
        .from('ai_credit_auto_recharge_settings')
        .upsert(
          {
            org_id: orgId,
            enabled: input.enabled,
            pack_code: input.packCode,
            consented_at: input.consentedAt,
            updated_by: input.actorId,
            updated_at: new Date().toISOString(),
            // Saving is the owner's answer to any earlier failure notice.
            disabled_reason: null,
            disabled_at: null,
          },
          { onConflict: 'org_id' },
        )
        .select('enabled, pack_code, consented_at, disabled_reason, disabled_at, last_attempt_at')
        .single();
      if (error) throw error;
      return settingsFromRow(data as Row)!;
    },
    async claim(orgId, limits, trigger) {
      const { data, error } = await client.rpc('claim_ai_auto_recharge', {
        p_org: orgId,
        p_cooldown_seconds: limits.cooldownSeconds,
        p_max_per_day: limits.maxPerDay,
        p_stale_seconds: limits.staleSeconds,
        p_trigger: trigger,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Row | null;
      return {
        claimed: Boolean(row?.claimed),
        reason: String(row?.reason ?? 'not_claimed'),
        rechargeId: row?.recharge_id ?? null,
        idempotencyKey: row?.idempotency_key ?? null,
        packCode: row?.pack_code ?? null,
      };
    },
    async finish(rechargeId, input) {
      const { error } = await client.rpc('finish_ai_auto_recharge', {
        p_recharge: rechargeId,
        p_status: input.status,
        p_payment_intent_id: input.paymentIntentId ?? null,
        p_charge_id: input.chargeId ?? null,
        p_amount_cents: input.amountCents ?? null,
        p_currency: input.currency ?? null,
        p_credit_nanos: input.creditNanos ?? null,
        p_failure_code: input.failureCode ?? null,
        p_failure_message: input.failureMessage ?? null,
      });
      if (error) throw error;
    },
    async stripeCustomerId(orgId) {
      const { data, error } = await client
        .from('org_billing')
        .select('stripe_customer_id')
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return ((data as Row | null)?.stripe_customer_id as string | null) ?? null;
    },
    async grantCredits(orgId, input) {
      // stripe_event_id is unique in the ledger: the PaymentIntent id keeps
      // the immediate grant and the webhook from both adding credits.
      const { error } = await client.from('ai_credit_ledger').insert({
        org_id: orgId,
        delta_nanos: input.creditNanos,
        kind: 'purchase',
        stripe_event_id: input.paymentIntentId,
        note: input.note,
      });
      if (error && error.code !== '23505') throw error;
      return { applied: !error };
    },
    async recordPayment(orgId, input) {
      const { error } = await client.rpc('record_payment', {
        p_org: orgId,
        p_kind: 'credits',
        p_status: 'succeeded',
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
        p_description: 'AI usage credits (auto-recharge)',
        p_payment_intent_id: input.paymentIntentId,
        p_charge_id: input.chargeId,
        p_receipt_url: input.receiptUrl,
        p_receipt_email: input.receiptEmail,
        p_card_brand: input.cardBrand,
        p_card_last4: input.cardLast4,
      });
      if (error) throw new Error(`payment record failed: ${error.message}`);
    },
    async recentAttempts(orgId, limit) {
      const { data, error } = await client
        .from('ai_credit_auto_recharges')
        .select('id, created_at, status, pack_code, amount_cents, failure_message')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        if (error.code === '42P01') return [];
        throw error;
      }
      return ((data as Row[] | null) ?? []).map((row) => ({
        id: row.id,
        at: row.created_at,
        status: row.status,
        packCode: row.pack_code,
        amountCents: row.amount_cents ?? null,
        failureMessage: row.failure_message ?? null,
      }));
    },
  };
}

function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : (value.id ?? null);
}

export function chargeSummary(charge: Stripe.Charge | string | null | undefined): OffSessionPaymentResult['charge'] {
  if (!charge || typeof charge === 'string') return charge ? { id: charge, receiptUrl: null, receiptEmail: null, cardBrand: null, cardLast4: null } : null;
  const card = charge.payment_method_details?.card;
  return {
    id: charge.id ?? null,
    receiptUrl: charge.receipt_url ?? null,
    receiptEmail: charge.receipt_email ?? null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
  };
}

export function stripeAutoRechargeAdapter(stripe: Stripe): AutoRechargeStripe {
  return {
    async retrievePrice(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return {
        unitAmount: price.unit_amount ?? null,
        currency: price.currency,
        active: price.active,
        oneTime: price.type === 'one_time',
      };
    },
    async defaultPaymentMethod(customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer || (customer as Stripe.DeletedCustomer).deleted) return null;
      const fromCustomer = idOf((customer as Stripe.Customer).invoice_settings?.default_payment_method as any);
      if (fromCustomer) return fromCustomer;
      // Subscription checkout saves the card on the subscription, not the customer.
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
      for (const sub of subs.data) {
        if (!['active', 'trialing', 'past_due'].includes(sub.status)) continue;
        const pm = idOf(sub.default_payment_method as any);
        if (pm) return pm;
      }
      return null;
    },
    async createOffSessionPayment(input, idempotencyKey) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency,
          customer: input.customer,
          payment_method: input.paymentMethod,
          off_session: true,
          confirm: true,
          description: input.description,
          metadata: input.metadata,
          expand: ['latest_charge'],
        },
        { idempotencyKey },
      );
      return { id: intent.id, status: intent.status, charge: chargeSummary(intent.latest_charge as any) };
    },
  };
}
