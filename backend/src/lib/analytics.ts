/**
 * Typed access to the analytics reporting functions.
 *
 * The report RPCs are SECURITY DEFINER and executable by service_role only.
 * Call them with createStaffReportClient so the service-role request carries
 * the signed-in user id. The database still requires that id to have an
 * analytics_staff row. The access probe does not use those RPCs: it reads the
 * caller's own analytics_staff row with the user JWT, which RLS already allows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
export type AnalyticsScope = 'investor' | 'internal';

export interface ExperimentVariantStats {
  variantKey: string;
  label: string;
  weight: number;
  assignments: number;
  exposures: number;
  conversions: number;
  events: number;
}

export interface ExperimentStats {
  experimentKey: string;
  name: string;
  status: string;
  description: string | null;
  variants: ExperimentVariantStats[];
}

/** 'internal' outranks 'investor'; mirrors the enum ordering in the database. */
const SCOPE_RANK: Record<AnalyticsScope, number> = { investor: 1, internal: 2 };

export function scopeAtLeast(scope: AnalyticsScope, min: AnalyticsScope): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[min];
}

export interface AnalyticsAccess {
  scope: AnalyticsScope | null;
  displayName: string | null;
  pendingAccessRequests?: number;
}

export interface SummaryPayload {
  scope: AnalyticsScope;
  /** True when internal, test, demo and comp orgs are counted. */
  includeInternal: boolean;
  range: { from: string; to: string; days: number };
  customers: {
    orgsTotal: number;
    orgsNew: number;
    orgsPaying: number;
    /** Paying orgs at the start of this month (UTC): the base for the delta. */
    orgsPayingPrev: number;
    orgsActive: number;
    /** Internal / test / comp orgs left out of every number (0 counted when included). */
    orgsExcluded: number;
    orgsGrowthMomPct: number | null;
    /** Month-over-month change in PAYING orgs. */
    payingGrowthMomPct: number | null;
  };
  users: {
    usersTotal: number;
    usersNew: number;
    usersActive: number;
    usersGrowthMomPct: number | null;
  };
  seats: {
    seatsLicensed: number;
    seatsFilled: number;
    seatUtilizationPct: number | null;
    seatsGrowthMomPct: number | null;
  };
  revenue: {
    mrrCents: number;
    arrCents: number;
    annualContractedMrrCents: number;
    annualContractedArrCents: number;
    monthlyBilledMrrCents: number;
    trialPipelineMrrCents: number;
    mrrGrowthMomPct: number | null;
    netNewMrrCents: number;
    churnedOrgsThisMonth: number;
    /** Live-mode cash, tax excluded, refunds netted. */
    collectedInRangeCents: number;
    subscriptionRevenueCents: number;
    usageRevenueCents: number;
    creditRevenueCents: number;
    /** Negative: refunds net of their tax share. */
    refundsCents: number;
    taxExcludedCents: number;
    trailing12mRevenueCents: number;
    avgMonthlySpendPerAccountCents: number | null;
    avgMonthlySpendPerSeatCents: number | null;
    arpaMrrCents: number | null;
  };
  engagement: {
    trackedHours: number;
    sessions: number;
    featuresUsed: number;
    featuresTracked: number;
    aiRequests: number;
  };
  /**
   * Internal scope only — omitted entirely for investor scope.
   * listValueCents is model cost at the customer list markup. It is NOT
   * invoiced: usage is covered by each plan's AI allowance.
   */
  unitEconomics?: {
    modelCostCents: number;
    listValueCents: number;
    modelCost30dCents: number;
  };
}

export interface MonthlyRow {
  month: string;
  newOrgs: number;
  totalOrgs: number;
  payingOrgs: number;
  activeOrgs: number;
  churnedOrgs: number;
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
  seats: number;
  mrrCents: number;
  arrCents: number;
  revenueCents: number;
  subscriptionRevenueCents: number;
  usageRevenueCents: number;
  creditRevenueCents: number;
  refundsCents: number;
  arpaCents: number | null;
  mrrGrowthPct: number | null;
  userGrowthPct: number | null;
  seatGrowthPct: number | null;
  trackedHours: number;
}

export interface FeatureRow {
  featureKey: string;
  label: string;
  area: string;
  sessions: number;
  activeMs: number;
  activeHours: number;
  users: number;
  orgs: number;
  avgSessionMinutes: number;
  sharePct: number;
  timeRank: number;
  aiRequests: number;
  lastUsedAt: string | null;
}

