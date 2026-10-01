/**
 * Loads an org's allowance from the subscription, the token ledger, and the
 * credit ledger. Writes are service-role. A missing migration fails open so
 * Ask keeps working until the tables exist, and logs the gap.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentRequired } from '../lib/errors.js';
import {
  atmospherePlan,
  EXTRA_FC_SEAT_ANNUAL_CENTS,
  EXTRA_FC_SEAT_MONTHLY_CENTS,
} from '../lib/stripeCatalog.js';
import { classifyTokenFeature } from './tokenFeatures.js';
import { aiBudgetConfig, AI_CREDIT_PACKS, creditPackPriceId, type AiBudgetConfig } from './aiBudgetConfig.js';
import {
  allowanceNanos,
  allocateUsage,
  customerAllowanceMessage,
  evaluateAllowance,
  featureLabel,
  monthlyAllowanceNanos,
  proratedPeriodChargeCents,
  spanEffectiveFrom,
  subscriptionAmountCents,
  type AllowanceEvaluation,
  type AllowanceState,
  type BudgetPriceSpan,
} from './aiBudget.js';

type DbError = { code?: string; message?: string } | null;

function missingSchema(error: DbError): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === '42703' || /does not exist|schema cache/i.test(error.message ?? '');
}

export interface AllowanceFeatureRow {
  feature: string;
  label: string;
  nanos: number;
}

export interface AllowanceHistoryUsage {
  id: string;
  at: string;
  feature: string;
  label: string;
  nanos: number;
}

export interface AllowanceHistoryCredit {
  id: string;
  at: string;
  kind: string;
  deltaNanos: number;
  note: string | null;
}

export interface AiAllowanceView {
  state: AllowanceState | 'unlimited';
  paused: boolean;
  warning: boolean;
  message: string | null;
  usedNanos: number;
  allowanceNanos: number;
  usedFraction: number;
  resetAt: string | null;
  periodStart: string;
  periodEnd: string;
  rolling: {
    enabled: boolean;
    limited: boolean;
    hours: number;
    usedNanos: number;
    capNanos: number | null;
  };
  byFeature: AllowanceFeatureRow[];
  creditBalanceNanos: number;
  /** Purchased credits and staff grants stay until they are used. The included allowance does not. */
  creditsRollOver: true;
  /** True when the rolling figure comes from allocations, not raw event cost. */
  windowUsesAllocations: boolean;
  canManage: boolean;
  packs: Array<{
    code: string;
    label: string;
    cents: number;
    creditNanos: number;
    priceConfigured: boolean;
  }>;
  history: {
    usage: AllowanceHistoryUsage[];
    credits: AllowanceHistoryCredit[];
  };
  evaluation: AllowanceEvaluation;
}

interface BillingRow {
  status?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  atmosphere_plan_code?: string | null;
  extra_fc_seats?: number | null;
  billing_interval?: string | null;
}

function monthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function asDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

function intervalOf(raw: string | null | undefined): 'month' | 'year' {
  const v = (raw ?? '').toLowerCase();
  if (v === 'year' || v === 'annual' || v === 'yearly') return 'year';
  return 'month';
}

function catalogChargeCents(row: BillingRow): number {
  const interval = intervalOf(row.billing_interval);
  const plan = atmospherePlan(row.atmosphere_plan_code);
  const planCents = interval === 'year' ? plan.annualCents : plan.monthlyCents;
  const seatCents = interval === 'year' ? EXTRA_FC_SEAT_ANNUAL_CENTS : EXTRA_FC_SEAT_MONTHLY_CENTS;
  return subscriptionAmountCents({
    planCents,
    extraSeats: Number(row.extra_fc_seats ?? 0),
    extraSeatCents: seatCents,
  });
}

function displayFeature(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (featureLabel(value) !== 'Other' || value === 'other') return value || 'other';
  return classifyTokenFeature(value);
}

