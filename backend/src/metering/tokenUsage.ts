/**
 * Customer-facing token meter.
 *
 * Every model call that spends tokens (video analysis, chat, Ask) writes one
 * row via `record_token_usage`. Aggregation for Settings → Billing lives here
 * so the API never scans raw events in the browser and never leaks cost basis
 * that is not already on the customer's bill.
 *
 * `cost_nanos` is provider COGS. `price_nanos` is the org billable
 * (cost × USAGE_CUSTOMER_MARKUP, default 10). Spend KPIs read price_nanos.
 * A Gemini row stored at $0 is priced from the same card video analysis uses
 * so the number matches tokens that were actually spent. The query is always
 * the signed-in org — never the global ledger.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentAiUsageScope } from './aiUsageContext.js';
import { cacheTokensOf, type MeasuredUsage, type ProviderUsageCall } from '../lib/anthropic.js';
import { labelForMemberRole } from '../lib/productRoles.js';
import { usdToNanos } from './costEngine.js';
import { resolveTokenLedgerAmounts, usageCustomerMarkup } from './customerMarkup.js';
import { eventBillableNanos as sharedEventBillableNanos, providerCostForUsage } from './pricing.js';
import { RATE_CARD_VERIFIED_AT } from './modelPriceTable.js';
import { classifyTokenFeature, TOKEN_FEATURES, type TokenFeature } from './tokenFeatures.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { invoiceSameDayUsageAsync, usageDayUtc } from '../lib/stripeSameDayUsage.js';
import { aiBudgetConfig } from './aiBudgetConfig.js';
import { settleUsageCost } from './aiBudgetService.js';

export interface TokenUsageInput {
  orgId: string;
  requestId: string;
  feature?: string | null;
  source?: string | null;
  userId?: string | null;
  jobId?: string | null;
  modelId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  /** Provider/COGS nanodollars. Billable is computed when priceNanos is omitted. */
  costNanos?: number;
  /** Customer/billable nanodollars. Defaults to cost × USAGE_CUSTOMER_MARKUP. */
  priceNanos?: number;
  metadata?: Record<string, unknown>;
  at?: string;
  /** anthropic | google | openai | tavily — whose API reported the usage. */
  provider?: string | null;
  /** Provider-reported cache split. cacheTokens is the aggregate. */
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  /** Raw provider usage object(s), stored on token_usage_events.provider_usage. */
  providerUsage?: Record<string, unknown> | null;
  /** 'unpriced' when the model has no price on the rate card. */
  pricingStatus?: 'priced' | 'unpriced';
}

export interface TokenUsageEventRow {
  id: string;
  orgId: string;
  userId: string | null;
  jobId: string | null;
  requestId: string;
  feature: TokenFeature;
  source: string | null;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costNanos: number;
  priceNanos: number;
  createdAt: string;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  provider?: string | null;
  pricingStatus?: string | null;
}

export interface TokenTotals {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  priceNanos: number;
}

export interface TokenFeatureBreakdown extends TokenTotals {
  feature: TokenFeature;
}

export interface TokenDayActor {
  userId: string | null;
  name: string;
  events: number;
}

export interface TokenUsageDay extends TokenTotals {
  day: string;
  byFeature: Record<TokenFeature, TokenTotals>;
  /** People with calls this UTC day, most calls first. */
  actors: TokenDayActor[];
}

export interface TokenEmployeeBreakdown extends TokenTotals {
  userId: string | null;
  name: string;
  email: string | null;
  role: string;
  roleLabel: string;
  byFeature: Record<TokenFeature, TokenTotals>;
}

export interface TokenUsageRecent {
  id: string;
  createdAt: string;
  feature: TokenFeature;
  source: string | null;
  modelId: string | null;
  userId: string | null;
  userName: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  priceNanos: number;
}

/**
 * Per-job rollup for Settings → Billing job costing.
 * `analysisMinutes` is Σ duration_seconds of analysed film / 60 — never a tokens→minutes guess.
 */
