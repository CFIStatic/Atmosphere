/**
 * Billing period aggregation — customer summary and period close.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerMeteringSummary, MeteringPeriodCalculation } from './types.js';

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

export async function getCustomerMeteringSummary(
  client: SupabaseClient,
  orgId: string,
): Promise<CustomerMeteringSummary> {
  const { data, error } = await client.rpc('customer_metering_summary', { p_org: orgId });
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

export async function getAdminMeteringAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc('admin_metering_analytics', {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}