export interface AccountRow {
  orgId: string;
  orgName: string;
  createdAt: string;
  planCode: string;
  planName: string;
  billingInterval: string;
  /** active | past_due | trialing | canceled | comp | no_subscription | test_mode */
  status: string;
  /** Field Capture seats paid for (included + extra). */
  seats: number;
  /** Field Capture seats in use. */
  seatsUsed: number;
  members: number;
  mrrCents: number;
  arrCents: number;
  revenueInRangeCents: number;
  /** AI usage at list markup (not invoiced). */
  creditSpendCents: number;
  /** AI provider cost. */
  aiCostCents: number;
  activeHours: number;
  topFeature: string | null;
  lastActiveAt: string | null;
  internal: boolean;
  internalReason: string | null;
}

export interface InternalOrgRow {
  orgId: string;
  orgName: string;
  reason: string;
}

export interface AccountMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  workType: string | null;
  status: string;
  createdAt: string;
}

export interface AccountJob {
  id: string;
  title: string;
  status: string;
  workType: string | null;
  jobNumber: number | null;
  createdAt: string;
}

export interface AccountOrgFeature {
  featureKey: string;
  label: string;
  activeHours: number;
  sessions: number;
}

export interface AccountDetail {
  account: AccountRow;
  members: AccountMember[];
  jobs: {
    /** Live jobs (deleted excluded). */
    total: number;
    deleted: number;
    byStatus: Array<{ status: string; count: number }>;
    recent: AccountJob[];
  };
  features: AccountOrgFeature[];
}

export interface PlanMixRow {
  planCode: string;
  planName: string;
  billingInterval: string;
  orgs: number;
  seats: number;
  mrrCents: number;
  arrCents: number;
  mrrSharePct: number | null;
}

export interface RetentionRow {
  cohortMonth: string;
  cohortSize: number;
  monthOffset: number;
  activeOrgs: number;
  retentionPct: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const bool = (value: unknown): boolean => value === true || value === 'true';
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * Translate a PostgREST error into an HTTP error.
 *
 * The staff check inside a report raises `analytics_forbidden` /
 * `scope_insufficient` (SQLSTATE 42501). That is the report sentence.
 * A bare 42501 is "permission denied for function" — the role cannot execute
 * the RPC at all — and must not be described as a report the caller opened.
 * The sign-in page displays this text verbatim.
 */
export function translateAnalyticsRpcError(
  error: { message: string; code?: string },
  fallback: string,
): HttpError {
  if (/analytics_forbidden|scope_insufficient/.test(error.message ?? '')) {
    return new HttpError(403, 'You do not have access to this report.', 'analytics_forbidden');
  }
  if (error.code === '42501' || /permission denied for function/i.test(error.message ?? '')) {
    return new HttpError(
      403,
      'You do not have access to Atmosphere analytics.',
      'analytics_forbidden',
    );
  }
  if (error.code === '28000') {
    return new HttpError(401, 'Not authenticated', 'unauthorized');
  }
  return new HttpError(500, error.message, fallback);
}

function rpcError(error: { message: string; code?: string }, fallback: string): HttpError {
  return translateAnalyticsRpcError(error, fallback);
}

export async function getAccess(supabase: SupabaseClient): Promise<AnalyticsAccess> {
  const { data, error } = await supabase
    .from('analytics_staff')
    .select('scope, display_name')
    .maybeSingle();
  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message ?? '')) {
      throw new HttpError(
        403,
        'You do not have access to Atmosphere analytics.',
        'analytics_forbidden',
      );
    }
    throw new HttpError(500, error.message, 'analytics_access_failed');
  }
  const row = (data ?? {}) as { scope?: AnalyticsScope | null; display_name?: string | null };
  return { scope: row.scope ?? null, displayName: row.display_name ?? null };
}