export interface TokenJobBreakdown extends TokenTotals {
  jobId: string;
  title: string;
  jobNumber: number | null;
  /** Minutes of film with analysis_status=done in the report window (analysed_at). */
  analysisMinutes: number | null;
  /** Raw seconds behind analysisMinutes; null when no timed analysed film. */
  analysisSeconds: number | null;
  byFeature: Record<TokenFeature, TokenTotals>;
}

export interface TokenUsageReport {
  periodStart: string;
  periodEnd: string;
  range: TokenUsageRange;
  /** Signed-in organization. Null when the name could not be loaded. */
  orgName?: string | null;
  totals: TokenTotals;
  byFeature: TokenFeatureBreakdown[];
  byDay: TokenUsageDay[];
  byEmployee: TokenEmployeeBreakdown[];
  byJob: TokenJobBreakdown[];
  recent: TokenUsageRecent[];
}

export type TokenUsageRange = 'period' | '30d' | '90d';

const EMPTY_TOTALS = (): TokenTotals => ({
  events: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  totalTokens: 0,
  priceNanos: 0,
});

/** Convert film seconds to display minutes (1 decimal). Null when unknown. */
export function secondsToAnalysisMinutes(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round((seconds / 60) * 10) / 10;
}

export function aggregateJobTokenUsage(
  rows: TokenUsageEventRow[],
  jobs: Array<{ jobId: string; title: string; jobNumber: number | null }>,
  analysisSecondsByJob: Map<string, number>,
): TokenJobBreakdown[] {
  const jobMeta = new Map(jobs.map((j) => [j.jobId, j]));
  const map = new Map<string, TokenJobBreakdown>();

  function ensure(jobId: string): TokenJobBreakdown {
    const existing = map.get(jobId);
    if (existing) return existing;
    const meta = jobMeta.get(jobId);
    const seconds = analysisSecondsByJob.get(jobId);
    const row: TokenJobBreakdown = {
      jobId,
      title: meta?.title?.trim() || 'Job',
      jobNumber: meta?.jobNumber ?? null,
      analysisSeconds: seconds != null && seconds > 0 ? seconds : null,
      analysisMinutes: secondsToAnalysisMinutes(seconds),
      byFeature: emptyByFeature(),
      ...EMPTY_TOTALS(),
    };
    map.set(jobId, row);
    return row;
  }

  for (const row of rows) {
    if (!row.jobId) continue;
    const job = ensure(row.jobId);
    const increment = asEventTotals(row);
    addTo(job, increment);
    addTo(job.byFeature[row.feature], increment);
  }

  return [...map.values()].sort((a, b) => {
    if (b.priceNanos !== a.priceNanos) return b.priceNanos - a.priceNanos;
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.title.localeCompare(b.title);
  });
}

function meteredUserName(
  userId: string | null,
  member: { fullName: string | null; email: string | null } | undefined,
): string {
  return (
    member?.fullName?.trim() ||
    member?.email?.split('@')[0] ||
    (userId ? 'Teammate' : 'System')
  );
}

function emptyByFeature(): Record<TokenFeature, TokenTotals> {
  return {
    video_analysis: EMPTY_TOTALS(),
    chat: EMPTY_TOTALS(),
    ask: EMPTY_TOTALS(),
    web_search: EMPTY_TOTALS(),
    computer: EMPTY_TOTALS(),
    other: EMPTY_TOTALS(),
  };
}

function addTo(target: TokenTotals, row: TokenTotals): void {
  target.events += row.events;
  target.inputTokens += row.inputTokens;
  target.outputTokens += row.outputTokens;
  target.cacheTokens += row.cacheTokens;
  target.totalTokens += row.totalTokens;
  target.priceNanos += row.priceNanos;
}

/**
 * Billable nanodollars for one event — the shared rule in metering/pricing.ts
 * (stored price wins; a legacy row with tokens but $0 is priced from the rate
 * card and marked up once). Billing and Analytics both call this.
 */
