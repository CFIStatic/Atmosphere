import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getCustomerMeteringSummary } from '../metering/periodAggregation.js';
import type { CustomerMeteringSummary } from '../metering/types.js';
import { billingOnboardingGate } from './signupOnboarding.js';

export interface WorkspacePlan {
  name: string;
  baseMonthlyFeeCents: number;
  includedJobs: number;
  additionalJobPriceCents: number;
}

export interface WorkspaceSubscription extends WorkspacePlan {
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeSubscription: boolean;
}

export interface WorkspaceBilling {
  paymentProvider: 'stripe' | 'dev' | 'manual';
  canManage: boolean;
  required: boolean;
  complete: boolean;
  isCreator: boolean;
  subscription: WorkspaceSubscription;
  usage: CustomerMeteringSummary | null;
}

const DEFAULT_PLAN: WorkspacePlan = {
  name: 'Work Verification',
  baseMonthlyFeeCents: 59900,
  includedJobs: 50,
  additionalJobPriceCents: 3000,
};

export function planFromMeteringRow(meteringRow: unknown): WorkspacePlan {
  const row = meteringRow as {
    metering_plan_versions?: {
      base_monthly_fee_cents?: number;
      included_jobs?: number;
      additional_job_price_cents?: number;
      metering_plans?: { name?: string } | Array<{ name?: string }>;
    } | Array<{
      base_monthly_fee_cents?: number;
      included_jobs?: number;
      additional_job_price_cents?: number;
      metering_plans?: { name?: string } | Array<{ name?: string }>;
    }>;
  } | null;

  const version = Array.isArray(row?.metering_plan_versions)
    ? row.metering_plan_versions[0]
    : row?.metering_plan_versions;
  if (!version) return { ...DEFAULT_PLAN };

  const plan = Array.isArray(version.metering_plans)
    ? version.metering_plans[0]
    : version.metering_plans;

  return {
    name: plan?.name || DEFAULT_PLAN.name,
    baseMonthlyFeeCents: version.base_monthly_fee_cents ?? DEFAULT_PLAN.baseMonthlyFeeCents,
    includedJobs: version.included_jobs ?? DEFAULT_PLAN.includedJobs,
    additionalJobPriceCents: version.additional_job_price_cents ?? DEFAULT_PLAN.additionalJobPriceCents,
  };
}

export async function loadWorkspaceBilling(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<WorkspaceBilling> {
  const paymentProvider = config.billing.paymentProvider;

  const [{ data: org }, { data: billing }, { data: overview }, { data: meteringRow }] =
    await Promise.all([
      supabase.from('orgs').select('created_by').eq('id', orgId).maybeSingle(),
      supabase
        .from('org_billing')
        .select('stripe_subscription_id, status, period_start, period_end, cancel_at_period_end')
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase.rpc('billing_overview', { p_org: orgId }),
      supabase
        .from('org_metering')
        .select(
          'plan_version_id, metering_plan_versions(base_monthly_fee_cents, included_jobs, additional_job_price_cents, metering_plans(name), stripe_price_id)',
        )
        .eq('org_id', orgId)
        .maybeSingle(),
    ]);

  const isCreator = org?.created_by === userId;
  const gate = billingOnboardingGate({
    paymentProvider,
    isCreator,
    subscriptionId: billing?.stripe_subscription_id,
    subscriptionStatus: billing?.status,
  });
  const plan = planFromMeteringRow(meteringRow);

  let usage: CustomerMeteringSummary | null = null;
  try {
    usage = await getCustomerMeteringSummary(supabase, orgId);
  } catch (err) {
    console.warn('[billing] metering summary unavailable:', (err as Error).message);
  }

  return {
    paymentProvider,
    canManage: Boolean((overview as { can_manage?: boolean } | null)?.can_manage),
    required: gate.required,
    complete: gate.complete,
    isCreator,
    subscription: {
      ...plan,
      status: (billing?.status as string | undefined) ?? 'incomplete',
      periodStart: (billing?.period_start as string | null | undefined) ?? usage?.periodStart ?? null,
      periodEnd: (billing?.period_end as string | null | undefined) ?? usage?.periodEnd ?? null,
      cancelAtPeriodEnd: Boolean(billing?.cancel_at_period_end),
      hasStripeSubscription: gate.hasSubscription,
    },
    usage,
  };
}

export async function resolveOnboardingPriceId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data: meteringRow } = await supabase
    .from('org_metering')
    .select('metering_plan_versions(stripe_price_id)')
    .eq('org_id', orgId)
    .maybeSingle();

  const version = Array.isArray((meteringRow as { metering_plan_versions?: unknown } | null)?.metering_plan_versions)
    ? (meteringRow as { metering_plan_versions: Array<{ stripe_price_id?: string }> }).metering_plan_versions[0]
    : (meteringRow as { metering_plan_versions?: { stripe_price_id?: string } } | null)?.metering_plan_versions;
  const fromPlan = version?.stripe_price_id ?? null;
  if (fromPlan) return fromPlan;
  return config.stripe.onboardingPriceId || null;
}