export async function loadAiAllowance(
  client: SupabaseClient,
  orgId: string,
  opts?: { canManage?: boolean; unlimited?: boolean; now?: Date; config?: AiBudgetConfig },
): Promise<AiAllowanceView> {
  const now = opts?.now ?? new Date();
  const config = opts?.config ?? aiBudgetConfig();
  const fallback = monthBounds(now);
  const { data: billing } = await client
    .from('org_billing')
    .select('status, period_start, period_end, atmosphere_plan_code, extra_fc_seats, billing_interval')
    .eq('org_id', orgId)
    .maybeSingle();
  const row = (billing ?? {}) as BillingRow;
  const periodStart = asDate(row.period_start, fallback.start);
  const periodEnd = asDate(row.period_end, fallback.end);
  const windowStart = new Date(now.getTime() - config.rollingHours * 3_600_000);
  const unlimited = Boolean(opts?.unlimited) || row.status === 'comped';

  const [spansRes, eventsRes, creditsRes, allocRes] = await Promise.all([
    client
      .from('ai_budget_price_spans')
      .select('amount_cents, effective_from, effective_to')
      .eq('org_id', orgId)
      .order('effective_from', { ascending: true }),
    client
      .from('token_usage_events')
      .select('id, feature, cost_nanos, created_at')
      .eq('org_id', orgId)
      .gte('created_at', periodStart.toISOString())
      .lt('created_at', periodEnd.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000),
    client
      .from('ai_credit_ledger')
      .select('id, delta_nanos, kind, note, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10000),
    client
      .from('ai_usage_allocations')
      .select('allowance_nanos, created_at')
      .eq('org_id', orgId)
      .gte('created_at', windowStart.toISOString()),
  ]);

  const schemaGap =
    missingSchema(spansRes.error) || missingSchema(creditsRes.error) || missingSchema(allocRes.error);
  if (schemaGap) {
    console.warn('[ai-budget] allowance tables are not migrated yet; limits are off');
  }

  const spans: BudgetPriceSpan[] = schemaGap
    ? []
    : ((spansRes.data ?? []) as Array<{ amount_cents: number; effective_from: string; effective_to: string | null }>).map(
        (span) => ({
          amountCents: Number(span.amount_cents),
          from: new Date(span.effective_from),
          to: span.effective_to ? new Date(span.effective_to) : null,
        }),
      );
  const chargeCents = spans.length
    ? proratedPeriodChargeCents(periodStart, periodEnd, spans)
    : catalogChargeCents(row);
  const periodAllowance = unlimited ? 0 : allowanceNanos(chargeCents, config.allowanceFraction);
  const monthly = unlimited
    ? 0
    : monthlyAllowanceNanos(periodAllowance, periodStart, periodEnd);

  const events = (eventsRes.error ? [] : (eventsRes.data ?? [])) as Array<{
    id: string;
    feature: string | null;
    cost_nanos: number | string | null;
    created_at: string;
  }>;
  let periodSpend = 0;
  let windowCost = 0;
  const byFeature = new Map<string, number>();
  for (const event of events) {
    const nanos = Math.max(0, Math.round(Number(event.cost_nanos ?? 0)));
    periodSpend += nanos;
    const at = new Date(event.created_at).getTime();
    if (at >= windowStart.getTime()) windowCost += nanos;
    const feature = displayFeature(event.feature);
    byFeature.set(feature, (byFeature.get(feature) ?? 0) + nanos);
  }
  const allocRows = schemaGap || allocRes.error ? [] : ((allocRes.data ?? []) as Array<{ allowance_nanos: number }>);
  const windowFromAlloc = allocRows.reduce((sum, row) => sum + Math.max(0, Number(row.allowance_nanos ?? 0)), 0);
  const windowSpend = allocRows.length ? windowFromAlloc : windowCost;
  const creditRows = schemaGap || creditsRes.error
    ? []
    : ((creditsRes.data ?? []) as Array<{ id: string; delta_nanos: number | string; kind: string; note: string | null; created_at: string }>);
  const creditBalance = creditRows.reduce((sum, row) => sum + Number(row.delta_nanos ?? 0), 0);

  const evaluation = evaluateAllowance({
    unlimited: unlimited || schemaGap,
    periodAllowanceNanos: periodAllowance,
    monthlyAllowanceNanos: monthly,
    periodSpendNanos: periodSpend,
    windowSpendNanos: windowSpend,
    creditBalanceNanos: Math.max(0, creditBalance),
    config,
  });
  const canManage = Boolean(opts?.canManage);
  const state = evaluation.unlimited ? 'unlimited' : evaluation.state;
  const message = evaluation.unlimited
    ? null
    : customerAllowanceMessage({
        state: evaluation.state,
        resetAt: periodEnd,
        canManage,
        rollingLimited: evaluation.rollingLimited,
      });

  return {
    state,
    paused: evaluation.paused,
    warning: evaluation.warning,
    message,
    usedNanos: evaluation.includedUsedNanos,
    allowanceNanos: evaluation.periodAllowanceNanos,
    usedFraction: evaluation.unlimited ? 0 : evaluation.usedFraction,
    resetAt: periodEnd.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    rolling: {
      enabled: config.rollingEnabled && !evaluation.unlimited,
      limited: evaluation.rollingLimited,
      hours: config.rollingHours,
      usedNanos: evaluation.windowSpendNanos,
      capNanos: evaluation.rollingCapNanos,
    },
    byFeature: [...byFeature.entries()]
      .map(([feature, nanos]) => ({ feature, label: featureLabel(feature), nanos }))
      .sort((a, b) => b.nanos - a.nanos),
    creditBalanceNanos: Math.max(0, creditBalance),
    creditsRollOver: true,
    windowUsesAllocations: allocRows.length > 0,
    canManage,
    packs: AI_CREDIT_PACKS.map((pack) => ({
      code: pack.code,
      label: pack.label,
      cents: pack.cents,
      creditNanos: Math.round(pack.cents * 10_000_000 * config.creditUsdRatio),
      priceConfigured: Boolean(creditPackPriceId(pack.code)),
    })),
    history: {
      usage: events.slice(0, 20).map((event) => {
        const feature = displayFeature(event.feature);
        return {
          id: event.id,
          at: event.created_at,
          feature,
          label: featureLabel(feature),
          nanos: Math.max(0, Math.round(Number(event.cost_nanos ?? 0))),
        };
      }),
      credits: creditRows.slice(0, 20).map((row) => ({
        id: row.id,
        at: row.created_at,
        kind: row.kind,
        deltaNanos: Number(row.delta_nanos ?? 0),
        note: row.note,
      })),
    },
    evaluation,
  };
}

export async function assertAiFeatureAllowed(
  client: SupabaseClient,
  orgId: string,
  opts?: { canManage?: boolean },
): Promise<AiAllowanceView> {
  const view = await loadAiAllowance(client, orgId, opts);
  if (!view.paused) return view;
  throw paymentRequired(view.message ?? 'AI is paused until the usage allowance resets.', 'ai_budget_limited', {
    canManage: Boolean(opts?.canManage),
    resetAt: view.resetAt,
    state: view.state,
  });
}

export async function isAiPaused(client: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const view = await loadAiAllowance(client, orgId);
    return view.paused;
  } catch (err) {
    console.warn('[ai-budget] could not read allowance; not pausing', err);
    return false;
  }
}