/** Translate the analytics_summary JSONB payload. Exported for tests. */
export function mapSummary(data: unknown): SummaryPayload {
  const d = data as any;
  const summary: SummaryPayload = {
    scope: d.scope,
    includeInternal: bool(d.include_internal),
    range: { from: d.range.from, to: d.range.to, days: num(d.range.days) },
    customers: {
      orgsTotal: num(d.customers.orgs_total),
      orgsNew: num(d.customers.orgs_new),
      orgsPaying: num(d.customers.orgs_paying),
      orgsPayingPrev: num(d.customers.orgs_paying_prev),
      orgsActive: num(d.customers.orgs_active),
      orgsExcluded: num(d.customers.orgs_excluded),
      orgsGrowthMomPct: numOrNull(d.customers.orgs_growth_mom_pct),
      payingGrowthMomPct: numOrNull(d.customers.paying_growth_mom_pct),
    },
    users: {
      usersTotal: num(d.users.users_total),
      usersNew: num(d.users.users_new),
      usersActive: num(d.users.users_active),
      usersGrowthMomPct: numOrNull(d.users.users_growth_mom_pct),
    },
    seats: {
      seatsLicensed: num(d.seats.seats_licensed),
      seatsFilled: num(d.seats.seats_filled),
      seatUtilizationPct: numOrNull(d.seats.seat_utilization_pct),
      seatsGrowthMomPct: numOrNull(d.seats.seats_growth_mom_pct),
    },
    revenue: {
      mrrCents: num(d.revenue.mrr_cents),
      arrCents: num(d.revenue.arr_cents),
      annualContractedMrrCents: num(d.revenue.annual_contracted_mrr_cents),
      annualContractedArrCents: num(d.revenue.annual_contracted_arr_cents),
      monthlyBilledMrrCents: num(d.revenue.monthly_billed_mrr_cents),
      trialPipelineMrrCents: num(d.revenue.trial_pipeline_mrr_cents),
      mrrGrowthMomPct: numOrNull(d.revenue.mrr_growth_mom_pct),
      netNewMrrCents: num(d.revenue.net_new_mrr_cents),
      churnedOrgsThisMonth: num(d.revenue.churned_orgs_this_month),
      collectedInRangeCents: num(d.revenue.collected_in_range_cents),
      subscriptionRevenueCents: num(d.revenue.subscription_revenue_cents),
      usageRevenueCents: num(d.revenue.usage_revenue_cents),
      creditRevenueCents: num(d.revenue.credit_revenue_cents),
      refundsCents: num(d.revenue.refunds_cents),
      taxExcludedCents: num(d.revenue.tax_excluded_cents),
      trailing12mRevenueCents: num(d.revenue.trailing_12m_revenue_cents),
      avgMonthlySpendPerAccountCents: numOrNull(d.revenue.avg_monthly_spend_per_account_cents),
      avgMonthlySpendPerSeatCents: numOrNull(d.revenue.avg_monthly_spend_per_seat_cents),
      arpaMrrCents: numOrNull(d.revenue.arpa_mrr_cents),
    },
    engagement: {
      trackedHours: num(d.engagement.tracked_hours),
      sessions: num(d.engagement.sessions),
      featuresUsed: num(d.engagement.features_used),
      featuresTracked: num(d.engagement.features_tracked),
      aiRequests: num(d.engagement.ai_requests),
    },
  };

  if (d.unit_economics) {
    summary.unitEconomics = {
      modelCostCents: num(d.unit_economics.model_cost_cents),
      listValueCents: num(d.unit_economics.list_value_cents),
      modelCost30dCents: num(d.unit_economics.model_cost_30d_cents),
    };
  }

  return summary;
}

