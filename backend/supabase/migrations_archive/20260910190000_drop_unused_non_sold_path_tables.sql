-- Drop unused non-sold-path tables so Schema Visualizer shows Work Verification
-- + Field Capture only. Idempotent IF EXISTS (public; archive only if schema exists).
-- Live project ccxatzfsvzetciiwsjlj already applied these drops (incl. empty
-- archive/pm/research/portal schemas removed). This migration matches live.
--
-- Restores stub public.credit_balance (zeros) and rewrites billing RPCs that
-- touched credit_* so Stripe / org_billing / metering / token_usage /
-- usage_events keep working. Does NOT recreate archive/pm/research/portal.

-- ---------------------------------------------------------------------------
-- 1. Views that depend on tables we are about to drop
-- ---------------------------------------------------------------------------
drop view if exists public.crew_live_positions cascade;
drop view if exists public.crm_job_delivery cascade;

-- ---------------------------------------------------------------------------
-- 2. Billing: stub credit_balance + rewrite dependents before dropping credit_*
-- ---------------------------------------------------------------------------
create or replace function public.credit_balance(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Credit wallet removed. Sold path meters via token_usage / org_metering.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and auth.uid() is not null
     and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total_nanos', 0,
    'plan_nanos', 0,
    'purchased_nanos', 0,
    'promo_nanos', 0,
    'next_expiry', null
  );
end;
$$;

revoke execute on function public.credit_balance(uuid) from public, anon;
grant execute on function public.credit_balance(uuid) to authenticated;

create or replace function private.advance_billing_period(p_org uuid)
returns public.org_billing
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b         public.org_billing%rowtype;
  p         public.billing_plans%rowtype;
  v_guard   integer := 0;
  v_created boolean := false;
begin
  select * into b from public.org_billing where org_id = p_org for update;

  if not found then
    insert into public.org_billing (org_id, period_start, period_end)
    values (p_org, now(), now() + interval '1 month')
    on conflict (org_id) do nothing;
    select * into b from public.org_billing where org_id = p_org for update;
    v_created := true;
  end if;

  select * into p from public.billing_plans where code = b.plan_code;

  while b.period_end <= now() and v_guard < 120 loop
    v_guard := v_guard + 1;

    if b.cancel_at_period_end and b.plan_code <> 'free' then
      update public.org_billing
         set plan_code = 'free', cancel_at_period_end = false, seats = 1,
             status = 'active', billing_interval = 'monthly'
       where org_id = p_org
       returning * into b;
      select * into p from public.billing_plans where code = b.plan_code;
    end if;

    update public.org_billing
       set period_start = b.period_end,
           period_end   = b.period_end + interval '1 month'
     where org_id = p_org
     returning * into b;
  end loop;

  return b;
end;
$$;

create or replace function public.record_usage(
  p_org                   uuid,
  p_model_id              text,
  p_request_id            text,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens     bigint default 0,
  p_is_batch              boolean default false,
  p_feature               text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_priced    jsonb;
  v_price     bigint;
  v_cost      bigint;
  v_existing  public.usage_events%rowtype;
  v_event_id  uuid;
  b           public.org_billing%rowtype;
  v_spent     bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if coalesce(btrim(p_request_id), '') = '' then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  select * into v_existing
  from public.usage_events
  where org_id = p_org and request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'event_id',    v_existing.id,
      'price_nanos', v_existing.price_nanos,
      'breakdown',   v_existing.breakdown,
      'duplicate',   true,
      'balance',     public.credit_balance(p_org)
    );
  end if;

  v_priced := private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  );
  v_price := (v_priced ->> 'price_nanos')::bigint;
  v_cost  := (v_priced ->> 'cost_nanos')::bigint;

  b := private.advance_billing_period(p_org);

  if b.monthly_spend_limit_nanos is not null then
    select coalesce(sum(price_nanos), 0) into v_spent
    from public.usage_events
    where org_id = p_org and created_at >= b.period_start;

    if v_spent + v_price > b.monthly_spend_limit_nanos then
      raise exception 'spend_limit_exceeded'
        using detail = format('limit=%s spent=%s requested=%s',
                              b.monthly_spend_limit_nanos, v_spent, v_price),
              errcode = 'P0001';
    end if;
  end if;

  -- Credit wallet removed: record usage_events only (no lot draw-down).
  insert into public.usage_events (
    org_id, user_id, request_id, model_id, feature,
    input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
    cache_read_tokens, is_batch, cost_nanos, price_nanos, breakdown
  ) values (
    p_org, v_uid, btrim(p_request_id), p_model_id, p_feature,
    p_input_tokens, p_output_tokens, p_cache_write_5m_tokens, p_cache_write_1h_tokens,
    p_cache_read_tokens, p_is_batch, v_cost, v_price, v_priced -> 'breakdown'
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'event_id',    v_event_id,
    'price_nanos', v_price,
    'breakdown',   v_priced -> 'breakdown',
    'duplicate',   false,
    'balance',     public.credit_balance(p_org)
  );
