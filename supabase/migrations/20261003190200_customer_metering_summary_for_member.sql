-- Settings > Billing usage summary: let the backend read it with the service
-- role, scoped to the caller's org and checked in the database.
--
-- Production grants EXECUTE on customer_metering_summary and
-- calculate_metering_period to service_role only (see
-- 20260923200000_lock_down_security_definer_grants). The backend called the
-- summary with the user's JWT, so every Billing load logged
-- "permission denied for function customer_metering_summary" and the summary
-- card was left empty. A plain service-role call does not work either: both
-- functions check private.is_org_member(), which reads auth.uid(), and that
-- is null for the service role.
--
-- This migration:
--   1. Moves the period calculation into private.calculate_metering_period_unchecked
--      (same body, without the membership check). Not granted to anyone.
--   2. Recreates calculate_metering_period and customer_metering_summary as
--      thin wrappers: the auth.uid() membership check, then the shared code.
--      Their results and grants do not change.
--   3. Adds customer_metering_summary_for_member(p_org, p_user): service role
--      only. It refuses (42501) unless p_user is a member of p_org in
--      public.org_members, then returns the same summary.
-- The backend passes the org it resolved from the caller's own membership
-- (requireOrg) and the caller's user id from the verified JWT.

create or replace function private.calculate_metering_period_unchecked(
  p_org uuid,
  p_period_start date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_bounds record;
  v_terms jsonb;
  v_jobs integer;
  v_included_jobs integer;
  v_excess_jobs integer;
  v_cu_total numeric;
  v_cu_included numeric;
  v_cu_excess numeric;
  v_video_seconds numeric;
  v_base_cents integer;
  v_job_overage_cents integer;
  v_cu_overage_nanos bigint;
  v_cu_overage_charge_nanos bigint;
  v_video_charge_cents integer;
  v_customer_charge_cents integer;
  v_ai_cost_nanos bigint;
  v_gross_profit_nanos bigint;
  v_margin_pct numeric;
begin
  select * into v_bounds from private.metering_period_bounds(p_org, coalesce(p_period_start::timestamptz, now()));
  if p_period_start is not null then
    v_bounds.period_start := p_period_start;
    v_bounds.period_end := (p_period_start + interval '1 month')::date;
  end if;

  v_terms := private.org_metering_terms(p_org);
  if v_terms is null then
    raise exception 'no_metering_plan' using errcode = 'P0002';
  end if;

  select count(*)::int into v_jobs
  from public.billing_period_jobs
  where org_id = p_org
    and period_start = v_bounds.period_start;

  v_included_jobs := (v_terms->>'includedJobs')::int;
  v_excess_jobs := greatest(v_jobs - v_included_jobs, 0);

  select coalesce(sum(compute_units), 0), coalesce(sum(estimated_provider_cost_nanos), 0)
  into v_cu_total, v_ai_cost_nanos
  from private.ai_usage_events
  where org_id = p_org
    and billable
    and created_at >= v_bounds.period_start::timestamptz
    and created_at < v_bounds.period_end::timestamptz;

  v_cu_included := (v_terms->>'includedComputeUnits')::numeric;
  v_cu_excess := greatest(v_cu_total - v_cu_included, 0);

  select coalesce(sum(video_seconds), 0) into v_video_seconds
  from private.ai_usage_events
  where org_id = p_org
    and billable
    and created_at >= v_bounds.period_start::timestamptz
    and created_at < v_bounds.period_end::timestamptz;

  v_base_cents := (v_terms->>'baseMonthlyFeeCents')::int;
  v_job_overage_cents := v_excess_jobs * (v_terms->>'additionalJobPriceCents')::int;
  v_cu_overage_nanos := (v_terms->>'computeUnitOverageNanos')::bigint;
  v_cu_overage_charge_nanos := round(v_cu_excess * v_cu_overage_nanos)::bigint;

  if (v_terms->>'videoHourPriceCents') is not null then
    v_video_charge_cents := round((v_video_seconds / 3600.0) * (v_terms->>'videoHourPriceCents')::int)::int;
  else
    v_video_charge_cents := 0;
  end if;

  v_customer_charge_cents := v_base_cents + v_job_overage_cents
    + round(v_cu_overage_charge_nanos / 10000000.0)::int
    + v_video_charge_cents;

  v_gross_profit_nanos := private.usd_to_nanos(v_customer_charge_cents / 100.0) - v_ai_cost_nanos;
  if v_customer_charge_cents > 0 then
    v_margin_pct := round((v_gross_profit_nanos::numeric / nullif(private.usd_to_nanos(v_customer_charge_cents / 100.0), 0)) * 100, 2);
  else
    v_margin_pct := null;
  end if;

  return jsonb_build_object(
    'periodStart', v_bounds.period_start,
    'periodEnd', v_bounds.period_end,
    'terms', v_terms,
    'processedJobs', v_jobs,
    'includedJobs', v_included_jobs,
    'excessJobs', v_excess_jobs,
    'jobOverageChargeCents', v_job_overage_cents,
    'computeUnitsConsumed', v_cu_total,
    'includedComputeUnits', v_cu_included,
    'excessComputeUnits', v_cu_excess,
    'computeOverageChargeCents', round(v_cu_overage_charge_nanos / 10000000.0)::int,
    'videoVerificationHours', round(v_video_seconds / 3600.0, 2),
    'videoProcessingChargeCents', v_video_charge_cents,
    'basePlatformChargeCents', v_base_cents,
    'estimatedAiCostCents', round(v_ai_cost_nanos / 10000000.0)::int,
    'estimatedGrossProfitCents', round(v_gross_profit_nanos / 10000000.0)::int,
    'estimatedGrossMarginPct', v_margin_pct,
    'estimatedCustomerChargeCents', v_customer_charge_cents
  );
end;
$$;

revoke all on function private.calculate_metering_period_unchecked(uuid, date) from public, anon, authenticated;

-- Customer-facing projection (no costs or margin). Shared by both entry points.
create or replace function private.customer_metering_summary_unchecked(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_calc jsonb;
begin
  v_calc := private.calculate_metering_period_unchecked(p_org, null);

  return jsonb_build_object(
    'periodStart', v_calc->'periodStart',
    'periodEnd', v_calc->'periodEnd',
    'planName', v_calc->'terms'->'planName',
    'processedJobs', v_calc->'processedJobs',
    'includedJobs', v_calc->'includedJobs',
    'excessJobs', v_calc->'excessJobs',
    'videoVerificationHours', v_calc->'videoVerificationHours',
    'computeOverage', case when (v_calc->>'excessComputeUnits')::numeric > 0
      then jsonb_build_object(
        'units', v_calc->'excessComputeUnits',
        'chargeCents', v_calc->'computeOverageChargeCents'
      ) else null end,
    'basePlatformChargeCents', v_calc->'basePlatformChargeCents',
    'jobOverageChargeCents', v_calc->'jobOverageChargeCents',
    'videoProcessingChargeCents', v_calc->'videoProcessingChargeCents',
    'estimatedUpcomingBillCents', v_calc->'estimatedCustomerChargeCents'
  );
end;
$$;

revoke all on function private.customer_metering_summary_unchecked(uuid) from public, anon, authenticated;

-- Existing entry points: same checks, same output, same grants.
create or replace function public.calculate_metering_period(
  p_org uuid,
  p_period_start date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.calculate_metering_period_unchecked(p_org, p_period_start);
end;
$$;

create or replace function public.customer_metering_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.customer_metering_summary_unchecked(p_org);
end;
$$;

revoke all on function public.calculate_metering_period(uuid, date) from public, anon, authenticated;
revoke all on function public.customer_metering_summary(uuid) from public, anon, authenticated;
grant execute on function public.calculate_metering_period(uuid, date) to service_role;
grant execute on function public.customer_metering_summary(uuid) to service_role;

-- New: backend (service role) entry point. Membership is checked against the
-- user id the backend took from the verified JWT.
create or replace function public.customer_metering_summary_for_member(p_org uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_org is null or p_user is null or not exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = p_user
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.customer_metering_summary_unchecked(p_org);
end;
$$;

revoke all on function public.customer_metering_summary_for_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_metering_summary_for_member(uuid, uuid) to service_role;
