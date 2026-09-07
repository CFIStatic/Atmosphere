import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getCustomerMeteringSummary } from '../metering/periodAggregation.js';
import type { CustomerMeteringSummary } from '../metering/types.js';
import { loadFieldCaptureSeatUsage, type FieldCaptureSeatUsage } from './fieldCaptureSeats.js';
import {
  EXTRA_FC_SEAT_MONTHLY_CENTS,
  INCLUDED_FC_SEATS,
  atmospherePlan,
  includedFcSeatsForPlan,
  selfServePlanList,
  type AtmosphereSelfServePlan,
} from './stripeCatalog.js';
import { resolveSelfServePriceId } from './stripe.js';
import { isBillingExemptEmail, isBillingExemptOrg, loadOrgCreatorEmail } from './billingExempt.js';
import { billingOnboardingGate } from './signupOnboarding.js';

export interface WorkspacePlan {
  code: string;
  name: string;
  baseMonthlyFeeCents: number;
  includedJobs: number;
  additionalJobPriceCents: number;
  includedFcSeats: number;
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
  /** Complimentary / allowlisted — hide Stripe Manage and paid seat CTAs. */
  billingExempt: boolean;
  required: boolean;
  complete: boolean;
  isCreator: boolean;
  subscription: WorkspaceSubscription;
  usage: CustomerMeteringSummary | null;
  fieldCaptureSeats: FieldCaptureSeatUsage & { extraSeatPriceCents: number };
}

const DEFAULT_PLAN: WorkspacePlan = {
  code: atmospherePlan().code,
  name: atmospherePlan().name,
  baseMonthlyFeeCents: atmospherePlan().monthlyCents,
  includedJobs: 50,
  additionalJobPriceCents: 3000,
  includedFcSeats: INCLUDED_FC_SEATS,
};

export function publicSelfServePlans(): Array<
  AtmosphereSelfServePlan & { defaultSelected: boolean }
> {
  return selfServePlanList().map((plan) => ({
    ...plan,
    defaultSelected: plan.recommended,
  }));
}

export function planFromMeteringRow(
  meteringRow: unknown,
  atmosphere?: { planCode?: string | null; includedFcSeats?: number | null },
): WorkspacePlan {
  const catalog = atmospherePlan(atmosphere?.planCode);
  const included = includedFcSeatsForPlan(catalog.code, atmosphere?.includedFcSeats);
  const row = meteringRow as {
    metering_plan_versions?: {
      base_monthly_fee_cents?: number;
      included_jobs?: number;
      additional_job_price_cents?: number;
      metering_plans?: { name?: string; code?: string } | Array<{ name?: string; code?: string }>;
    } | Array<{
      base_monthly_fee_cents?: number;
      included_jobs?: number;
      additional_job_price_cents?: number;
      metering_plans?: { name?: string; code?: string } | Array<{ name?: string; code?: string }>;
    }>;
  } | null;

  const version = Array.isArray(row?.metering_plan_versions)
    ? row.metering_plan_versions[0]
    : row?.metering_plan_versions;
  if (!version) {
    return {
      ...DEFAULT_PLAN,
      code: catalog.code,
      name: catalog.name,
      baseMonthlyFeeCents: catalog.monthlyCents,
      includedFcSeats: included,
    };
  }

  const plan = Array.isArray(version.metering_plans)
    ? version.metering_plans[0]
    : version.metering_plans;
  const meteringCode = plan?.code ?? null;
  const useCatalogPrice =
    Boolean(atmosphere?.planCode) || meteringCode !== catalog.code || !version.base_monthly_fee_cents;

  return {
    code: catalog.code,
    name: catalog.name || plan?.name || DEFAULT_PLAN.name,
    baseMonthlyFeeCents: useCatalogPrice
      ? catalog.monthlyCents
      : (version.base_monthly_fee_cents ?? catalog.monthlyCents),
    includedJobs: version.included_jobs ?? DEFAULT_PLAN.includedJobs,
    additionalJobPriceCents: version.additional_job_price_cents ?? DEFAULT_PLAN.additionalJobPriceCents,
    includedFcSeats: included,
  };
}