export function eventBillableNanos(row: Pick<
  TokenUsageEventRow,
  'priceNanos' | 'costNanos' | 'modelId' | 'inputTokens' | 'outputTokens' | 'cacheTokens'
> & Partial<Pick<TokenUsageEventRow, 'cacheReadTokens' | 'cacheWrite5mTokens' | 'cacheWrite1hTokens' | 'createdAt'>>): number {
  return sharedEventBillableNanos(row);
}

function asEventTotals(row: TokenUsageEventRow): TokenTotals {
  return {
    events: 1,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens: row.cacheTokens,
    totalTokens: row.totalTokens,
    priceNanos: eventBillableNanos(row),
  };
}

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

export function eachUtcDay(fromIso: string, toIso: string): string[] {
  const days: string[] = [];
  const start = Date.parse(`${utcDay(fromIso)}T00:00:00.000Z`);
  const end = Date.parse(`${utcDay(toIso)}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return days;
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export function resolveTokenUsageWindow(opts: {
  range: TokenUsageRange;
  periodStart?: string | null;
  periodEnd?: string | null;
  now?: Date;
}): { start: string; end: string } {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  if (opts.range === 'period' && opts.periodStart) {
    // Billing period end is often in the future. Cap at now so "this period"
    // is spend so far, in UTC, not an empty tail of days that have not happened.
    // A period that already closed stays closed.
    const periodEndMs = opts.periodEnd ? Date.parse(opts.periodEnd) : Number.NaN;
    const end = Number.isFinite(periodEndMs) && periodEndMs < now.getTime()
      ? opts.periodEnd!
      : nowIso;
    return { start: opts.periodStart, end };
  }
  const days = opts.range === '90d' ? 90 : 30;
  const start = new Date(now.getTime() - days * 86_400_000);
  return { start: start.toISOString(), end: nowIso };
}

export function aggregateTokenUsage(
  rows: TokenUsageEventRow[],
  window: { start: string; end: string },
  members: Array<{
    userId: string;
    fullName: string | null;
    email: string | null;
    role: string;
  }>,
  jobContext?: {
    jobs: Array<{ jobId: string; title: string; jobNumber: number | null }>;
    analysisSecondsByJob: Map<string, number>;
  },
): Omit<TokenUsageReport, 'range'> {
  const totals = EMPTY_TOTALS();
  const featureMap = emptyByFeature();
  const dayMap = new Map<string, Omit<TokenUsageDay, 'actors'>>();
  const dayActors = new Map<string, Map<string, TokenDayActor>>();
  const employeeMap = new Map<string, TokenEmployeeBreakdown>();

  const memberById = new Map(members.map((m) => [m.userId, m]));

  function employeeKey(userId: string | null): string {
    return userId ?? '__unattributed__';
  }

  function ensureEmployee(userId: string | null): TokenEmployeeBreakdown {
    const key = employeeKey(userId);
    const existing = employeeMap.get(key);
    if (existing) return existing;
    const member = userId ? memberById.get(userId) : undefined;
    const row: TokenEmployeeBreakdown = {
      userId,
      name: member?.fullName?.trim() || member?.email?.split('@')[0] || (userId ? 'Teammate' : 'Unattributed'),
      email: member?.email ?? null,
      role: member?.role ?? (userId ? 'employee' : 'system'),
      roleLabel: userId ? labelForMemberRole(member?.role) : 'System',
      byFeature: emptyByFeature(),
      ...EMPTY_TOTALS(),
    };
    employeeMap.set(key, row);
    return row;
  }

  for (const member of members) {
    ensureEmployee(member.userId);
  }

  for (const row of rows) {
    const increment = asEventTotals(row);
    addTo(totals, increment);
    addTo(featureMap[row.feature], increment);

    const day = utcDay(row.createdAt);
    let dayRow = dayMap.get(day);
    if (!dayRow) {
      dayRow = { day, byFeature: emptyByFeature(), ...EMPTY_TOTALS() };
      dayMap.set(day, dayRow);
    }
    addTo(dayRow, increment);
    addTo(dayRow.byFeature[row.feature], increment);

    const actorKey = row.userId ?? '__unattributed__';
    let actors = dayActors.get(day);
    if (!actors) {
      actors = new Map();
      dayActors.set(day, actors);
    }
    const actor = actors.get(actorKey);
    if (actor) actor.events += 1;
    else {
      const member = row.userId ? memberById.get(row.userId) : undefined;
      actors.set(actorKey, {
        userId: row.userId,
        name: meteredUserName(row.userId, member),
        events: 1,
      });
    }

    const employee = ensureEmployee(row.userId);
    addTo(employee, increment);
    addTo(employee.byFeature[row.feature], increment);
  }

  const byFeature = TOKEN_FEATURES.map((feature) => ({
    feature,
    ...featureMap[feature],
  }));

  const byDay = eachUtcDay(window.start, window.end).map((day) => {
    const base = dayMap.get(day) ?? { day, byFeature: emptyByFeature(), ...EMPTY_TOTALS() };
    const actors = [...(dayActors.get(day)?.values() ?? [])].sort((a, b) => {
      if (b.events !== a.events) return b.events - a.events;
      return a.name.localeCompare(b.name);
    });
    return { ...base, actors };
  });

  const byEmployee = [...employeeMap.values()].sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.name.localeCompare(b.name);
  });

  const recent = [...rows]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)
    .map((row) => {
      const member = row.userId ? memberById.get(row.userId) : undefined;
      return {
        id: row.id,
        createdAt: row.createdAt,
        feature: row.feature,
        source: row.source,
        modelId: row.modelId,
        userId: row.userId,
        userName: meteredUserName(row.userId, member),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheTokens: row.cacheTokens,
        totalTokens: row.totalTokens,
        priceNanos: eventBillableNanos(row),
      };
    });

  const byJob = aggregateJobTokenUsage(
    rows,
    jobContext?.jobs ?? [],
    jobContext?.analysisSecondsByJob ?? new Map(),
  );

  return {
    periodStart: window.start,
    periodEnd: window.end,
    totals,
    byFeature,
    byDay,
    byEmployee,
    byJob,
    recent,
  };
}

function toRpcParams(input: TokenUsageInput) {
  const { costNanos, priceNanos } = resolveTokenLedgerAmounts({
    costNanos: input.costNanos,
    priceNanos: input.priceNanos,
  });
  const metadata = {
    ...(input.metadata ?? {}),
    customerMarkup: usageCustomerMarkup(),
  };
  return {
    p_org: input.orgId,
    p_request_id: input.requestId,
    p_feature: input.feature ?? input.source ?? null,
    p_source: input.source ?? input.feature ?? null,
    p_user_id: input.userId ?? null,
    p_job_id: input.jobId ?? null,
    p_model_id: input.modelId ?? null,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_cache_tokens: input.cacheTokens ?? 0,
    p_cost_nanos: costNanos,
    p_price_nanos: priceNanos,
    p_metadata: metadata,
    p_at: input.at ?? null,
    p_provider: input.provider ?? null,
    p_cache_read_tokens: input.cacheReadTokens ?? 0,
    p_cache_write_5m_tokens: input.cacheWrite5mTokens ?? 0,
    p_cache_write_1h_tokens: input.cacheWrite1hTokens ?? 0,
    p_provider_usage: input.providerUsage ?? null,
    p_pricing_status: input.pricingStatus ?? (costNanos > 0 ? 'priced' : tokenCount(input) > 0 ? 'unpriced' : 'priced'),
  };
}

function tokenCount(input: TokenUsageInput): number {
  return (input.inputTokens ?? 0) + (input.outputTokens ?? 0) + (input.cacheTokens ?? 0);
}

/** Record one token-usage event. Idempotent on requestId. Never throws to the caller of the async variant. */
export async function recordTokenUsage(
  client: SupabaseClient,
  input: TokenUsageInput,
): Promise<{ eventId: string; duplicate: boolean } | null> {
  const params = toRpcParams(input);
  const tokenTotal = tokenCount(input);
  if (tokenTotal > 0 && params.p_cost_nanos <= 0) {
    // Health check: tokens were spent but nothing was priced. This is an
    // alert, not a warning — the row is stored with pricing_status
    // 'unpriced' and Analytics › Token usage shows it as a red health flag.
    console.error('[metering] ALERT unpriced AI usage: tokens recorded with $0 cost', {
      orgId: input.orgId,
      requestId: input.requestId,
      modelId: input.modelId ?? null,
      totalTokens: tokenTotal,
    });
  }
  const { data, error } = await client.rpc('record_token_usage', params);
  if (error) throw error;
  const row = data as { eventId?: string; duplicate?: boolean } | null;
  if (!row?.eventId) return null;
  const recorded = { eventId: String(row.eventId), duplicate: Boolean(row.duplicate) };
  if (!recorded.duplicate) {
    const amounts = resolveTokenLedgerAmounts({
      costNanos: input.costNanos,
      priceNanos: input.priceNanos,
    });
    const budget = aiBudgetConfig();
    if (!budget.replacesUsageInvoices && amounts.priceNanos > 0) {
      invoiceSameDayUsageAsync(client, input.orgId, input.at ? usageDayUtc(input.at) : undefined);
    }
    if (amounts.costNanos > 0) {
      void settleUsageCost(unscopedAdminOrNull() ?? client, {
        orgId: input.orgId,
        requestId: input.requestId,
        costNanos: amounts.costNanos,
        at: input.at,
      }).catch((err) => {
        console.error('[metering] failed to settle AI allowance', {
          orgId: input.orgId,
          requestId: input.requestId,
          err,
        });
      });
    }
  }
  return recorded;
}

/** Flat provider fees (Whisper minutes, Tavily searches) on the same ledger as tokens. */
export function recordFlatProviderCost(
  client: SupabaseClient,
  input: {
    orgId: string;
    requestId: string;
    feature: string;
    source: string;
    modelId: string;
    costNanos: number;
    jobId?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown>;
    provider?: string | null;
    /** Raw usage the provider returned (Tavily `usage`, OpenAI transcription `usage`). */
    providerUsage?: Record<string, unknown> | null;
  },
): void {
  if (!Number.isFinite(input.costNanos) || input.costNanos <= 0) {
    console.error('[metering] ALERT flat provider fee has no price; not recorded', {
      orgId: input.orgId,
      requestId: input.requestId,
      modelId: input.modelId,
    });
    return;
  }
  recordTokenUsageAsync(client, {
    provider: input.provider ?? null,
    providerUsage: input.providerUsage ?? null,
    orgId: input.orgId,
    requestId: input.requestId,
    feature: input.feature,
    source: input.source,
    modelId: input.modelId,
    costNanos: Math.round(input.costNanos),
    inputTokens: 0,
    outputTokens: 0,
    jobId: input.jobId ?? null,
    userId: input.userId ?? null,
    metadata: input.metadata,
  });
}

export function recordTokenUsageAsync(
  client: SupabaseClient,
  input: TokenUsageInput,
  onError?: (err: unknown) => void,
): void {
  void recordTokenUsage(client, input).catch((err) => {
    console.error('[metering] failed to record token usage', {
      orgId: input.orgId,
      requestId: input.requestId,
      err,
    });
    onError?.(err);
  });
}

/**
 * Provider cost for provider-reported usage, from the official rate card
 * (metering/modelPriceTable.ts via metering/pricing.ts). Local and
 * synchronous in substance: no database round-trip that can fail on grants —
 * the September 23 lock-down made `quote_usage` service_role-only, the Ask
 * path called it with the signed-in client, and Claude turns were stored at
 * $0. A model that is not on the card returns 0 and logs an ALERT; the write
 * path then stores the row as `unpriced` so it is never silent.
 *
 * The client argument is kept for call-site compatibility.
 */
export async function quoteMeasuredUsageCostNanos(
  _client: SupabaseClient,
  modelId: string | null | undefined,
  usage: MeasuredUsage,
  at: Date | string | null = null,
): Promise<number> {
  const quote = providerCostForUsage(modelId, usage, at);
  if (!quote.priced) {
    console.error('[metering] ALERT no price on the rate card; usage recorded at $0', {
      modelId: modelId ?? null,
      unpricedModels: quote.unpricedModels,
      totalTokens: usage.totalTokens,
      rateCardVerifiedAt: quote.rateCardVerifiedAt,
    });
  }
  return quote.costNanos;
}

/** @deprecated Use quoteMeasuredUsageCostNanos — name kept for existing tests. */
export async function quoteMeasuredUsagePriceNanos(
  client: SupabaseClient,
  modelId: string | null | undefined,
  usage: MeasuredUsage,
): Promise<number> {
  return quoteMeasuredUsageCostNanos(client, modelId, usage);
}

/** Record provider-measured usage on the customer token ledger. */
export function recordMeasuredTokenUsage(
  client: SupabaseClient,
  input: {
    orgId: string;
    requestId: string;
    feature: string;
    source?: string;
    userId?: string | null;
    jobId?: string | null;
    modelId?: string | null;
    usage: MeasuredUsage | null | undefined;
    /** Provider/COGS. When omitted, quoted from the rate card. */
    costNanos?: number;
    /** Legacy alias: treated as COGS when costNanos is omitted. */
    priceNanos?: number;
  },
): void {
  const usage = input.usage;
  if (!usage || usage.totalTokens <= 0) return;
  void recordMeasuredTokenUsageAsync(client, { ...input, usage }).catch((err) => {
    console.error('[metering] failed to record measured token usage', {
      orgId: input.orgId,
      requestId: input.requestId,
      err,
    });
  });
}

/** Awaitable Ask/chat write path — billable = round(cost × markup). */
export async function recordMeasuredTokenUsageAsync(
  client: SupabaseClient,
  input: {
    orgId: string;
    requestId: string;
    feature: string;
    source?: string;
    userId?: string | null;
    jobId?: string | null;
    modelId?: string | null;
    usage: MeasuredUsage;
    costNanos?: number;
    priceNanos?: number;
  },
): Promise<{ eventId: string; duplicate: boolean } | null> {
  const usage = input.usage;
  const quote = providerCostForUsage(input.modelId, usage);
  const quotedCost =
    input.costNanos != null && input.costNanos > 0
      ? input.costNanos
      : input.priceNanos != null && input.priceNanos > 0
        ? input.priceNanos
        : await quoteMeasuredUsageCostNanos(client, input.modelId, usage);
  return recordTokenUsage(client, {
    provider: usage.provider ?? providerOfModel(input.modelId),
    cacheReadTokens: usage.cacheReadTokens,
    cacheWrite5mTokens: usage.cacheWrite5mTokens,
    cacheWrite1hTokens: usage.cacheWrite1hTokens,
    providerUsage: providerUsageJson(usage.calls, input.modelId ?? null),
    pricingStatus: quotedCost > 0 ? 'priced' : 'unpriced',
    orgId: input.orgId,
    requestId: input.requestId,
    feature: input.feature,
    source: input.source ?? input.feature,
    userId: input.userId ?? null,
    jobId: input.jobId ?? null,
    modelId: input.modelId ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheTokens: cacheTokensOf(usage),
    costNanos: quotedCost,
    metadata: {
      pricing: {
        rateCardVerifiedAt: RATE_CARD_VERIFIED_AT,
        ...(quote.unpricedModels.length ? { unpricedModels: quote.unpricedModels } : {}),
      },
    },
  });
}

/** Provider for a model id, when the usage object did not say. */
export function providerOfModel(modelId: string | null | undefined): string | null {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return null;
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gemini')) return 'google';
  if (id.startsWith('tavily')) return 'tavily';
  if (id.startsWith('whisper') || id.startsWith('gpt')) return 'openai';
  return null;
}

/** `provider_usage` jsonb: one entry per provider call, with the raw usage object. */
export function providerUsageJson(
  calls: ProviderUsageCall[] | undefined,
  fallbackModel: string | null,
): Record<string, unknown> | null {
  if (!calls?.length) return null;
  return {
    calls: calls.map((call) => ({
      provider: call.provider,
      model: call.model ?? fallbackModel,
      usage: call.raw,
    })),
  };
}

function parseEventRow(raw: Record<string, unknown>): TokenUsageEventRow {
  const featureRaw = String(raw.feature ?? 'other');
  return {
    id: String(raw.id),
    orgId: String(raw.org_id),
    userId: (raw.user_id as string | null) ?? null,
    jobId: (raw.job_id as string | null) ?? null,
    requestId: String(raw.request_id ?? ''),
    feature: classifyTokenFeature(featureRaw),
    source: (raw.source as string | null) ?? null,
    modelId: (raw.model_id as string | null) ?? null,
    inputTokens: Number(raw.input_tokens ?? 0),
    outputTokens: Number(raw.output_tokens ?? 0),
    cacheTokens: Number(raw.cache_tokens ?? 0),
    totalTokens: Number(raw.total_tokens ?? 0),
    costNanos: Number(raw.cost_nanos ?? 0),
    priceNanos: Number(raw.price_nanos ?? 0),
    createdAt: String(raw.created_at),
    cacheReadTokens: Number(raw.cache_read_tokens ?? 0),
    cacheWrite5mTokens: Number(raw.cache_write_5m_tokens ?? 0),
    cacheWrite1hTokens: Number(raw.cache_write_1h_tokens ?? 0),
    provider: (raw.provider as string | null) ?? null,
    pricingStatus: (raw.pricing_status as string | null) ?? null,
  };
}

async function loadMembers(
  client: SupabaseClient,
  orgId: string,
): Promise<Array<{ userId: string; fullName: string | null; email: string | null; role: string }>> {
  const { data, error } = await client
    .from('org_members')
    .select('user_id, role, profiles(email, full_name)')
    .eq('org_id', orgId);
  if (error) {
    console.warn('[metering] could not load members for token usage:', error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as
      | { email?: string | null; full_name?: string | null }
      | null
      | undefined;
    return {
      userId: String(row.user_id),
      role: String(row.role ?? 'employee'),
      email: profile?.email ?? null,
      fullName: profile?.full_name ?? null,
    };
  });
}

async function resolvePeriodBounds(
  client: SupabaseClient,
  orgId: string,
): Promise<{ periodStart: string | null; periodEnd: string | null }> {
  const { data } = await client
    .from('org_billing')
    .select('period_start, period_end')
    .eq('org_id', orgId)
    .maybeSingle();
  return {
    periodStart: (data?.period_start as string | null | undefined) ?? null,
    periodEnd: (data?.period_end as string | null | undefined) ?? null,
  };
}

/**
 * PostgREST's default db-max-rows is 1_000. A single `.limit(20000)` still
 * returns the first page and drops the rest with no error, so spend under-counts.
 */
export const TOKEN_USAGE_PAGE = 1000;

const TOKEN_USAGE_SELECT =
  'id, org_id, user_id, job_id, request_id, feature, source, model_id, input_tokens, output_tokens, cache_tokens, total_tokens, cost_nanos, price_nanos, created_at, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, provider, pricing_status';

export async function collectPaged<T>(
  pageSize: number,
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  const size = Math.max(1, Math.floor(pageSize));
  for (let from = 0; ; from += size) {
    if (from >= size * 500) {
      throw new Error('token usage exceeded the paging safety cap');
    }
    const page = await fetchPage(from, from + size - 1);
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}

async function loadTokenUsageEvents(
  client: SupabaseClient,
  orgId: string,
  window: { start: string; end: string },
): Promise<TokenUsageEventRow[]> {
  const raw = await collectPaged<Record<string, unknown>>(TOKEN_USAGE_PAGE, async (from, to) => {
    const { data, error } = await client
      .from('token_usage_events')
      .select(TOKEN_USAGE_SELECT)
      .eq('org_id', orgId)
      .gte('created_at', window.start)
      .lt('created_at', window.end)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as Array<Record<string, unknown>>;
  });
  return raw.map(parseEventRow);
}

async function loadOrgName(client: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await client.from('orgs').select('name').eq('id', orgId).maybeSingle();
  if (error) return null;
  const name = (data as { name?: string | null } | null)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export async function loadTokenUsageReport(
  client: SupabaseClient,
  orgId: string,
  range: TokenUsageRange = 'period',
): Promise<TokenUsageReport> {
  const bounds = await resolvePeriodBounds(client, orgId);
  const window = resolveTokenUsageWindow({
    range,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
  });

  const [rows, members, orgName] = await Promise.all([
    loadTokenUsageEvents(client, orgId, window),
    loadMembers(client, orgId),
    loadOrgName(client, orgId),
  ]);
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((id): id is string => Boolean(id)))];
  const [jobs, analysisSecondsByJob] = await Promise.all([
    loadJobMeta(client, orgId, jobIds),
    loadAnalysedFilmSeconds(client, orgId, jobIds, window),
  ]);

  return {
    range,
    orgName,
    ...aggregateTokenUsage(rows, window, members, { jobs, analysisSecondsByJob }),
  };
}


async function loadJobMeta(
  client: SupabaseClient,
  orgId: string,
  jobIds: string[],
): Promise<Array<{ jobId: string; title: string; jobNumber: number | null }>> {
  if (jobIds.length === 0) return [];
  const { data, error } = await client
    .from('crm_jobs')
    .select('id, title, job_number')
    .eq('org_id', orgId)
    .in('id', jobIds);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    jobId: String(row.id),
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Job',
    jobNumber:
      row.job_number == null || row.job_number === ''
        ? null
        : Number.isFinite(Number(row.job_number))
          ? Number(row.job_number)
          : null,
  }));
}

/**
 * Sum duration_seconds for film that finished AI analysis in the report window.
 * Uses analysed_at when set; never invents minutes from tokens.
 */
async function loadAnalysedFilmSeconds(
  client: SupabaseClient,
  orgId: string,
  jobIds: string[],
  window: { start: string; end: string },
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (jobIds.length === 0) return map;

  const { data, error } = await client
    .from('job_proofs')
    .select('job_id, duration_seconds, analysed_at, analysis_status, deleted_at')
    .eq('org_id', orgId)
    .eq('analysis_status', 'done')
    .in('job_id', jobIds)
    .is('deleted_at', null);

  if (error) throw error;

  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const jobId = typeof row.job_id === 'string' ? row.job_id : null;
    if (!jobId) continue;

    const analysedAt = typeof row.analysed_at === 'string' ? row.analysed_at : null;
    if (analysedAt) {
      const t = Date.parse(analysedAt);
      if (!Number.isFinite(t) || t < startMs || t >= endMs) continue;
    }
    // If analysed_at is missing on a done proof, include it only when we cannot
    // window — still require a real positive duration (never invent).

    const seconds = Number(row.duration_seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    map.set(jobId, (map.get(jobId) ?? 0) + seconds);
  }
  return map;
}

/** Convert a USD estimate (video analysis) into nanodollars for the ledger. */
export function estimatedUsdToNanos(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return usdToNanos(usd);
}

/**
 * Record provider-reported usage for a call that has no org id of its own,
 * using the request's AI usage scope (metering/aiUsageContext.ts). With no
 * scope the call cannot be attributed to a customer: log an ALERT with the
 * tokens so the provider-billing reconciliation can explain the gap.
 */
export function meterScopedUsage(input: {
  source: string;
  feature: string;
  modelId: string;
  usage: MeasuredUsage | null | undefined;
}): void {
  const usage = input.usage;
  if (!usage || usage.totalTokens <= 0) return;
  const scope = currentAiUsageScope();
  if (!scope) {
    console.error('[metering] ALERT AI call with no org scope; provider usage not attributed', {
      source: input.source,
      modelId: input.modelId,
      totalTokens: usage.totalTokens,
      costNanos: providerCostForUsage(input.modelId, usage).costNanos,
    });
    return;
  }
  recordMeasuredTokenUsage(scope.client, {
    orgId: scope.orgId,
    requestId: `${input.source}:${scope.requestId}:${randomUUID()}`,
    feature: input.feature,
    source: input.source,
    modelId: input.modelId,
    usage,
    jobId: scope.jobId ?? null,
    userId: scope.userId ?? null,
  });
}