end;
$$;

create or replace function public.set_billing_plan(
  p_org      uuid,
  p_plan     text,
  p_interval public.billing_interval default 'monthly',
  p_seats    integer default 1
)
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
  if not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan and is_active;
  if not found then
    raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002';
  end if;
  if p.is_contact_sales then
    raise exception 'plan_requires_sales' using detail = p_plan, errcode = 'P0001';
  end if;
  if p_seats < p.min_seats then
    raise exception 'seats_below_minimum'
      using detail = format('min=%s requested=%s', p.min_seats, p_seats), errcode = '22023';
  end if;

  b := private.advance_billing_period(p_org);

  if b.plan_code = p_plan and b.seats = p_seats and b.billing_interval = p_interval then
    update public.org_billing set cancel_at_period_end = false where org_id = p_org
      returning * into b;
    return jsonb_build_object('plan', p_plan, 'changed', false, 'balance', public.credit_balance(p_org));
  end if;

  if p_plan = 'free' and b.plan_code <> 'free' then
    update public.org_billing set cancel_at_period_end = true where org_id = p_org;
    return jsonb_build_object(
      'plan', b.plan_code, 'changed', true, 'effective_at', b.period_end,
      'cancel_at_period_end', true, 'balance', public.credit_balance(p_org)
    );
  end if;

  update public.org_billing
     set plan_code = p_plan,
         seats = p_seats,
         billing_interval = p_interval,
         status = 'active',
         cancel_at_period_end = false,
         period_start = now(),
         period_end = now() + interval '1 month'
   where org_id = p_org
   returning * into b;

  return jsonb_build_object(
    'plan', p_plan, 'changed', true, 'seats', p_seats,
    'period_end', b.period_end, 'granted_nanos', 0,
    'balance', public.credit_balance(p_org)
  );
end;
$$;

drop function if exists public.stripe_sync_subscription(
  uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz
);
drop function if exists public.stripe_sync_subscription(
  uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz, boolean
);

create or replace function public.stripe_sync_subscription(
  p_org uuid, p_plan text, p_interval public.billing_interval,
  p_seats integer, p_subscription_id text, p_status public.subscription_status,
  p_period_start timestamptz, p_period_end timestamptz,
  p_cancel_at_period_end boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  b public.org_billing%rowtype; p public.billing_plans%rowtype;
  v_changed boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan;
  if not found then raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002'; end if;

  perform private.advance_billing_period(p_org);
  select * into b from public.org_billing where org_id = p_org for update;

  v_changed := b.plan_code is distinct from p_plan
            or b.seats is distinct from p_seats
            or b.period_end is distinct from p_period_end;

  update public.org_billing set
    plan_code = p_plan, billing_interval = p_interval, seats = greatest(p_seats, 1),
    status = p_status, stripe_subscription_id = p_subscription_id,
    period_start = coalesce(p_period_start, period_start),
    period_end = coalesce(p_period_end, period_end),
    cancel_at_period_end = p_cancel_at_period_end
  where org_id = p_org returning * into b;

  return jsonb_build_object('plan', p_plan, 'changed', v_changed,
    'period_end', b.period_end, 'balance', public.credit_balance(p_org));
end $$;

revoke execute on function public.stripe_sync_subscription(uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz, boolean) from public, anon, authenticated;

-- billing_overview still calls credit_balance — stub returns zeros; no table rewrite needed.

-- ---------------------------------------------------------------------------
-- 3. Drop legacy functions (by name; signatures may vary across envs)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'assign_experiment',
        'track_experiment_event',
        'analytics_experiments',
        'agent_audit_rollup',
        'agent_audit_runs',
        'agent_audit_stats',
        'agent_run_steps_count',
        'agent_run_steps_fill',
        'agent_runs_guard',
        'audit_bridge_web_runs',
        'audit_bridge_crm_sync_runs',
        'audit_bridge_backup_snapshots',
        'charge_feature_credits',
        'complete_credit_purchase',
        'fail_credit_purchase',
        'start_credit_purchase'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tables already gone live (archive and/or public) — DROP IF EXISTS both
-- archive/pm/research/portal schemas were dropped empty on live; only touch
-- archive.* when that schema still exists (fresh apply may still have it).
-- Do NOT recreate archive/pm/research/portal.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'archive') then
    drop table if exists archive.eligibility_decisions cascade;
    drop table if exists archive.estimator_jobs cascade;
    drop table if exists archive.export_jobs cascade;
    drop table if exists archive.export_manifests cascade;
    drop table if exists archive.frame_embeddings cascade;
    drop table if exists archive.outcome_records cascade;
    drop table if exists archive.privacy_findings cascade;
    drop table if exists archive.project_timeline_events cascade;
    drop table if exists archive.provenance_records cascade;
    drop table if exists archive.rights_manifests cascade;
    drop table if exists archive.verification_eval_examples cascade;
    drop table if exists archive.verification_eval_runs cascade;
    drop table if exists archive.verification_prompts cascade;
    drop table if exists archive.workflow_relationships cascade;
  end if;
