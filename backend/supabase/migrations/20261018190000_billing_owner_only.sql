-- ============================================================================
-- Billing and Usage: the organization's owner only.
--
-- The owner is the account that created the organization (orgs.created_by).
-- Before this, private.can_manage_billing also let every global_admin and
-- office_manager manage billing, billing_overview answered any member, and
-- members could select payments, ledgers, statements and usage rows directly.
--
-- org_billing stays member-readable: every member's app reads the subscription
-- status to decide whether the workspace is paid (the paywall gate), and seat
-- checks read it for invites. Safe to re-run.
-- ============================================================================

create or replace function private.can_manage_billing(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

create or replace function public.billing_overview(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b public.org_billing%rowtype;
  p public.billing_plans%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- Billing and Usage are the owner's alone. Other members learn only that.
  if not private.can_manage_billing(p_org) then
    return jsonb_build_object('can_manage', false);
  end if;

  b := private.advance_billing_period(p_org);
  select * into p from public.billing_plans where code = b.plan_code;

  return jsonb_build_object(
    'subscription', jsonb_build_object(
      'plan_code', b.plan_code,
      'plan_name', p.name,
      'billing_interval', b.billing_interval,
      'seats', b.seats,
      'status', b.status,
      'period_start', b.period_start,
      'period_end', b.period_end,
      'cancel_at_period_end', b.cancel_at_period_end,
      'monthly_price_cents', case when p.per_seat
                                  then p.monthly_price_cents * b.seats
                                  else p.monthly_price_cents end,
      'included_credits_nanos', p.included_credits_nanos * (case when p.per_seat then b.seats else 1 end),
      'rate_multiplier', p.rate_multiplier
    ),
    'settings', jsonb_build_object(
      'auto_reload_enabled', b.auto_reload_enabled,
      'auto_reload_threshold_nanos', b.auto_reload_threshold_nanos,
      'auto_reload_amount_nanos', b.auto_reload_amount_nanos,
      'monthly_spend_limit_nanos', b.monthly_spend_limit_nanos
    ),
    'balance', public.credit_balance(p_org),
    'period_usage', jsonb_build_object(
      'events', 0, 'price_nanos', 0, 'input_tokens', 0, 'output_tokens', 0, 'cache_tokens', 0
    ),
    'usage_by_model', '[]'::jsonb,
    'can_manage', private.can_manage_billing(p_org)
  );
end;
$$;

do $$
declare r record;
begin
  if to_regclass('public.payments') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'payments' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.payments', r.policyname);
  end loop;
  execute 'create policy payments_select_owner on public.payments for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.org_billing_events') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'org_billing_events' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.org_billing_events', r.policyname);
  end loop;
  execute 'create policy org_billing_events_select_owner on public.org_billing_events for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.billing_period_statements') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'billing_period_statements' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.billing_period_statements', r.policyname);
  end loop;
  execute 'create policy billing_period_statements_select_owner on public.billing_period_statements for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.billing_period_jobs') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'billing_period_jobs' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.billing_period_jobs', r.policyname);
  end loop;
  execute 'create policy billing_period_jobs_select_owner on public.billing_period_jobs for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.ai_credit_ledger') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'ai_credit_ledger' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.ai_credit_ledger', r.policyname);
  end loop;
  execute 'create policy ai_credit_ledger_select_owner on public.ai_credit_ledger for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.ai_credit_auto_recharge_settings') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'ai_credit_auto_recharge_settings' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.ai_credit_auto_recharge_settings', r.policyname);
  end loop;
  execute 'create policy ai_credit_auto_recharge_settings_select_owner on public.ai_credit_auto_recharge_settings for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.ai_credit_auto_recharges') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'ai_credit_auto_recharges' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.ai_credit_auto_recharges', r.policyname);
  end loop;
  execute 'create policy ai_credit_auto_recharges_select_owner on public.ai_credit_auto_recharges for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.ai_usage_allocations') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'ai_usage_allocations' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.ai_usage_allocations', r.policyname);
  end loop;
  execute 'create policy ai_usage_allocations_select_owner on public.ai_usage_allocations for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.feature_usage_daily') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'feature_usage_daily' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.feature_usage_daily', r.policyname);
  end loop;
  execute 'create policy feature_usage_daily_select_owner on public.feature_usage_daily for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.feature_usage_sessions') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'feature_usage_sessions' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.feature_usage_sessions', r.policyname);
  end loop;
  execute 'create policy feature_usage_sessions_select_owner on public.feature_usage_sessions for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.metering_alerts') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'metering_alerts' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.metering_alerts', r.policyname);
  end loop;
  execute 'create policy metering_alerts_select_owner on public.metering_alerts for select to authenticated using (private.can_manage_billing(org_id))';
end $$;

do $$
declare r record;
begin
  if to_regclass('public.org_metering') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'org_metering' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.org_metering', r.policyname);
  end loop;
  execute 'create policy org_metering_select_owner on public.org_metering for select to authenticated using (private.can_manage_billing(org_id))';
end $$;
