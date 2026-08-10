-- ============================================================================
-- Atmosphere — usage metering & billing v2
-- ============================================================================
-- Customer-facing billing: base platform fee + processed jobs + exceptional
-- compute (Atmosphere Compute Units). Internal ai_usage_events capture every
-- AI/API operation for cost accounting — never exposed to customers as tokens.
--
-- Integrates alongside the legacy credit/token ledger (usage_events) without
-- replacing it in this migration; new workflows should record here first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.billing_period_status as enum ('open', 'closed', 'invoiced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.metering_alert_kind as enum (
    'expensive_job',
    'expensive_run',
    'runaway_loop',
    'rapid_tokens',
    'unexpected_video',
    'usage_threshold',
    'margin_below'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- AI model pricing (internal cost basis — not customer-facing)
-- ---------------------------------------------------------------------------

create table if not exists private.ai_model_pricing (
  id                          uuid primary key default gen_random_uuid(),
  provider                    text not null,
  model                       text not null,
  input_token_price_usd       numeric(18, 12) not null check (input_token_price_usd >= 0),
  output_token_price_usd      numeric(18, 12) not null check (output_token_price_usd >= 0),
  cached_input_token_price_usd numeric(18, 12),
  image_price_usd             numeric(18, 12),
  video_second_price_usd      numeric(18, 12),
  audio_second_price_usd      numeric(18, 12),
  ocr_page_price_usd          numeric(18, 12),
  embedding_token_price_usd   numeric(18, 12),
  effective_from              timestamptz not null default now(),
  effective_to                timestamptz,
  is_active                   boolean not null default true,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  constraint ai_model_pricing_window check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists ai_model_pricing_provider_model_from
  on private.ai_model_pricing (provider, model, effective_from);

create index if not exists ai_model_pricing_lookup
  on private.ai_model_pricing (provider, model, effective_from desc)
  where is_active;

-- ---------------------------------------------------------------------------
-- Compute Unit conversion (configurable; historical rows preserved)
-- ---------------------------------------------------------------------------

create table if not exists private.compute_unit_config (
  id                    uuid primary key default gen_random_uuid(),
  usd_per_compute_unit  numeric(18, 12) not null check (usd_per_compute_unit > 0),
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz,
  is_active             boolean not null default true,
  note                  text,
  created_at            timestamptz not null default now(),
  constraint compute_unit_config_window check (effective_to is null or effective_to > effective_from)
);

create index if not exists compute_unit_config_active
  on private.compute_unit_config (effective_from desc)
  where is_active;

-- ---------------------------------------------------------------------------
-- Immutable AI usage events (internal cost accounting)
-- ---------------------------------------------------------------------------

create table if not exists private.ai_usage_events (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.orgs(id) on delete cascade,
  user_id                     uuid references auth.users(id) on delete set null,
  job_id                      uuid,
  workflow_id                 text,
  agent_run_id                text,
  agent_type                  text,
  action_type                 text not null,
  provider                    text,
  model                       text,

  input_tokens                bigint not null default 0 check (input_tokens >= 0),
  output_tokens               bigint not null default 0 check (output_tokens >= 0),
  cached_input_tokens         bigint not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens            bigint not null default 0 check (reasoning_tokens >= 0),
  image_count                 integer not null default 0 check (image_count >= 0),
  video_seconds               numeric(18, 6) not null default 0 check (video_seconds >= 0),
  audio_seconds               numeric(18, 6) not null default 0 check (audio_seconds >= 0),
  ocr_pages                   integer not null default 0 check (ocr_pages >= 0),
  embedding_tokens            bigint not null default 0 check (embedding_tokens >= 0),
  third_party_cost_nanos      bigint not null default 0 check (third_party_cost_nanos >= 0),
  other_variable_cost_nanos   bigint not null default 0 check (other_variable_cost_nanos >= 0),

  estimated_provider_cost_nanos bigint not null check (estimated_provider_cost_nanos >= 0),
  compute_units               numeric(18, 6) not null check (compute_units >= 0),
  compute_unit_rate_usd       numeric(18, 12) not null,

  billable                    boolean not null default true,
  idempotency_key             text not null,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),

  constraint ai_usage_events_idempotency unique (org_id, idempotency_key)
);

create index if not exists ai_usage_events_org_time
  on private.ai_usage_events (org_id, created_at desc);

create index if not exists ai_usage_events_org_job
  on private.ai_usage_events (org_id, job_id, created_at desc)
  where job_id is not null;

create index if not exists ai_usage_events_org_workflow
  on private.ai_usage_events (org_id, workflow_id, created_at desc)
  where workflow_id is not null;

create index if not exists ai_usage_events_org_agent
  on private.ai_usage_events (org_id, agent_type, created_at desc)
  where agent_type is not null;

-- ---------------------------------------------------------------------------
-- Qualifying workflows (configurable job-count triggers)
-- ---------------------------------------------------------------------------

create table if not exists public.qualifying_workflow_types (
  code          text primary key,
  name          text not null,
  description   text,
  is_active     boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Metering plans (versioned; orgs reference a version)
-- ---------------------------------------------------------------------------

create table if not exists public.metering_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text,
  is_active     boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

create table if not exists public.metering_plan_versions (
  id                              uuid primary key default gen_random_uuid(),
  plan_id                         uuid not null references public.metering_plans(id) on delete cascade,
  version                         integer not null check (version > 0),
  base_monthly_fee_cents          integer not null check (base_monthly_fee_cents >= 0),
  included_jobs                   integer not null default 0 check (included_jobs >= 0),
  additional_job_price_cents      integer not null default 0 check (additional_job_price_cents >= 0),
  included_compute_units          numeric(18, 6) not null default 0 check (included_compute_units >= 0),
  compute_unit_overage_nanos      bigint not null default 0 check (compute_unit_overage_nanos >= 0),
  video_hour_price_cents          integer check (video_hour_price_cents is null or video_hour_price_cents >= 0),
  billing_period_days             integer not null default 30 check (billing_period_days between 1 and 366),
  effective_from                  timestamptz not null default now(),
  effective_to                    timestamptz,
  stripe_price_id                 text,
  metadata                        jsonb not null default '{}'::jsonb,
  created_at                      timestamptz not null default now(),
  unique (plan_id, version),
  constraint metering_plan_versions_window check (effective_to is null or effective_to > effective_from)
);

alter table public.metering_plans enable row level security;
alter table public.metering_plan_versions enable row level security;
alter table public.qualifying_workflow_types enable row level security;

drop policy if exists metering_plans_select on public.metering_plans;
create policy metering_plans_select on public.metering_plans
  for select using (is_active);

drop policy if exists metering_plan_versions_select on public.metering_plan_versions;
create policy metering_plan_versions_select on public.metering_plan_versions
  for select using (true);

drop policy if exists qualifying_workflow_types_select on public.qualifying_workflow_types;
create policy qualifying_workflow_types_select on public.qualifying_workflow_types
  for select using (is_active);

-- ---------------------------------------------------------------------------
-- Org metering assignment + negotiated overrides
-- ---------------------------------------------------------------------------

create table if not exists public.org_metering (
  org_id                              uuid primary key references public.orgs(id) on delete cascade,
  plan_version_id                     uuid not null references public.metering_plan_versions(id),
  override_base_monthly_fee_cents     integer check (override_base_monthly_fee_cents is null or override_base_monthly_fee_cents >= 0),
  override_included_jobs              integer check (override_included_jobs is null or override_included_jobs >= 0),
  override_additional_job_price_cents integer check (override_additional_job_price_cents is null or override_additional_job_price_cents >= 0),
  override_included_compute_units     numeric(18, 6) check (override_included_compute_units is null or override_included_compute_units >= 0),
  override_compute_unit_overage_nanos bigint check (override_compute_unit_overage_nanos is null or override_compute_unit_overage_nanos >= 0),
  override_video_hour_price_cents     integer check (override_video_hour_price_cents is null or override_video_hour_price_cents >= 0),
  period_anchor_day                   smallint not null default 1 check (period_anchor_day between 1 and 28),
  usage_limit_jobs                    integer check (usage_limit_jobs is null or usage_limit_jobs > 0),
  usage_limit_compute_units           numeric(18, 6) check (usage_limit_compute_units is null or usage_limit_compute_units > 0),
  alert_threshold_pct                 numeric(5, 2) not null default 80 check (alert_threshold_pct between 0 and 100),
  margin_alert_pct                    numeric(5, 2) check (margin_alert_pct is null or margin_alert_pct between 0 and 100),
  hard_stop_at_limit                  boolean not null default false,
  metadata                            jsonb not null default '{}'::jsonb,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now()
);

alter table public.org_metering enable row level security;

drop policy if exists org_metering_select on public.org_metering;
create policy org_metering_select on public.org_metering
  for select using (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Billable jobs (counted once per org per billing period)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_period_jobs (
  org_id            uuid not null references public.orgs(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  job_id            uuid not null,
  workflow_type     text not null references public.qualifying_workflow_types(code),
  first_event_at    timestamptz not null default now(),
  idempotency_key   text not null,
  primary key (org_id, period_start, job_id),
  constraint billing_period_jobs_idempotency unique (org_id, idempotency_key)
);

alter table public.billing_period_jobs enable row level security;

drop policy if exists billing_period_jobs_select on public.billing_period_jobs;
create policy billing_period_jobs_select on public.billing_period_jobs
  for select using (private.is_org_member(org_id));

create index if not exists billing_period_jobs_org_period
  on public.billing_period_jobs (org_id, period_start, period_end);

-- ---------------------------------------------------------------------------
-- Billing period statements (snapshots — immutable after close)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_period_statements (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  period_start        date not null,
  period_end          date not null,
  status              public.billing_period_status not null default 'open',
  plan_snapshot       jsonb not null,
  pricing_snapshot    jsonb not null,
  summary             jsonb not null default '{}'::jsonb,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  unique (org_id, period_start)
);

alter table public.billing_period_statements enable row level security;

drop policy if exists billing_period_statements_select on public.billing_period_statements;
create policy billing_period_statements_select on public.billing_period_statements
  for select using (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Metering alerts
-- ---------------------------------------------------------------------------

create table if not exists public.metering_alerts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  kind          public.metering_alert_kind not null,
  severity      text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title         text not null,
  detail        jsonb not null default '{}'::jsonb,
  acknowledged  boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.metering_alerts enable row level security;

drop policy if exists metering_alerts_select on public.metering_alerts;
create policy metering_alerts_select on public.metering_alerts
  for select using (private.is_org_member(org_id));

create index if not exists metering_alerts_org_open
  on public.metering_alerts (org_id, created_at desc)
  where not acknowledged;

-- ---------------------------------------------------------------------------
-- Helpers: resolve active pricing & compute-unit rate at a timestamp
-- ---------------------------------------------------------------------------

create or replace function private.resolve_ai_model_pricing(
  p_provider text,
  p_model text,
  p_at timestamptz default now()
)
returns private.ai_model_pricing
language sql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
  select *
  from private.ai_model_pricing p
  where p.provider = p_provider
    and p.model = p_model
    and p.is_active
    and p.effective_from <= p_at
    and (p.effective_to is null or p.effective_to > p_at)
  order by p.effective_from desc
  limit 1;
$$;

create or replace function private.resolve_compute_unit_rate(p_at timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
  select c.usd_per_compute_unit
  from private.compute_unit_config c
  where c.is_active
    and c.effective_from <= p_at
    and (c.effective_to is null or c.effective_to > p_at)
  order by c.effective_from desc
  limit 1;
$$;

-- USD → nanodollars (1 credit = 1 USD = 1e9 nanos)
create or replace function private.usd_to_nanos(p_usd numeric)
returns bigint
language sql
immutable
as $$
  select round(p_usd * 1000000000)::bigint;
$$;

-- Estimate provider cost from pricing row + usage dimensions
create or replace function private.estimate_ai_cost_nanos(
  p_pricing private.ai_model_pricing,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cached_input_tokens bigint,
  p_reasoning_tokens bigint,
  p_image_count integer,
  p_video_seconds numeric,
  p_audio_seconds numeric,
  p_ocr_pages integer,
  p_embedding_tokens bigint,
  p_third_party_cost_nanos bigint,
  p_other_variable_cost_nanos bigint
)
returns bigint
language plpgsql
immutable
as $$
declare
  v_usd numeric := 0;
  v_mtok numeric := 1000000.0;
begin
  if p_pricing.id is not null then
    v_usd := v_usd
      + (coalesce(p_input_tokens, 0)::numeric * coalesce(p_pricing.input_token_price_usd, 0) / v_mtok)
      + (coalesce(p_output_tokens, 0)::numeric * coalesce(p_pricing.output_token_price_usd, 0) / v_mtok)
      + (coalesce(p_cached_input_tokens, 0)::numeric * coalesce(p_pricing.cached_input_token_price_usd, p_pricing.input_token_price_usd * 0.1, 0) / v_mtok)
      + (coalesce(p_reasoning_tokens, 0)::numeric * coalesce(p_pricing.output_token_price_usd, 0) / v_mtok)
      + (coalesce(p_image_count, 0)::numeric * coalesce(p_pricing.image_price_usd, 0))
      + (coalesce(p_video_seconds, 0)::numeric * coalesce(p_pricing.video_second_price_usd, 0))
      + (coalesce(p_audio_seconds, 0)::numeric * coalesce(p_pricing.audio_second_price_usd, 0))
      + (coalesce(p_ocr_pages, 0)::numeric * coalesce(p_pricing.ocr_page_price_usd, 0))
      + (coalesce(p_embedding_tokens, 0)::numeric * coalesce(p_pricing.embedding_token_price_usd, 0) / v_mtok);
  end if;
  return private.usd_to_nanos(v_usd)
    + coalesce(p_third_party_cost_nanos, 0)
    + coalesce(p_other_variable_cost_nanos, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolve org billing period boundaries from anchor day
-- ---------------------------------------------------------------------------

create or replace function private.metering_period_bounds(
  p_org uuid,
  p_reference timestamptz default now()
)
returns table (period_start date, period_end date)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_anchor smallint := 1;
  v_ref date := (p_reference at time zone 'utc')::date;
  v_start date;
begin
  select coalesce(m.period_anchor_day, 1) into v_anchor
  from public.org_metering m where m.org_id = p_org;
  if not found then v_anchor := 1; end if;

  if extract(day from v_ref)::int >= v_anchor then
    v_start := make_date(extract(year from v_ref)::int, extract(month from v_ref)::int, v_anchor);
  else
    v_start := (make_date(extract(year from v_ref)::int, extract(month from v_ref)::int, v_anchor) - interval '1 month')::date;
  end if;

  period_start := v_start;
  period_end := (v_start + interval '1 month')::date;
  return next;
end;
$$;

-- Effective plan terms for an org (overrides applied)
create or replace function private.org_metering_terms(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  m public.org_metering%rowtype;
  v public.metering_plan_versions%rowtype;
  p public.metering_plans%rowtype;
begin
  select * into m from public.org_metering where org_id = p_org;
  if not found then return null; end if;
  select * into v from public.metering_plan_versions where id = m.plan_version_id;
  select * into p from public.metering_plans where id = v.plan_id;

  return jsonb_build_object(
    'planCode', p.code,
    'planName', p.name,
    'planVersion', v.version,
    'planVersionId', v.id,
    'baseMonthlyFeeCents', coalesce(m.override_base_monthly_fee_cents, v.base_monthly_fee_cents),
    'includedJobs', coalesce(m.override_included_jobs, v.included_jobs),
    'additionalJobPriceCents', coalesce(m.override_additional_job_price_cents, v.additional_job_price_cents),
    'includedComputeUnits', coalesce(m.override_included_compute_units, v.included_compute_units),
    'computeUnitOverageNanos', coalesce(m.override_compute_unit_overage_nanos, v.compute_unit_overage_nanos),
    'videoHourPriceCents', coalesce(m.override_video_hour_price_cents, v.video_hour_price_cents),
    'billingPeriodDays', v.billing_period_days,
    'periodAnchorDay', m.period_anchor_day,
    'hardStopAtLimit', m.hard_stop_at_limit,
    'usageLimitJobs', m.usage_limit_jobs,
    'usageLimitComputeUnits', m.usage_limit_compute_units,
    'alertThresholdPct', m.alert_threshold_pct,
    'marginAlertPct', m.margin_alert_pct
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_ai_usage_event — idempotent internal cost event
-- ---------------------------------------------------------------------------

create or replace function public.record_ai_usage_event(
  p_org uuid,
  p_idempotency_key text,
  p_action_type text,
  p_provider text default null,
  p_model text default null,
  p_user_id uuid default null,
  p_job_id uuid default null,
  p_workflow_id text default null,
  p_agent_run_id text default null,
  p_agent_type text default null,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_cached_input_tokens bigint default 0,
  p_reasoning_tokens bigint default 0,
  p_image_count integer default 0,
  p_video_seconds numeric default 0,
  p_audio_seconds numeric default 0,
  p_ocr_pages integer default 0,
  p_embedding_tokens bigint default 0,
  p_third_party_cost_nanos bigint default 0,
  p_other_variable_cost_nanos bigint default 0,
  p_billable boolean default true,
  p_metadata jsonb default '{}'::jsonb,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_existing private.ai_usage_events%rowtype;
  v_pricing private.ai_model_pricing;
  v_cost_nanos bigint;
  v_cu_rate numeric;
  v_compute_units numeric;
  v_row private.ai_usage_events%rowtype;
begin
  if not private.is_org_member(p_org) and auth.uid() is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_existing
  from private.ai_usage_events
  where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'eventId', v_existing.id,
      'duplicate', true,
      'estimatedProviderCostNanos', v_existing.estimated_provider_cost_nanos,
      'computeUnits', v_existing.compute_units
    );
  end if;

  if p_provider is not null and p_model is not null then
    select * into v_pricing from private.resolve_ai_model_pricing(p_provider, p_model, p_at);
  end if;

  v_cost_nanos := private.estimate_ai_cost_nanos(
    v_pricing, p_input_tokens, p_output_tokens, p_cached_input_tokens,
    p_reasoning_tokens, p_image_count, p_video_seconds, p_audio_seconds,
    p_ocr_pages, p_embedding_tokens, p_third_party_cost_nanos, p_other_variable_cost_nanos
  );

  v_cu_rate := coalesce(private.resolve_compute_unit_rate(p_at), 0.01);
  v_compute_units := round((v_cost_nanos::numeric / 1000000000.0) / v_cu_rate, 6);

  insert into private.ai_usage_events (
    org_id, user_id, job_id, workflow_id, agent_run_id, agent_type, action_type,
    provider, model,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
    image_count, video_seconds, audio_seconds, ocr_pages, embedding_tokens,
    third_party_cost_nanos, other_variable_cost_nanos,
    estimated_provider_cost_nanos, compute_units, compute_unit_rate_usd,
    billable, idempotency_key, metadata, created_at
  ) values (
    p_org, p_user_id, p_job_id, p_workflow_id, p_agent_run_id, p_agent_type, p_action_type,
    p_provider, p_model,
    p_input_tokens, p_output_tokens, p_cached_input_tokens, p_reasoning_tokens,
    p_image_count, p_video_seconds, p_audio_seconds, p_ocr_pages, p_embedding_tokens,
    p_third_party_cost_nanos, p_other_variable_cost_nanos,
    v_cost_nanos, v_compute_units, v_cu_rate,
    p_billable, p_idempotency_key, p_metadata, coalesce(p_at, now())
  )
  returning * into v_row;

  return jsonb_build_object(
    'eventId', v_row.id,
    'duplicate', false,
    'estimatedProviderCostNanos', v_row.estimated_provider_cost_nanos,
    'computeUnits', v_row.compute_units
  );
end;
$$;

revoke all on function public.record_ai_usage_event from public;
grant execute on function public.record_ai_usage_event to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- register_billable_job — count a job once per billing period
-- ---------------------------------------------------------------------------

create or replace function public.register_billable_job(
  p_org uuid,
  p_job_id uuid,
  p_workflow_type text,
  p_idempotency_key text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_bounds record;
  v_existing public.billing_period_jobs%rowtype;
  v_wf public.qualifying_workflow_types%rowtype;
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_wf from public.qualifying_workflow_types
  where code = p_workflow_type and is_active;
  if not found then
    raise exception 'unknown_workflow' using detail = p_workflow_type, errcode = 'P0002';
  end if;

  select * into v_bounds from private.metering_period_bounds(p_org, p_at);

  select * into v_existing from public.billing_period_jobs
  where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('jobId', v_existing.job_id, 'duplicate', true, 'periodStart', v_existing.period_start);
  end if;

  select * into v_existing from public.billing_period_jobs
  where org_id = p_org and period_start = v_bounds.period_start and job_id = p_job_id;
  if found then
    return jsonb_build_object('jobId', v_existing.job_id, 'duplicate', true, 'periodStart', v_existing.period_start);
  end if;

  insert into public.billing_period_jobs (
    org_id, period_start, period_end, job_id, workflow_type, first_event_at, idempotency_key
  ) values (
    p_org, v_bounds.period_start, v_bounds.period_end, p_job_id, p_workflow_type, coalesce(p_at, now()), p_idempotency_key
  );

  return jsonb_build_object('jobId', p_job_id, 'duplicate', false, 'periodStart', v_bounds.period_start);
end;
$$;

revoke all on function public.register_billable_job from public;
grant execute on function public.register_billable_job to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- calculate_metering_period — deterministic, auditable aggregation
-- ---------------------------------------------------------------------------

create or replace function public.calculate_metering_period(
  p_org uuid,
  p_period_start date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
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
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

revoke all on function public.calculate_metering_period from public;
grant execute on function public.calculate_metering_period to authenticated, service_role;

-- Customer-facing summary (no tokens, models, or margin)
create or replace function public.customer_metering_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_calc jsonb;
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_calc := public.calculate_metering_period(p_org);

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

revoke all on function public.customer_metering_summary from public;
grant execute on function public.customer_metering_summary to authenticated, service_role;

-- Close a billing period — snapshot pricing inputs so history never changes
create or replace function public.close_metering_period(p_org uuid, p_period_start date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_calc jsonb;
  v_bounds record;
  v_cu_rate numeric;
  v_stmt public.billing_period_statements%rowtype;
begin
  if not private.can_manage_billing(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_bounds from private.metering_period_bounds(p_org, coalesce(p_period_start::timestamptz, now()));
  if p_period_start is not null then
    v_bounds.period_start := p_period_start;
    v_bounds.period_end := (p_period_start + interval '1 month')::date;
  end if;

  v_calc := public.calculate_metering_period(p_org, v_bounds.period_start);
  v_cu_rate := coalesce(private.resolve_compute_unit_rate(now()), 0.01);

  insert into public.billing_period_statements (
    org_id, period_start, period_end, status, plan_snapshot, pricing_snapshot, summary, closed_at
  ) values (
    p_org,
    v_bounds.period_start,
    v_bounds.period_end,
    'closed',
    v_calc->'terms',
    jsonb_build_object('computeUnitRateUsd', v_cu_rate, 'closedAt', now()),
    v_calc,
    now()
  )
  on conflict (org_id, period_start) do update set
    status = 'closed',
    plan_snapshot = excluded.plan_snapshot,
    pricing_snapshot = excluded.pricing_snapshot,
    summary = excluded.summary,
    closed_at = now()
  returning * into v_stmt;

  return jsonb_build_object('statementId', v_stmt.id, 'summary', v_stmt.summary);
end;
$$;

revoke all on function public.close_metering_period from public;
grant execute on function public.close_metering_period to authenticated, service_role;

-- Internal admin analytics (requires analytics_staff internal scope)
create or replace function public.admin_metering_analytics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_scope public.analytics_scope;
begin
  select scope into v_scope from public.analytics_staff where user_id = auth.uid();
  if v_scope is null or v_scope < 'internal'::public.analytics_scope then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          e.org_id as "orgId",
          o.name as "orgName",
          count(*)::int as "eventCount",
          coalesce(sum(e.estimated_provider_cost_nanos), 0) as "aiCostNanos",
          coalesce(sum(e.compute_units), 0) as "computeUnits",
          count(distinct e.job_id) filter (where e.job_id is not null) as "distinctJobs"
        from private.ai_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
        group by e.org_id, o.name
        order by sum(e.estimated_provider_cost_nanos) desc
        limit 100
      ) t
    ),
    'byWorkflow', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select workflow_id as "workflowId",
          count(*)::int as "eventCount",
          coalesce(sum(estimated_provider_cost_nanos), 0) as "aiCostNanos"
        from private.ai_usage_events
        where created_at >= p_from and created_at < p_to and workflow_id is not null
        group by workflow_id
        order by sum(estimated_provider_cost_nanos) desc
        limit 50
      ) t
    ),
    'byAgent', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select agent_type as "agentType",
          count(*)::int as "eventCount",
          coalesce(sum(estimated_provider_cost_nanos), 0) as "aiCostNanos"
        from private.ai_usage_events
        where created_at >= p_from and created_at < p_to and agent_type is not null
        group by agent_type
        order by sum(estimated_provider_cost_nanos) desc
        limit 50
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select provider, model,
          count(*)::int as "eventCount",
          coalesce(sum(estimated_provider_cost_nanos), 0) as "aiCostNanos"
        from private.ai_usage_events
        where created_at >= p_from and created_at < p_to and provider is not null
        group by provider, model
        order by sum(estimated_provider_cost_nanos) desc
        limit 50
      ) t
    ),
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'aiCostNanos', coalesce(sum(estimated_provider_cost_nanos), 0),
        'computeUnits', coalesce(sum(compute_units), 0),
        'distinctOrgs', count(distinct org_id)::int
      )
      from private.ai_usage_events
      where created_at >= p_from and created_at < p_to
    )
  );
end;
$$;

revoke all on function public.admin_metering_analytics from public;
grant execute on function public.admin_metering_analytics to authenticated, service_role;

-- Auto-assign default metering plan on org creation (via trigger on orgs)
create or replace function private.ensure_org_metering()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_plan_version_id uuid;
begin
  select pv.id into v_plan_version_id
  from public.metering_plan_versions pv
  join public.metering_plans p on p.id = pv.plan_id
  where p.code = 'work_verification'
    and pv.effective_to is null
  order by pv.version desc
  limit 1;

  if v_plan_version_id is not null then
    insert into public.org_metering (org_id, plan_version_id)
    values (new.id, v_plan_version_id)
    on conflict (org_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_ensure_metering on public.orgs;
create trigger orgs_ensure_metering
  after insert on public.orgs
  for each row execute function private.ensure_org_metering();

-- ---------------------------------------------------------------------------
-- Seed: compute unit rate, qualifying workflows, default plan
-- ---------------------------------------------------------------------------

insert into private.compute_unit_config (usd_per_compute_unit, note)
select 0.01, 'Initial rate: 1 CU = $0.01 variable AI/compute cost'
where not exists (select 1 from private.compute_unit_config where is_active);

insert into public.qualifying_workflow_types (code, name, description, sort_order) values
  ('work_verification', 'Work verification', 'Daily before/after capture with integrity checks and scope reading', 10),
  ('video_analysis', 'Video analysis', 'Long-form or multimodal video verification', 20),
  ('document_processing', 'Document processing', 'Large document sets or scope extraction', 30),
  ('autonomous_workflow', 'Autonomous workflow', 'Multi-step agent workflows on a job', 40)
on conflict (code) do nothing;

insert into public.metering_plans (code, name, description, sort_order)
values ('work_verification', 'Work Verification', 'Field Capture + Evidence Platform — base fee plus processed jobs and exceptional compute', 10)
on conflict (code) do nothing;

insert into public.metering_plan_versions (
  plan_id, version,
  base_monthly_fee_cents, included_jobs, additional_job_price_cents,
  included_compute_units, compute_unit_overage_nanos, video_hour_price_cents
)
select
  p.id, 1,
  59900, 50, 3000,
  1000, 10000000, 2500
from public.metering_plans p
where p.code = 'work_verification'
  and not exists (
    select 1 from public.metering_plan_versions pv where pv.plan_id = p.id and pv.version = 1
  );

-- Seed ai_model_pricing from existing private.model_costs if present
insert into private.ai_model_pricing (
  provider, model,
  input_token_price_usd, output_token_price_usd,
  cached_input_token_price_usd, effective_from
)
select
  coalesce(c.provider, 'anthropic'),
  c.model_id,
  c.input_cost_per_mtok,
  c.output_cost_per_mtok,
  c.input_cost_per_mtok * c.cache_read_multiplier,
  now()
from private.model_costs c
where c.is_active
  and not exists (
    select 1 from private.ai_model_pricing p
    where p.provider = coalesce(c.provider, 'anthropic') and p.model = c.model_id
  );

-- Backfill org_metering for existing orgs
insert into public.org_metering (org_id, plan_version_id)
select o.id, pv.id
from public.orgs o
cross join lateral (
  select pv2.id
  from public.metering_plan_versions pv2
  join public.metering_plans p on p.id = pv2.plan_id
  where p.code = 'work_verification' and pv2.effective_to is null
  order by pv2.version desc
  limit 1
) pv
where not exists (select 1 from public.org_metering m where m.org_id = o.id);
