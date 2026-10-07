/**
 * Billing period aggregation — customer summary and period close.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerMeteringSummary, MeteringPeriodCalculation } from './types.js';
import { RATE_CARD_VERIFIED_AT } from './modelPriceTable.js';
import { eventAmounts } from './pricing.js';
import { collectPaged, TOKEN_USAGE_PAGE } from './tokenUsage.js';

export async function calculateMeteringPeriod(
  client: SupabaseClient,
  orgId: string,
  periodStart?: string,
): Promise<MeteringPeriodCalculation> {
  const { data, error } = await client.rpc('calculate_metering_period', {
    p_org: orgId,
    p_period_start: periodStart ?? null,
  });
  if (error) throw error;
  return data as MeteringPeriodCalculation;
}

/**
 * Customer-facing usage summary for the caller's org.
 *
 * `customer_metering_summary` is EXECUTE-granted to the service role only, so
 * a user-JWT call is refused ("permission denied") and Settings › Billing showed
 * no summary. This reads it with the service role instead:
 *   - `orgId` must be the org the backend resolved from the caller's own
 *     membership (requireOrg), never a value from the request.
 *   - `userId` must be the caller's id from the verified JWT.
 *   - The database checks again: `customer_metering_summary_for_member` raises
 *     42501 unless `userId` is a member of `orgId`.
 */
export async function getCustomerMeteringSummary(
  serviceClient: SupabaseClient | null,
  orgId: string,
  userId: string,
): Promise<CustomerMeteringSummary> {
  if (!serviceClient) {
    throw Object.assign(new Error('Billing summary needs the backend service role.'), {
      code: 'service_role_unavailable',
    });
  }
  if (!orgId || !userId) {
    throw Object.assign(new Error('Billing summary needs an org and a signed-in user.'), {
      code: '42501',
    });
  }
  const { data, error } = await serviceClient.rpc('customer_metering_summary_for_member', {
    p_org: orgId,
    p_user: userId,
  });
  if (error) throw error;
  return data as CustomerMeteringSummary;
}

export async function closeMeteringPeriod(
  client: SupabaseClient,
  orgId: string,
  periodStart?: string,
): Promise<{ statementId: string; summary: MeteringPeriodCalculation }> {
  const { data, error } = await client.rpc('close_metering_period', {
    p_org: orgId,
    p_period_start: periodStart ?? null,
  });
  if (error) throw error;
  const row = data as { statementId: string; summary: MeteringPeriodCalculation };
  return row;
}

/**
 * Metering report. Reads token_usage_events (the real ledger) since
 * 20261007230000; private.ai_usage_events was never written in production.
 */