export async function getSummary(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  includeInternal = false,
): Promise<SummaryPayload> {
  const { data, error } = await supabase.rpc('analytics_summary', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_summary_failed');
  return mapSummary(data);
}

export async function getMonthly(
  supabase: SupabaseClient,
  months: number,
  includeInternal = false,
): Promise<MonthlyRow[]> {
  const { data, error } = await supabase.rpc('analytics_monthly', {
    p_months: months,
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_monthly_failed');
  return ((data ?? []) as any[]).map((r) => ({
    month: r.month,
    newOrgs: num(r.new_orgs),
    totalOrgs: num(r.total_orgs),
    payingOrgs: num(r.paying_orgs),
    activeOrgs: num(r.active_orgs),
    churnedOrgs: num(r.churned_orgs),
    newUsers: num(r.new_users),
    totalUsers: num(r.total_users),
    activeUsers: num(r.active_users),
    seats: num(r.seats),
    mrrCents: num(r.mrr_cents),
    arrCents: num(r.arr_cents),
    revenueCents: num(r.revenue_cents),
    subscriptionRevenueCents: num(r.subscription_revenue_cents),
    usageRevenueCents: num(r.usage_revenue_cents),
    creditRevenueCents: num(r.credit_revenue_cents),
    refundsCents: num(r.refunds_cents),
    arpaCents: numOrNull(r.arpa_cents),
    mrrGrowthPct: numOrNull(r.mrr_growth_pct),
    userGrowthPct: numOrNull(r.user_growth_pct),
    seatGrowthPct: numOrNull(r.seat_growth_pct),
    trackedHours: num(r.tracked_hours),
  }));
}

export async function getFeatures(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  includeInternal = false,
): Promise<FeatureRow[]> {
  const { data, error } = await supabase.rpc('analytics_features', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_features_failed');
  return ((data ?? []) as any[]).map((r) => ({
    featureKey: r.feature_key,
    label: r.label,
    area: r.area,
    sessions: num(r.sessions),
    activeMs: num(r.active_ms),
    activeHours: num(r.active_hours),
    users: num(r.users),
    orgs: num(r.orgs),
    avgSessionMinutes: num(r.avg_session_minutes),
    sharePct: num(r.share_pct),
    timeRank: num(r.time_rank),
    aiRequests: num(r.ai_requests),
    lastUsedAt: r.last_used_at ?? null,
  }));
}

function mapAccountRow(r: Record<string, unknown>): AccountRow {
  return {
    orgId: String(r.org_id ?? r.orgId ?? ''),
    orgName: String(r.org_name ?? r.orgName ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
    planCode: String(r.plan_code ?? r.planCode ?? 'none'),
    planName: String(r.plan_name ?? r.planName ?? 'No plan'),
    billingInterval: String(r.billing_interval ?? r.billingInterval ?? 'monthly'),
    status: String(r.status ?? 'no_subscription'),
    seats: num(r.seats),
    seatsUsed: num(r.seats_used ?? r.seatsUsed),
    members: num(r.members),
    mrrCents: num(r.mrr_cents ?? r.mrrCents),
    arrCents: num(r.arr_cents ?? r.arrCents),
    revenueInRangeCents: num(r.revenue_in_range_cents ?? r.revenueInRangeCents),
    creditSpendCents: num(r.credit_spend_cents ?? r.creditSpendCents),
    aiCostCents: num(r.ai_cost_cents ?? r.aiCostCents),
    activeHours: num(r.active_hours ?? r.activeHours),
    topFeature:
      (r.top_feature as string | null | undefined) ??
      (r.topFeature as string | null) ??
      null,
    lastActiveAt:
      (r.last_active_at as string | null | undefined) ?? (r.lastActiveAt as string | null) ?? null,
    internal: bool(r.internal),
    internalReason:
      (r.internal_reason as string | null | undefined) ?? (r.internalReason as string | null) ?? null,
  };
}

export async function getAccounts(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  limit: number,
  includeInternal = false,
): Promise<AccountRow[]> {
  const { data, error } = await supabase.rpc('analytics_accounts', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_limit: limit,
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_accounts_failed');
  return ((data ?? []) as any[]).map((r) => mapAccountRow(r));
}

/** Orgs left out of reports by default (internal / test / demo / comp). */
export async function getInternalOrgs(supabase: SupabaseClient): Promise<InternalOrgRow[]> {
  const { data, error } = await supabase.rpc('analytics_internal_orgs');
  if (error) throw rpcError(error, 'analytics_internal_orgs_failed');
  return ((data ?? []) as any[]).map((r) => ({
    orgId: String(r.org_id),
    orgName: String(r.org_name ?? ''),
    reason: String(r.reason ?? ''),
  }));
}

/** Translate the analytics_account_detail JSONB payload. Exported for tests. */
export function mapAccountDetail(data: unknown): AccountDetail | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const accountRaw = d.account;
  if (!accountRaw || typeof accountRaw !== 'object') return null;

  const membersRaw = Array.isArray(d.members) ? d.members : [];
  const jobsRaw =
    d.jobs && typeof d.jobs === 'object' ? (d.jobs as Record<string, unknown>) : {};
  const byStatusRaw = Array.isArray(jobsRaw.byStatus) ? jobsRaw.byStatus : [];
  const recentRaw = Array.isArray(jobsRaw.recent) ? jobsRaw.recent : [];
  const featuresRaw = Array.isArray(d.features) ? d.features : [];

  return {
    account: mapAccountRow(accountRaw as Record<string, unknown>),
    members: membersRaw.map((row) => {
      const m = (row ?? {}) as Record<string, unknown>;
      return {
        userId: String(m.userId ?? m.user_id ?? ''),
        email: (m.email as string | null) ?? null,
        fullName: (m.fullName as string | null) ?? (m.full_name as string | null) ?? null,
        role: String(m.role ?? ''),
        workType: (m.workType as string | null) ?? (m.work_type as string | null) ?? null,
        status: String(m.status ?? 'active'),
        createdAt: String(m.createdAt ?? m.created_at ?? ''),
      };
    }),
    jobs: {
      total: num(jobsRaw.total),
      deleted: num(jobsRaw.deleted),
      byStatus: byStatusRaw.map((row) => {
        const s = (row ?? {}) as Record<string, unknown>;
        return { status: String(s.status ?? ''), count: num(s.count) };
      }),
      recent: recentRaw.map((row) => {
        const j = (row ?? {}) as Record<string, unknown>;
        const jobNumber = j.jobNumber ?? j.job_number;
        return {
          id: String(j.id ?? ''),
          title: String(j.title ?? ''),
          status: String(j.status ?? ''),
          workType: (j.workType as string | null) ?? (j.work_type as string | null) ?? null,
          jobNumber: jobNumber === null || jobNumber === undefined ? null : Number(jobNumber),
          createdAt: String(j.createdAt ?? j.created_at ?? ''),
        };
      }),
    },
    features: featuresRaw.map((row) => {
      const f = (row ?? {}) as Record<string, unknown>;
      return {
        featureKey: String(f.featureKey ?? f.feature_key ?? ''),
        label: String(f.label ?? f.featureKey ?? ''),
        activeHours: num(f.activeHours ?? f.active_hours),
        sessions: num(f.sessions),
      };
    }),
  };
}

export async function getAccountDetail(
  supabase: SupabaseClient,
  orgId: string,
  from: Date,
  to: Date,
): Promise<AccountDetail | null> {
  const { data, error } = await supabase.rpc('analytics_account_detail', {
    p_org_id: orgId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw rpcError(error, 'analytics_account_detail_failed');
  return mapAccountDetail(data);
}

export async function getPlanMix(
  supabase: SupabaseClient,
  includeInternal = false,
): Promise<PlanMixRow[]> {
  const { data, error } = await supabase.rpc('analytics_plan_mix', {
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_plan_mix_failed');
  return ((data ?? []) as any[]).map((r) => ({
    planCode: r.plan_code,
    planName: r.plan_name,
    billingInterval: r.billing_interval,
    orgs: num(r.orgs),
    seats: num(r.seats),
    mrrCents: num(r.mrr_cents),
    arrCents: num(r.arr_cents),
    mrrSharePct: numOrNull(r.mrr_share_pct),
  }));
}

export async function getRetention(
  supabase: SupabaseClient,
  months: number,
  includeInternal = false,
): Promise<RetentionRow[]> {
  const { data, error } = await supabase.rpc('analytics_retention', {
    p_months: months,
    p_include_internal: includeInternal,
  });
  if (error) throw rpcError(error, 'analytics_retention_failed');
  return ((data ?? []) as any[]).map((r) => ({
    cohortMonth: r.cohort_month,
    cohortSize: num(r.cohort_size),
    monthOffset: num(r.month_offset),
    activeOrgs: num(r.active_orgs),
    retentionPct: numOrNull(r.retention_pct),
  }));
}

export async function getExperiments(
  _supabase: SupabaseClient,
  _from: Date,
  _to: Date,
): Promise<ExperimentStats[]> {
  // analytics_experiments / experiments* dropped
  return [];
}

/** Everything a dashboard needs, in one round trip. */
export interface OverviewPayload {
  scope: AnalyticsScope;
  generatedAt: string;
  includeInternal: boolean;
  range: { from: string; to: string };
  summary: SummaryPayload;
  monthly: MonthlyRow[];
  features: FeatureRow[];
  planMix: PlanMixRow[];
  retention: RetentionRow[];
  accounts: AccountRow[] | null;
}

export async function getOverview(
  supabase: SupabaseClient,
  scope: AnalyticsScope,
  from: Date,
  to: Date,
  months: number,
  includeInternal = false,
): Promise<OverviewPayload> {
  const isInternal = scopeAtLeast(scope, 'internal');

  const [summary, monthly, features, planMix, retention, accounts] = await Promise.all([
    getSummary(supabase, from, to, includeInternal),
    getMonthly(supabase, months, includeInternal),
    getFeatures(supabase, from, to, includeInternal),
    getPlanMix(supabase, includeInternal),
    getRetention(supabase, Math.min(months, 12), includeInternal),
    // Per-customer detail never leaves the building for investor scope.
    isInternal ? getAccounts(supabase, from, to, 500, includeInternal) : Promise.resolve(null),
  ]);

  return {
    scope,
    generatedAt: new Date().toISOString(),
    includeInternal,
    range: { from: from.toISOString(), to: to.toISOString() },
    summary,
    monthly,
    features,
    planMix,
    retention,
    accounts,
  };
}