end $$;

drop table if exists public.eligibility_decisions cascade;
drop table if exists public.estimator_jobs cascade;
drop table if exists public.export_jobs cascade;
drop table if exists public.export_manifests cascade;
drop table if exists public.frame_embeddings cascade;
drop table if exists public.outcome_records cascade;
drop table if exists public.privacy_findings cascade;
drop table if exists public.project_timeline_events cascade;
drop table if exists public.provenance_records cascade;
drop table if exists public.rights_manifests cascade;
drop table if exists public.verification_eval_examples cascade;
drop table if exists public.verification_eval_runs cascade;
drop table if exists public.verification_prompts cascade;
drop table if exists public.workflow_relationships cascade;

-- ---------------------------------------------------------------------------
-- 5. Experiments / agent audit / credit wallet / dataset / ontology
-- ---------------------------------------------------------------------------
drop table if exists public.experiment_events cascade;
drop table if exists public.experiment_assignments cascade;
drop table if exists public.experiment_variants cascade;
drop table if exists public.experiments cascade;

drop table if exists public.agent_run_steps cascade;
drop table if exists public.agent_runs cascade;

drop table if exists public.credit_ledger cascade;
drop table if exists public.credit_lots cascade;
drop table if exists public.credit_purchases cascade;
drop table if exists public.credit_packs cascade;

drop table if exists public.dataset_example_media cascade;
drop table if exists public.dataset_examples cascade;
drop table if exists public.dataset_versions cascade;
drop table if exists public.dataset_registry cascade;

drop table if exists public.work_ontology_activities cascade;
drop table if exists public.work_ontology_states cascade;
drop table if exists public.work_ontology_materials cascade;
drop table if exists public.work_ontology_equipment cascade;
drop table if exists public.work_ontology_damage_types cascade;
drop table if exists public.work_ontology_trades cascade;
drop table if exists public.work_ontology_industries cascade;

-- ---------------------------------------------------------------------------
-- 6. Homeowner portal (FK → pm_projects) then all surviving pm_*
-- ---------------------------------------------------------------------------
drop table if exists public.homeowner_portal_messages cascade;
drop table if exists public.homeowner_portal_conversations cascade;
drop table if exists public.homeowner_portal_visibility cascade;
drop table if exists public.homeowner_portal_policies cascade;
drop table if exists public.homeowner_portal_shares cascade;

drop table if exists public.pm_moisture_readings cascade;
drop table if exists public.pm_equipment_placements cascade;
drop table if exists public.pm_drying_areas cascade;
drop table if exists public.pm_equipment cascade;
drop table if exists public.pm_assignments cascade;
drop table if exists public.pm_tasks cascade;
drop table if exists public.pm_alerts cascade;
drop table if exists public.pm_milestones cascade;
drop table if exists public.pm_documents cascade;
drop table if exists public.pm_briefs cascade;
drop table if exists public.pm_updates cascade;
drop table if exists public.pm_automation_settings cascade;
drop table if exists public.pm_approvals cascade;
drop table if exists public.pm_communications cascade;
drop table if exists public.pm_threads cascade;
drop table if exists public.pm_projects cascade;

-- ---------------------------------------------------------------------------
-- 7. Crew / geometry / twins / zip
-- ---------------------------------------------------------------------------
drop table if exists public.crew_locations cascade;
drop table if exists public.crew_location_consent cascade;
drop table if exists public.geometry_capture_sessions cascade;
drop table if exists public.property_twins cascade;
drop table if exists public.zip_centroids cascade;


-- ---------------------------------------------------------------------------
-- 8. Legacy credit-era usage ledger + public rate card (sold path uses
--    token_usage_events + private.model_costs via quote_usage).
-- ---------------------------------------------------------------------------
drop table if exists public.usage_daily cascade;
drop table if exists public.usage_events cascade;
drop table if exists public.model_rate_card cascade;

-- billing_overview used usage_events for period_usage; rewrite to zeros / empty.
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

-- record_usage no longer has usage_events; keep callable but no-op write path
-- (sold path meters via record_token_usage / token_usage_events).
create or replace function public.record_usage(
  p_org                   uuid,
  p_model_id              text,
  p_request_id            text,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens     bigint default 0,
  p_is_batch              boolean default false,
  p_feature               text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_priced jsonb;
  v_price  bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if coalesce(btrim(p_request_id), '') = '' then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  perform private.advance_billing_period(p_org);

  v_priced := private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  );
  v_price := (v_priced ->> 'price_nanos')::bigint;

  return jsonb_build_object(
    'event_id',    null,
    'price_nanos', v_price,
    'breakdown',   v_priced -> 'breakdown',
    'duplicate',   false,
    'balance',     public.credit_balance(p_org)
  );
end;
$$;

-- Drop legacy rollup helper if present
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('rollup_usage_daily', 'sync_rate_card')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;