/** Attribute a recorded provider cost to the allowance, then credits. Idempotent on request id. */
export async function settleUsageCost(
  client: SupabaseClient,
  input: { orgId: string; requestId: string; costNanos: number; at?: string },
): Promise<void> {
  if (input.costNanos <= 0) return;
  const view = await loadAiAllowance(client, input.orgId);
  if (view.evaluation.unlimited) return;
  const cost = input.costNanos;
  const beforeSpend = Math.max(0, view.evaluation.periodSpendNanos - cost);
  const includedRemaining = Math.max(0, view.evaluation.periodAllowanceNanos - beforeSpend);
  const windowSpend = view.windowUsesAllocations
    ? view.evaluation.windowSpendNanos
    : Math.max(0, view.evaluation.windowSpendNanos - cost);
  const alloc = allocateUsage({
    costNanos: cost,
    includedRemainingNanos: includedRemaining,
    windowSpendNanos: windowSpend,
    rollingCapNanos: view.evaluation.rollingCapNanos,
    creditBalanceNanos: view.evaluation.creditBalanceNanos,
  });
  const createdAt = input.at ?? new Date().toISOString();
  const { error } = await client.from('ai_usage_allocations').insert({
    org_id: input.orgId,
    request_id: input.requestId,
    cost_nanos: cost,
    allowance_nanos: alloc.allowanceNanos,
    credit_nanos: alloc.creditNanos,
    created_at: createdAt,
  });
  if (error) {
    if (error.code === '23505' || missingSchema(error)) return;
    throw error;
  }
  if (alloc.creditNanos > 0) {
    const draw = await client.from('ai_credit_ledger').insert({
      org_id: input.orgId,
      delta_nanos: -alloc.creditNanos,
      kind: 'consume',
      request_id: input.requestId,
      note: 'AI usage',
      created_at: createdAt,
    });
    if (draw.error && draw.error.code !== '23505' && !missingSchema(draw.error)) {
      console.warn('[ai-budget] credit draw failed', draw.error.message);
    }
  }
}