export async function loadWorkspaceBilling(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  userEmail?: string | null,
): Promise<WorkspaceBilling> {
  const paymentProvider = config.billing.paymentProvider;

  const billingQuery = supabase
    .from('org_billing')
    .select(
      'stripe_subscription_id, status, period_start, period_end, cancel_at_period_end, atmosphere_plan_code, included_fc_seats',
    )
    .eq('org_id', orgId)
    .maybeSingle();

  const [{ data: org }, billingResult, { data: overview }, { data: meteringRow }, { data: profile }] =
    await Promise.all([
      supabase.from('orgs').select('created_by').eq('id', orgId).maybeSingle(),
      billingQuery,
      supabase.rpc('billing_overview', { p_org: orgId }),
      supabase
        .from('org_metering')
        .select(
          'plan_version_id, metering_plan_versions(base_monthly_fee_cents, included_jobs, additional_job_price_cents, metering_plans(name, code), stripe_price_id)',
        )
        .eq('org_id', orgId)
        .maybeSingle(),
      userEmail
        ? Promise.resolve({ data: { email: userEmail } })
        : supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
    ]);

  let billing = billingResult.data;
  if (
    billingResult.error &&
    /atmosphere_plan_code|included_fc_seats|column .* does not exist/i.test(billingResult.error.message)
  ) {
    const fallback = await supabase
      .from('org_billing')
      .select('stripe_subscription_id, status, period_start, period_end, cancel_at_period_end')
      .eq('org_id', orgId)
      .maybeSingle();
    billing = fallback.data;
  }

  const billingRow = (billing ?? null) as {
    stripe_subscription_id?: string | null;
    status?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    cancel_at_period_end?: boolean | null;
    atmosphere_plan_code?: string | null;
    included_fc_seats?: number | null;
  } | null;

  const isCreator = org?.created_by === userId;
  const email = userEmail ?? (profile as { email?: string | null } | null)?.email ?? null;
  const creatorEmail = isCreator ? email : await loadOrgCreatorEmail(supabase, orgId);
  const billingExempt = isBillingExemptOrg({
    status: billingRow?.status,
    subscriptionId: billingRow?.stripe_subscription_id,
    creatorEmail,
    actingUserEmail: email,
  });
  const exempt = isBillingExemptEmail(email) || billingExempt;
  const gate = billingOnboardingGate({
    paymentProvider,
    isCreator,
    subscriptionId: billingRow?.stripe_subscription_id,
    subscriptionStatus: billingRow?.status,
    exempt,
  });
  const plan = planFromMeteringRow(meteringRow, {
    planCode: billingRow?.atmosphere_plan_code,
    includedFcSeats: billingRow?.included_fc_seats,
  });

  let usage: CustomerMeteringSummary | null = null;
  try {
    usage = await getCustomerMeteringSummary(supabase, orgId);
  } catch (err) {
    console.warn('[billing] metering summary unavailable:', (err as Error).message);
  }

  let fieldCaptureSeats = {
    included: plan.includedFcSeats,
    extra: 0,
    allowed: plan.includedFcSeats,
    used: 0,
    remaining: plan.includedFcSeats,
    extraSeatPriceCents: EXTRA_FC_SEAT_MONTHLY_CENTS,
  };
  try {
    fieldCaptureSeats = {
      ...(await loadFieldCaptureSeatUsage(supabase, orgId, { actingUserEmail: email })),
      extraSeatPriceCents: EXTRA_FC_SEAT_MONTHLY_CENTS,
    };
  } catch (err) {
    console.warn('[billing] Field Capture seat usage unavailable:', (err as Error).message);
  }

  return {
    paymentProvider,
    canManage: Boolean((overview as { can_manage?: boolean } | null)?.can_manage),
    billingExempt,
    required: gate.required,
    complete: gate.complete,
    isCreator,
    subscription: {
      ...plan,
      includedFcSeats: fieldCaptureSeats.included || plan.includedFcSeats,
      status: billingExempt
        ? 'comped'
        : ((billingRow?.status as string | undefined) ?? 'incomplete'),
      periodStart: billingRow?.period_start ?? usage?.periodStart ?? null,
      periodEnd: billingRow?.period_end ?? usage?.periodEnd ?? null,
      cancelAtPeriodEnd: Boolean(billingRow?.cancel_at_period_end),
      hasStripeSubscription: gate.hasSubscription,
    },
    usage,
    fieldCaptureSeats,
  };
}

export async function resolveOnboardingPriceId(
  supabase: SupabaseClient,
  orgId: string,
  planCode?: string | null,
): Promise<string | null> {
  const fromEnv = resolveSelfServePriceId(planCode);
  if (planCode && planCode !== 'work_verification') {
    return fromEnv;
  }

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
  return fromEnv;
}