export async function getAdminMeteringAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
  includeInternal = false,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc('admin_metering_analytics', {
    p_from: from,
    p_to: to,
    p_include_internal: includeInternal,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** A ledger row that has tokens but no stored cost or price. */
export interface UnpricedLedgerRow {
  id: string;
  org_id: string;
  user_id: string | null;
  model_id: string | null;
  feature: string | null;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_tokens: number | string;
  cache_read_tokens?: number | string | null;
  cache_write_5m_tokens?: number | string | null;
  cache_write_1h_tokens?: number | string | null;
  created_at: string;
}

type Bucket = Record<string, unknown> & { priceNanos?: number | string; costNanos?: number | string };

function addNanos(row: Bucket | undefined, priceNanos: number, costNanos: number): void {
  if (!row) return;
  row.priceNanos = Number(row.priceNanos ?? 0) + priceNanos;
  if ('costNanos' in row) row.costNanos = Number(row.costNanos ?? 0) + costNanos;
}

/** "Rolling 30 days" when the window ends now-ish and is a whole number of days. */
export function tokenUsageWindowLabel(from: string, to: string, now: Date = new Date()): string {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 'Custom range (UTC)';
  const days = Math.round((toMs - fromMs) / 86_400_000);
  const endsNow = Math.abs(now.getTime() - toMs) < 36 * 3_600_000;
  if (endsNow && days >= 1) return `Rolling ${days} day${days === 1 ? '' : 's'} (UTC)`;
  return `${new Date(fromMs).toISOString().slice(0, 10)} to ${new Date(toMs).toISOString().slice(0, 10)} (UTC)`;
}

/**
 * Apply the shared pricing rule (metering/pricing.ts → eventAmounts) to rows
 * the SQL report summed at $0. Settings › Billing prices the same rows with
 * the same function, so for one org and one window the two figures match.
 * Mutates and returns the report.
 */
export function applySharedPricingToTokenReport(
  report: Record<string, unknown>,
  unpriced: UnpricedLedgerRow[],
  window: { from: string; to: string; now?: Date },
): Record<string, unknown> {
  const totals = (report.totals ?? {}) as Bucket;
  const byCustomer = (report.byCustomer ?? []) as Bucket[];
  const byUser = (report.byUser ?? []) as Bucket[];
  const byModel = (report.byModel ?? []) as Bucket[];
  const byFeature = (report.byFeature ?? []) as Bucket[];
  let repricedEvents = 0;
  const stillUnpriced = new Map<string, number>();
  for (const row of unpriced) {
    const amounts = eventAmounts({
      priceNanos: 0,
      costNanos: 0,
      modelId: row.model_id,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheTokens: Number(row.cache_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheWrite5mTokens: Number(row.cache_write_5m_tokens ?? 0),
      cacheWrite1hTokens: Number(row.cache_write_1h_tokens ?? 0),
      createdAt: row.created_at,
    });
    if (amounts.priceNanos <= 0) {
      const key = row.model_id?.trim() || '(unknown)';
      stillUnpriced.set(key, (stillUnpriced.get(key) ?? 0) + 1);
      continue;
    }
    repricedEvents += 1;
    addNanos(totals, amounts.priceNanos, amounts.costNanos);
    addNanos(byCustomer.find((c) => c.orgId === row.org_id), amounts.priceNanos, amounts.costNanos);
    if (row.user_id) {
      addNanos(byUser.find((u) => u.userId === row.user_id && u.orgId === row.org_id), amounts.priceNanos, amounts.costNanos);
    }
    const model = row.model_id?.trim() || '(unknown)';
    addNanos(byModel.find((m) => m.model === model), amounts.priceNanos, amounts.costNanos);
    addNanos(byFeature.find((f) => f.feature === row.feature), amounts.priceNanos, amounts.costNanos);
  }
  const unpricedEvents = [...stillUnpriced.values()].reduce((a, b) => a + b, 0);
  report.window = {
    from: window.from,
    to: window.to,
    label: tokenUsageWindowLabel(window.from, window.to, window.now),
    timeZone: 'UTC',
  };
  report.pricing = {
    rule: 'price = provider cost × customer markup (same rule as Settings › Billing)',
    rateCardVerifiedAt: RATE_CARD_VERIFIED_AT,
  };
  report.health = {
    // Rows that had tokens but $0 stored, re-priced here from the rate card.
    repricedEvents,
    // Rows with tokens whose model has no price. Should always be 0 — alert when not.
    unpricedEvents,
    unpricedModels: [...stillUnpriced.entries()].map(([model, events]) => ({ model, events })),
    ok: unpricedEvents === 0,
  };
  return report;
}

/** Org ids left out of reports by default (internal / test / demo / comp). */
export async function loadInternalOrgIds(client: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await client.rpc('analytics_internal_orgs');
  if (error) {
    // Pre-migration database: nothing is flagged yet, so nothing extra to drop.
    console.warn('[analytics] internal org list unavailable:', error.message);
    return new Set<string>();
  }
  return new Set(((data ?? []) as Array<{ org_id: string }>).map((r) => String(r.org_id)));
}

/** Drop ledger rows from internal orgs unless the toggle includes them. */
export function scopeUnpricedRows(
  rows: UnpricedLedgerRow[],
  internalOrgIds: Set<string>,
  includeInternal: boolean,
): UnpricedLedgerRow[] {
  if (includeInternal || internalOrgIds.size === 0) return rows;
  return rows.filter((row) => !internalOrgIds.has(row.org_id));
}

/**
 * Global token ledger for Internal Growth Metrics (token_usage_events).
 * priceNanos is list value (cost x customer markup), not an invoiced amount.
 */
export async function getAdminTokenUsageAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
  includeInternal = false,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc('admin_token_usage_analytics', {
    p_from: from,
    p_to: to,
    p_include_internal: includeInternal,
  });
  if (error) throw error;
  const report = (data ?? {}) as Record<string, unknown>;
  const internalOrgIds = includeInternal ? new Set<string>() : await loadInternalOrgIds(client);
  const unpriced = await collectPaged<UnpricedLedgerRow>(TOKEN_USAGE_PAGE, async (lo, hi) => {
    const { data: rows, error: rowsError } = await client
      .from('token_usage_events')
      .select(
        'id, org_id, user_id, model_id, feature, input_tokens, output_tokens, cache_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, created_at',
      )
      .eq('cost_nanos', 0)
      .eq('price_nanos', 0)
      .gt('total_tokens', 0)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi);
    if (rowsError) throw rowsError;
    return (rows ?? []) as UnpricedLedgerRow[];
  });
  return applySharedPricingToTokenReport(report, scopeUnpricedRows(unpriced, internalOrgIds, includeInternal), {
    from,
    to,
  });
}