export async function grantAiCredits(
  client: SupabaseClient,
  input: {
    orgId: string;
    deltaNanos: number;
    kind: 'purchase' | 'admin_grant' | 'refund' | 'adjustment';
    stripeEventId?: string | null;
    stripeSessionId?: string | null;
    requestId?: string | null;
    note?: string | null;
    actorId?: string | null;
  },
): Promise<{ applied: boolean; balanceNanos: number }> {
  const { error } = await client.from('ai_credit_ledger').insert({
    org_id: input.orgId,
    delta_nanos: input.deltaNanos,
    kind: input.kind,
    stripe_event_id: input.stripeEventId ?? null,
    stripe_session_id: input.stripeSessionId ?? null,
    request_id: input.requestId ?? null,
    note: input.note ?? null,
    actor_id: input.actorId ?? null,
  });
  if (error && error.code !== '23505') throw error;
  const { data, error: readError } = await client
    .from('ai_credit_ledger')
    .select('delta_nanos')
    .eq('org_id', input.orgId);
  if (readError) throw readError;
  const balanceNanos = ((data ?? []) as Array<{ delta_nanos: number | string }>).reduce(
    (sum, row) => sum + Number(row.delta_nanos ?? 0),
    0,
  );
  return { applied: !error, balanceNanos };
}

export async function recordSubscriptionPriceSpan(
  client: SupabaseClient,
  orgId: string,
  input: { amountCents: number; interval: 'month' | 'year'; at?: Date; periodStart?: Date | null },
): Promise<void> {
  const at = input.at ?? new Date();
  const { data, error } = await client
    .from('ai_budget_price_spans')
    .select('id, amount_cents, effective_to')
    .eq('org_id', orgId)
    .is('effective_to', null)
    .order('effective_from', { ascending: false })
    .limit(1);
  if (error) {
    if (missingSchema(error)) return;
    throw error;
  }
  const open = (data ?? [])[0] as { id: string; amount_cents: number } | undefined;
  if (open && Number(open.amount_cents) === input.amountCents) return;
  if (open) {
    await client.from('ai_budget_price_spans').update({ effective_to: at.toISOString() }).eq('id', open.id);
  }
  const from = spanEffectiveFrom({
    hasExistingSpan: Boolean(open),
    periodStart: input.periodStart ?? null,
    at,
  });
  const { error: insertError } = await client.from('ai_budget_price_spans').insert({
    org_id: orgId,
    amount_cents: input.amountCents,
    billing_interval: input.interval,
    effective_from: from.toISOString(),
  });
  if (insertError && !missingSchema(insertError)) throw insertError;
}

export async function markProofBudgetHold(
  client: SupabaseClient,
  proofId: string,
  reason: string,
): Promise<void> {
  const { error } = await client
    .from('job_proofs')
    .update({
      ai_budget_hold: true,
      ai_budget_hold_reason: reason,
      analysis_status: 'queued',
    })
    .eq('id', proofId);
  if (error && !missingSchema(error)) throw error;
}

export async function releaseHeldProofs(client: SupabaseClient, limit = 20): Promise<number> {
  const { data, error } = await client
    .from('job_proofs')
    .select('id, org_id')
    .eq('ai_budget_hold', true)
    .is('deleted_at', null)
    .order('received_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (missingSchema(error)) return 0;
    throw error;
  }
  const rows = (data ?? []) as Array<{ id: string; org_id: string }>;
  const paused = new Map<string, boolean>();
  let released = 0;
  for (const row of rows) {
    if (!paused.has(row.org_id)) paused.set(row.org_id, await isAiPaused(client, row.org_id));
    if (paused.get(row.org_id)) continue;
    const { error: updateError } = await client
      .from('job_proofs')
      .update({ ai_budget_hold: false, ai_budget_hold_reason: null })
      .eq('id', row.id);
    if (!updateError) released += 1;
  }
  return released;
}

export function publicAllowance(
  view: AiAllowanceView,
): Omit<AiAllowanceView, 'evaluation' | 'windowUsesAllocations'> {
  const { evaluation: _hidden, windowUsesAllocations: _window, ...rest } = view;
  return rest;
}
