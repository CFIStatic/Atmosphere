/**
 * Customer-facing token meter.
 *
 * Every model call that spends tokens (video analysis, chat, Ask) writes one
 * row via `record_token_usage`. Aggregation for Settings → Billing lives here
 * so the API never scans raw events in the browser and never leaks cost basis
 * that is not already on the customer's bill.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheTokensOf, type MeasuredUsage } from '../lib/anthropic.js';
import { toNanos } from '../lib/money.js';
import { labelForMemberRole } from '../lib/productRoles.js';
import { usdToNanos } from './costEngine.js';
import { classifyTokenFeature, TOKEN_FEATURES, type TokenFeature } from './tokenFeatures.js';

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
  priceNanos?: number;
  metadata?: Record<string, unknown>;
  at?: string;
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
  priceNanos: number;
  createdAt: string;
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

export interface TokenUsageDay extends TokenTotals {
  day: string;
  byFeature: Record<TokenFeature, TokenTotals>;
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

export interface TokenUsageReport {
  periodStart: string;
  periodEnd: string;
  range: TokenUsageRange;
  totals: TokenTotals;
  byFeature: TokenFeatureBreakdown[];
  byDay: TokenUsageDay[];
  byEmployee: TokenEmployeeBreakdown[];
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

function emptyByFeature(): Record<TokenFeature, TokenTotals> {
  return {
    video_analysis: EMPTY_TOTALS(),
    chat: EMPTY_TOTALS(),
    ask: EMPTY_TOTALS(),
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

function asEventTotals(row: TokenUsageEventRow): TokenTotals {
  return {
    events: 1,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens: row.cacheTokens,
    totalTokens: row.totalTokens,
    priceNanos: row.priceNanos,
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
  if (opts.range === 'period' && opts.periodStart) {
    return {
      start: opts.periodStart,
      end: opts.periodEnd ?? now.toISOString(),
    };
  }
  const days = opts.range === '90d' ? 90 : 30;
  const start = new Date(now.getTime() - days * 86_400_000);
  return { start: start.toISOString(), end: now.toISOString() };
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
): Omit<TokenUsageReport, 'range'> {
  const totals = EMPTY_TOTALS();
  const featureMap = emptyByFeature();
  const dayMap = new Map<string, TokenUsageDay>();
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

    const employee = ensureEmployee(row.userId);
    addTo(employee, increment);
    addTo(employee.byFeature[row.feature], increment);
  }

  const byFeature = TOKEN_FEATURES.map((feature) => ({
    feature,
    ...featureMap[feature],
  }));

  const byDay = eachUtcDay(window.start, window.end).map((day) => {
    return dayMap.get(day) ?? { day, byFeature: emptyByFeature(), ...EMPTY_TOTALS() };
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
        userName:
          member?.fullName?.trim() ||
          member?.email?.split('@')[0] ||
          (row.userId ? 'Teammate' : 'System'),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheTokens: row.cacheTokens,
        totalTokens: row.totalTokens,
        priceNanos: row.priceNanos,
      };
    });

  return {
    periodStart: window.start,
    periodEnd: window.end,
    totals,
    byFeature,
    byDay,
    byEmployee,
    recent,
  };
}

function toRpcParams(input: TokenUsageInput) {
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
    p_price_nanos: input.priceNanos ?? 0,
    p_metadata: input.metadata ?? {},
    p_at: input.at ?? null,
  };
}

/** Record one token-usage event. Idempotent on requestId. Never throws to the caller of the async variant. */
export async function recordTokenUsage(
  client: SupabaseClient,
  input: TokenUsageInput,
): Promise<{ eventId: string; duplicate: boolean } | null> {
  const { data, error } = await client.rpc('record_token_usage', toRpcParams(input));
  if (error) throw error;
  const row = data as { eventId?: string; duplicate?: boolean } | null;
  if (!row?.eventId) return null;
  return { eventId: String(row.eventId), duplicate: Boolean(row.duplicate) };
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
 * Price measured tokens from the customer rate card (`quote_usage`).
 * Returns 0 when the model is unknown — we never invent a rate.
 */
export async function quoteMeasuredUsagePriceNanos(
  client: SupabaseClient,
  modelId: string | null | undefined,
  usage: MeasuredUsage,
): Promise<number> {
  if (!modelId?.trim()) return 0;
  try {
    const { data, error } = await client.rpc('quote_usage', {
      p_model_id: modelId,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cache_write_5m_tokens: usage.cacheWrite5mTokens,
      p_cache_write_1h_tokens: usage.cacheWrite1hTokens,
      p_cache_read_tokens: usage.cacheReadTokens,
      p_is_batch: false,
    });
    if (error || !data) return 0;
    const nanos = toNanos((data as { price_nanos?: unknown }).price_nanos ?? 0);
    return nanos > 0 ? nanos : 0;
  } catch {
    return 0;
  }
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
    priceNanos?: number;
  },
): void {
  const usage = input.usage;
  if (!usage || usage.totalTokens <= 0) return;
  void (async () => {
    const quoted =
      input.priceNanos != null && input.priceNanos > 0
        ? input.priceNanos
        : await quoteMeasuredUsagePriceNanos(client, input.modelId, usage);
    await recordTokenUsage(client, {
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
      priceNanos: quoted,
    });
  })().catch((err) => {
    console.error('[metering] failed to record measured token usage', {
      orgId: input.orgId,
      requestId: input.requestId,
      err,
    });
  });
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
    priceNanos: Number(raw.price_nanos ?? 0),
    createdAt: String(raw.created_at),
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

  const [{ data, error }, members] = await Promise.all([
    client
      .from('token_usage_events')
      .select(
        'id, org_id, user_id, job_id, request_id, feature, source, model_id, input_tokens, output_tokens, cache_tokens, total_tokens, price_nanos, created_at',
      )
      .eq('org_id', orgId)
      .gte('created_at', window.start)
      .lt('created_at', window.end)
      .order('created_at', { ascending: true })
      .limit(20_000),
    loadMembers(client, orgId),
  ]);

  if (error) throw error;

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(parseEventRow);
  return {
    range,
    ...aggregateTokenUsage(rows, window, members),
  };
}

/** Convert a USD estimate (video analysis) into nanodollars for the ledger. */
export function estimatedUsdToNanos(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return usdToNanos(usd);
}
