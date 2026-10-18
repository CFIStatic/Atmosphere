-- ============================================================================
-- Atmosphere Growth Analytics
-- ----------------------------------------------------------------------------
-- Adds the data layer behind the two internal analytics dashboards:
--
--   1. ACCESS CONTROL  — analytics_staff, an explicit allow-list. Nobody sees
--      company-wide numbers by default; RLS on every other table is per-org and
--      stays that way. The reporting functions below are SECURITY DEFINER (they
--      must read across orgs) and each one re-checks the caller's scope, so the
--      allow-list is the only door.
--
--   2. PRODUCT TELEMETRY — feature_catalog + feature_usage_sessions, which
--      measure engagement as TIME SPENT IN A TOOL rather than click counts. The
--      catalog is the denominator: a feature nobody opens still has a row, which
--      is what makes "least used" answerable at all.
--
--   3. SUBSCRIPTION HISTORY — org_billing_events. org_billing holds only the
--      CURRENT plan/seat state, so historical MRR would otherwise be
--      unreconstructable. A trigger appends an immutable row on every change,
--      which is what makes the month-by-month series point-in-time correct
--      instead of a back-projection of today's prices.
--
--   4. REPORTING FUNCTIONS — analytics_*(), the only cross-org readers.
--
-- Money is in CENTS everywhere in this file (matching billing_plans/payments);
-- credit balances stay in nanos (matching credit_ledger). Durations are in ms.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Access control
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'analytics_scope') then
    -- Ordered enum: 'internal' > 'investor', so a single >= comparison expresses
    -- "at least this much access".
    create type public.analytics_scope as enum ('investor', 'internal');
  end if;
end $$;

create table if not exists public.analytics_staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  scope        public.analytics_scope not null default 'internal',
  display_name text,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

alter table public.analytics_staff enable row level security;

-- A grantee may confirm their own access (the UI needs it to decide whether to
-- show the link) and nothing else. Granting access is a service-role operation
-- on purpose — there is no self-service path into company-wide revenue.
drop policy if exists analytics_staff_select_self on public.analytics_staff;
create policy analytics_staff_select_self on public.analytics_staff
  for select using (user_id = auth.uid());

create or replace function private.analytics_scope()
returns public.analytics_scope
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.scope from public.analytics_staff s where s.user_id = auth.uid();
$$;

/**
 * Assert the caller holds at least p_min access and return their actual scope.
 * Every reporting function starts with this; an investor-scope caller reaching
 * an internal-only function is rejected here, in the database, not in the UI.
 */
create or replace function private.require_analytics(
  p_min public.analytics_scope default 'investor'
) returns public.analytics_scope
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_scope public.analytics_scope;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_scope := private.analytics_scope();

  if v_scope is null then
    raise exception 'analytics_forbidden' using errcode = '42501';
  end if;
  if v_scope < p_min then
    raise exception 'analytics_scope_insufficient'
      using errcode = '42501', detail = format('have=%s need=%s', v_scope, p_min);
  end if;

  return v_scope;
end;
$$;

/**
 * Non-throwing probe used by the app shell: returns the caller's scope, or a
 * null scope for everyone else. Reads only the caller's own row.
 */
create or replace function public.analytics_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'scope', (select s.scope from public.analytics_staff s where s.user_id = auth.uid()),
    'display_name', (select s.display_name from public.analytics_staff s where s.user_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Product telemetry — time spent per feature
-- ---------------------------------------------------------------------------

create table if not exists public.feature_catalog (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  label       text not null,
  area        text not null,
  description text,
  is_active   boolean not null default true,
  sort_order  integer not null default 100
);

alter table public.feature_catalog enable row level security;

-- Readable by any signed-in user: the client needs the key list to emit
-- telemetry, and the labels are product copy, not business data.
drop policy if exists feature_catalog_select on public.feature_catalog;
create policy feature_catalog_select on public.feature_catalog
  for select to authenticated using (true);

insert into public.feature_catalog (key, label, area, description, sort_order) values
  ('dashboard',        'Team dashboard',      'Platform',    'Org overview, linked accounts, invite codes',        10),
  ('onboarding',       'Onboarding',          'Platform',    'Create-or-join org, role and work-type setup',       20),
  ('org_directory',    'Org directory',       'Platform',    'Browsing and managing linked accounts',              30),
  ('pin_signin',       'PIN sign-in',         'Platform',    'Device-bound fast sign-in',                          40),
  ('web_connections',  'Web connections',     'Automation',  'Connecting external portals Atmosphere logs into',   50),
  ('web_runs',         'Web automation runs', 'Automation',  'Pull/push jobs against connected portals',           60),
  ('web_verification', 'Run verification',    'Automation',  'The verifier agent checking a run did what it said', 70),
  ('agent_console',    'Agent console',       'Automation',  'Audit ledger of agent runs and steps',               80),
  ('billing_console',  'Billing console',     'Back office', 'Plan, seats, invoices and receipts',                 90),
  ('credits',          'Credits & top-ups',   'Back office', 'Credit balance, packs, auto-reload',                100),
  ('growth_analytics', 'Growth analytics',    'Back office', 'These dashboards',                                  110),
  ('ai_assistant',     'AI assistant',        'AI',          'Model-backed assistance across the product',        120)
on conflict (key) do update
  set label = excluded.label,
      area = excluded.area,
      description = excluded.description;

create table if not exists public.feature_usage_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  feature_key  text not null references public.feature_catalog(key) on update cascade,
  client       text not null default 'web' check (client in ('web', 'mobile', 'desktop', 'api')),
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Foreground time only, accumulated from heartbeats. Capped at 24h so a stuck
  -- client cannot manufacture engagement.
  active_ms    bigint not null default 0 check (active_ms >= 0 and active_ms <= 86400000),
  interactions integer not null default 0 check (interactions >= 0)
);

create index if not exists feature_usage_sessions_started_idx  on public.feature_usage_sessions (started_at desc);
create index if not exists feature_usage_sessions_org_idx      on public.feature_usage_sessions (org_id, started_at desc);
create index if not exists feature_usage_sessions_feature_idx  on public.feature_usage_sessions (feature_key, started_at desc);
create index if not exists feature_usage_sessions_user_idx     on public.feature_usage_sessions (user_id, last_seen_at desc);

alter table public.feature_usage_sessions enable row level security;

-- An org can see its own usage. Writes go exclusively through feature_heartbeat
-- (SECURITY DEFINER), so no insert/update policy exists: a client cannot forge
-- another user's time, or its own.
drop policy if exists feature_usage_sessions_select on public.feature_usage_sessions;
create policy feature_usage_sessions_select on public.feature_usage_sessions
  for select using (private.is_org_member(org_id));

create table if not exists public.feature_usage_daily (
  day          date not null,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  feature_key  text not null references public.feature_catalog(key) on update cascade,
  sessions     integer not null default 0,
  active_ms    bigint  not null default 0,
  interactions bigint  not null default 0,
  primary key (day, org_id, feature_key)
);

create index if not exists feature_usage_daily_feature_idx on public.feature_usage_daily (feature_key, day desc);

alter table public.feature_usage_daily enable row level security;

drop policy if exists feature_usage_daily_select on public.feature_usage_daily;
create policy feature_usage_daily_select on public.feature_usage_daily
  for select using (private.is_org_member(org_id));

/**
 * Keep the daily rollup in step with the session table by DELTA, so the rollup
 * stays correct no matter how many heartbeats a session takes to accumulate.
 */
create or replace function private.rollup_feature_usage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date;
  v_sessions integer;
  v_ms bigint;
  v_interactions bigint;
begin
  v_day := (new.started_at at time zone 'UTC')::date;

  if tg_op = 'INSERT' then
    v_sessions := 1;
    v_ms := new.active_ms;
    v_interactions := new.interactions;
  else
    v_sessions := 0;
    v_ms := new.active_ms - old.active_ms;
    v_interactions := new.interactions - old.interactions;
  end if;

  insert into public.feature_usage_daily (day, org_id, feature_key, sessions, active_ms, interactions)
  values (v_day, new.org_id, new.feature_key, v_sessions, v_ms, v_interactions)
  on conflict (day, org_id, feature_key) do update
    set sessions     = public.feature_usage_daily.sessions + excluded.sessions,
        active_ms    = public.feature_usage_daily.active_ms + excluded.active_ms,
        interactions = public.feature_usage_daily.interactions + excluded.interactions;

  return new;
end;
$$;

drop trigger if exists feature_usage_rollup on public.feature_usage_sessions;
create trigger feature_usage_rollup
  after insert or update of active_ms, interactions on public.feature_usage_sessions
  for each row execute function private.rollup_feature_usage();

/**
 * Record foreground time in a tool.
 *
 * The client sends a heartbeat every ~30s with the milliseconds elapsed since
 * its last one. Each delta is clamped to 5 minutes, so a backgrounded tab that
 * wakes up hours later contributes one interval and not the whole gap — the
 * headline "time spent" number is only as trustworthy as its worst input.
 *
 * Passing a session id continues that session (if it is the caller's own and
 * not stale); anything else starts a new one.
 */
create or replace function public.feature_heartbeat(
  p_feature      text,
  p_session      uuid default null,
  p_delta_ms     integer default 0,
  p_client       text default 'web',
  p_interactions integer default 0
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_delta integer;
  v_session uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from public.feature_catalog f where f.key = p_feature and f.is_active) then
    raise exception 'unknown_feature' using errcode = 'P0002', detail = p_feature;
  end if;

  -- Telemetry is attributed to the caller's org; a user outside an org has no
  -- org to attribute to, and is silently ignored rather than failing their page.
  select om.org_id into v_org
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;

  if v_org is null then
    return null;
  end if;

  v_delta := least(greatest(coalesce(p_delta_ms, 0), 0), 300000);

  if p_session is not null then
    update public.feature_usage_sessions s
       set active_ms    = least(s.active_ms + v_delta, 86400000),
           interactions = s.interactions + least(greatest(coalesce(p_interactions, 0), 0), 1000),
           last_seen_at = now()
     where s.id = p_session
       and s.user_id = auth.uid()
       and s.feature_key = p_feature
       and s.last_seen_at > now() - interval '30 minutes'
    returning s.id into v_session;

    if v_session is not null then
      return v_session;
    end if;
  end if;

  insert into public.feature_usage_sessions (org_id, user_id, feature_key, client, active_ms, interactions)
  values (
    v_org,
    auth.uid(),
    p_feature,
    case when coalesce(p_client, 'web') in ('web', 'mobile', 'desktop', 'api') then p_client else 'web' end,
    v_delta,
    least(greatest(coalesce(p_interactions, 0), 0), 1000)
  )
  returning id into v_session;

  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Subscription history — what makes historical MRR real
-- ---------------------------------------------------------------------------

/**
 * Monthly recurring revenue for one subscription state, in cents.
 *
 * billing_plans.annual_price_cents is the PER-MONTH price when billed annually
 * (Pro: $20 monthly, $17/mo annual), matching how billing_overview() reads the
 * table — so an annual plan's MRR is that column directly, not a division.
 *
 * Counted: active and past_due (contracted revenue we still expect to collect).
 * Not counted: trialing (no commitment yet — reported separately) and canceled.
 */
create or replace function private.plan_mrr_cents(
  p_plan     text,
  p_interval public.billing_interval,
  p_seats    integer,
  p_status   public.subscription_status
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_status not in ('active', 'past_due') then 0
    else coalesce((
      select (case
                when p_interval = 'annual' then coalesce(p.annual_price_cents, p.monthly_price_cents)
                else p.monthly_price_cents
              end)
             * (case when p.per_seat then greatest(coalesce(p_seats, 1), p.min_seats) else 1 end)
      from public.billing_plans p
      where p.code = p_plan
    ), 0)
  end;
$$;

create table if not exists public.org_billing_events (
  id               bigserial primary key,
  org_id           uuid not null references public.orgs(id) on delete cascade,
  effective_at     timestamptz not null default now(),
  plan_code        text not null,
  billing_interval public.billing_interval not null,
  seats            integer not null,
  status           public.subscription_status not null,
  mrr_cents        integer not null default 0,
  source           text not null default 'change'
);

create index if not exists org_billing_events_org_idx on public.org_billing_events (org_id, effective_at desc, id desc);
create index if not exists org_billing_events_at_idx  on public.org_billing_events (effective_at desc);

alter table public.org_billing_events enable row level security;

drop policy if exists org_billing_events_select on public.org_billing_events;
create policy org_billing_events_select on public.org_billing_events
  for select using (private.is_org_member(org_id));

create or replace function private.record_billing_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.plan_code        is not distinct from old.plan_code
     and new.billing_interval is not distinct from old.billing_interval
     and new.seats            is not distinct from old.seats
     and new.status           is not distinct from old.status then
    return new;
  end if;

  insert into public.org_billing_events (
    org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source)
  values (
    new.org_id, now(), new.plan_code, new.billing_interval, new.seats, new.status,
    private.plan_mrr_cents(new.plan_code, new.billing_interval, new.seats, new.status),
    case when tg_op = 'INSERT' then 'signup' else 'change' end);

  return new;
end;
$$;

drop trigger if exists org_billing_history on public.org_billing;
create trigger org_billing_history
  after insert or update on public.org_billing
  for each row execute function private.record_billing_event();

-- Seed one event per existing subscription, dated to when that org first had a
-- billing row, so months before today are not silently empty. Everything after
-- this migration is captured by the trigger above.
insert into public.org_billing_events (
  org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source)
select b.org_id, b.created_at, b.plan_code, b.billing_interval, b.seats, b.status,
       private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status),
       'backfill'
from public.org_billing b
where not exists (
  select 1 from public.org_billing_events e where e.org_id = b.org_id
);

-- ---------------------------------------------------------------------------
-- 4. Point-in-time helpers
-- ---------------------------------------------------------------------------

/** Company-wide MRR in cents as it stood at p_at. */
create or replace function private.mrr_cents_at(p_at timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(e.mrr_cents), 0)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e;
$$;

/** Licensed seats on a paid or trialing subscription as they stood at p_at. */
create or replace function private.seats_at(p_at timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case
           when e.status in ('active', 'past_due', 'trialing') then e.seats
           else 0 end), 0)::bigint
  from public.orgs o
  cross join lateral (
    select ev.seats, ev.status
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e;
$$;

/** Orgs carrying non-zero MRR at p_at. */
create or replace function private.paying_orgs_at(p_at timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e
  where e.mrr_cents > 0;
$$;

/** Percentage change, null when there is no base to grow from. */
create or replace function private.pct_change(p_now numeric, p_prev numeric)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_prev is null or p_prev = 0 then null
    else round(((p_now - p_prev) / p_prev) * 100, 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reporting functions (the only cross-org readers)
-- ---------------------------------------------------------------------------

/**
 * Headline KPIs for a date range.
 *
 * Investor scope gets the same growth and revenue shape as internal scope; what
 * it does NOT get is unit economics (model cost and gross margin), which are
 * omitted from the payload rather than zeroed, so the boundary is visible.
 */
create or replace function public.analytics_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope public.analytics_scope;
  v_month_start timestamptz;
  v_mrr bigint; v_mrr_prev bigint;
  v_seats bigint; v_seats_prev bigint;
  v_users bigint; v_users_prev bigint;
  v_orgs bigint; v_orgs_prev bigint;
  v_trial_mrr bigint;
  v_annual_mrr bigint;
  v_revenue bigint; v_sub_revenue bigint; v_credit_revenue bigint;
  v_paying bigint;
  v_result jsonb;
  v_days numeric;
begin
  v_scope := private.require_analytics('investor');

  v_month_start := date_trunc('month', now());
  v_days := greatest(extract(epoch from (p_to - p_from)) / 86400.0, 1);

  v_mrr        := private.mrr_cents_at(now());
  v_mrr_prev   := private.mrr_cents_at(v_month_start);
  v_seats      := private.seats_at(now());
  v_seats_prev := private.seats_at(v_month_start);
  v_paying     := private.paying_orgs_at(now());

  select count(*) into v_users from public.org_members;
  select count(*) into v_users_prev from public.org_members where created_at < v_month_start;
  select count(*) into v_orgs from public.orgs;
  select count(*) into v_orgs_prev from public.orgs where created_at < v_month_start;

  -- Trial pipeline: what MRR would be added if every trial converted as-is.
  select coalesce(sum(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, 'active')), 0)
    into v_trial_mrr
  from public.org_billing b where b.status = 'trialing';

  -- The slice of MRR contracted annually (prepaid, hardest to churn).
  select coalesce(sum(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status)), 0)
    into v_annual_mrr
  from public.org_billing b where b.billing_interval = 'annual';

  select
    coalesce(sum(amount_cents), 0),
    coalesce(sum(amount_cents) filter (where kind = 'subscription'), 0),
    coalesce(sum(amount_cents) filter (where kind = 'credits'), 0)
  into v_revenue, v_sub_revenue, v_credit_revenue
  from public.payments
  where status = 'succeeded' and created_at >= p_from and created_at < p_to;

  v_result := jsonb_build_object(
    'scope', v_scope,
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', round(v_days, 1)),

    'customers', jsonb_build_object(
      'orgs_total', v_orgs,
      'orgs_new', (select count(*) from public.orgs where created_at >= p_from and created_at < p_to),
      'orgs_paying', v_paying,
      'orgs_active', (
        select count(distinct org_id) from (
          select org_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select org_id from public.usage_events where created_at >= p_from and created_at < p_to
        ) a),
      'orgs_growth_mom_pct', private.pct_change(v_orgs, v_orgs_prev)),

    'users', jsonb_build_object(
      'users_total', v_users,
      'users_new', (select count(*) from public.org_members where created_at >= p_from and created_at < p_to),
      'users_active', (
        select count(distinct user_id) from (
          select user_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select user_id from public.usage_events where user_id is not null and created_at >= p_from and created_at < p_to
        ) a),
      'users_growth_mom_pct', private.pct_change(v_users, v_users_prev)),

    'seats', jsonb_build_object(
      'seats_licensed', v_seats,
      'seats_filled', (
        select count(*) from public.org_members m
        join public.org_billing b on b.org_id = m.org_id
        where b.status in ('active', 'past_due', 'trialing')),
      'seat_utilization_pct', case when v_seats > 0 then round((
        select count(*)::numeric from public.org_members m
        join public.org_billing b on b.org_id = m.org_id
        where b.status in ('active', 'past_due', 'trialing')) / v_seats * 100, 1) end,
      'seats_growth_mom_pct', private.pct_change(v_seats, v_seats_prev)),

    'revenue', jsonb_build_object(
      -- MRR is the monthly slice of ARR; ARR is the annualised run-rate of
      -- today's MRR, not trailing revenue (which is reported separately below).
      'mrr_cents', v_mrr,
      'arr_cents', v_mrr * 12,
      'annual_contracted_mrr_cents', v_annual_mrr,
      'annual_contracted_arr_cents', v_annual_mrr * 12,
      'monthly_billed_mrr_cents', v_mrr - v_annual_mrr,
      'trial_pipeline_mrr_cents', v_trial_mrr,
      'mrr_growth_mom_pct', private.pct_change(v_mrr, v_mrr_prev),
      'net_new_mrr_cents', v_mrr - v_mrr_prev,
      'collected_in_range_cents', v_revenue,
      'subscription_revenue_cents', v_sub_revenue,
      'credit_revenue_cents', v_credit_revenue,
      'trailing_12m_revenue_cents', (
        select coalesce(sum(amount_cents), 0) from public.payments
        where status = 'succeeded' and created_at >= now() - interval '12 months'),
      -- Average spend per paying account, normalised to a 30-day month so the
      -- number means the same thing whatever range is selected.
      'avg_monthly_spend_per_account_cents', case when v_paying > 0
        then round((v_revenue / v_days * 30.0) / v_paying) end,
      'avg_monthly_spend_per_seat_cents', case when v_seats > 0
        then round((v_revenue / v_days * 30.0) / v_seats) end,
      'arpa_mrr_cents', case when v_paying > 0 then round(v_mrr::numeric / v_paying) end),

    'engagement', jsonb_build_object(
      'tracked_hours', (
        select round(coalesce(sum(active_ms), 0) / 3600000.0, 1)
        from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to),
      'sessions', (
        select count(*) from public.feature_usage_sessions
        where started_at >= p_from and started_at < p_to),
      'features_used', (
        select count(distinct feature_key) from public.feature_usage_sessions
        where last_seen_at >= p_from and last_seen_at < p_to),
      'features_tracked', (select count(*) from public.feature_catalog where is_active),
      'ai_requests', (
        select count(*) from public.usage_events where created_at >= p_from and created_at < p_to)));

  -- Unit economics: internal only.
  if v_scope >= 'internal' then
    v_result := v_result || jsonb_build_object('unit_economics', (
      select jsonb_build_object(
        'billed_usage_cents', round(coalesce(sum(price_nanos), 0) / 10000000.0),
        'model_cost_cents',   round(coalesce(sum(cost_nanos), 0) / 10000000.0),
        'gross_margin_cents', round(coalesce(sum(price_nanos - cost_nanos), 0) / 10000000.0),
        'gross_margin_pct', case when coalesce(sum(price_nanos), 0) > 0
          then round(coalesce(sum(price_nanos - cost_nanos), 0)::numeric / sum(price_nanos) * 100, 1) end)
      from public.usage_events where created_at >= p_from and created_at < p_to));
  end if;

  return v_result;
end;
$$;

/**
 * Month-by-month growth series. Counts and MRR are point-in-time as of each
 * month's END; revenue is cash collected WITHIN the month.
 */
create or replace function public.analytics_monthly(p_months integer default 24)
returns table (
  month                  date,
  new_orgs               bigint,
  total_orgs             bigint,
  paying_orgs            bigint,
  active_orgs            bigint,
  churned_orgs           bigint,
  new_users              bigint,
  total_users            bigint,
  active_users           bigint,
  seats                  bigint,
  mrr_cents              bigint,
  arr_cents              bigint,
  revenue_cents          bigint,
  subscription_revenue_cents bigint,
  credit_revenue_cents   bigint,
  arpa_cents             numeric,
  mrr_growth_pct         numeric,
  user_growth_pct        numeric,
  seat_growth_pct        numeric,
  tracked_hours          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
-- The OUT parameters share names with the query's columns; resolve to the
-- column in every case.
#variable_conflict use_column
begin
  -- Guarded in a statement of its own: a check folded into a WHERE clause is
  -- only as reliable as the planner's decision to evaluate it.
  perform private.require_analytics('investor');

  return query
  with months as (
    select generate_series(
      date_trunc('month', now()) - ((least(greatest(p_months, 1), 60) - 1) * interval '1 month'),
      date_trunc('month', now()),
      interval '1 month'
    )::timestamptz as m_start
  ),
  bounds as (
    select m_start,
           m_start + interval '1 month' as m_end,
           -- Point-in-time values are taken at the earlier of month-end and now,
           -- so the current (partial) month reports today rather than the future.
           least(m_start + interval '1 month', now()) as m_at
    from months
  ),
  base as (
    select
      b.m_start::date as month,
      (select count(*) from public.orgs o where o.created_at >= b.m_start and o.created_at < b.m_end) as new_orgs,
      (select count(*) from public.orgs o where o.created_at < b.m_at) as total_orgs,
      private.paying_orgs_at(b.m_at) as paying_orgs,
      (select count(distinct org_id) from (
         select org_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select org_id, created_at from public.usage_events) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end) as active_orgs,
      (select count(*) from public.org_billing_events e
        where e.status = 'canceled' and e.effective_at >= b.m_start and e.effective_at < b.m_end
          and exists (select 1 from public.org_billing_events p
                       where p.org_id = e.org_id and p.effective_at < e.effective_at and p.mrr_cents > 0)) as churned_orgs,
      (select count(*) from public.org_members m where m.created_at >= b.m_start and m.created_at < b.m_end) as new_users,
      (select count(*) from public.org_members m where m.created_at < b.m_at) as total_users,
      (select count(distinct user_id) from (
         select user_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select user_id, created_at from public.usage_events where user_id is not null) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end) as active_users,
      private.seats_at(b.m_at) as seats,
      private.mrr_cents_at(b.m_at) as mrr_cents,
      (select coalesce(sum(amount_cents), 0) from public.payments p
        where p.status = 'succeeded' and p.created_at >= b.m_start and p.created_at < b.m_end) as revenue_cents,
      (select coalesce(sum(amount_cents), 0) from public.payments p
        where p.status = 'succeeded' and p.kind = 'subscription'
          and p.created_at >= b.m_start and p.created_at < b.m_end) as subscription_revenue_cents,
      (select coalesce(sum(amount_cents), 0) from public.payments p
        where p.status = 'succeeded' and p.kind = 'credits'
          and p.created_at >= b.m_start and p.created_at < b.m_end) as credit_revenue_cents,
      (select round(coalesce(sum(active_ms), 0) / 3600000.0, 1) from public.feature_usage_sessions s
        where s.last_seen_at >= b.m_start and s.last_seen_at < b.m_end) as tracked_hours
    from bounds b
  )
  select
    month, new_orgs, total_orgs, paying_orgs, active_orgs, churned_orgs,
    new_users, total_users, active_users, seats, mrr_cents, mrr_cents * 12 as arr_cents,
    revenue_cents, subscription_revenue_cents, credit_revenue_cents,
    case when paying_orgs > 0 then round(mrr_cents::numeric / paying_orgs) end as arpa_cents,
    private.pct_change(mrr_cents, lag(mrr_cents) over (order by month)) as mrr_growth_pct,
    private.pct_change(total_users, lag(total_users) over (order by month)) as user_growth_pct,
    private.pct_change(seats, lag(seats) over (order by month)) as seat_growth_pct,
    tracked_hours
  from base
  order by base.month;
end;
$$;

/**
 * Feature engagement ranked by time spent.
 *
 * LEFT JOIN from the catalog on purpose: a tool with no sessions comes back with
 * zeros instead of vanishing, which is the only way "least used" can be read off
 * the bottom of the list.
 */
create or replace function public.analytics_features(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now()
) returns table (
  feature_key   text,
  label         text,
  area          text,
  sessions      bigint,
  active_ms     bigint,
  active_hours  numeric,
  users         bigint,
  orgs          bigint,
  avg_session_minutes numeric,
  share_pct     numeric,
  time_rank     bigint,
  ai_requests   bigint,
  last_used_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform private.require_analytics('investor');

  return query
  with usage as (
    select s.feature_key,
           count(*)                                 as sessions,
           -- sum(bigint) is numeric; the declared column is bigint.
           coalesce(sum(s.active_ms), 0)::bigint    as active_ms,
           count(distinct s.user_id)       as users,
           count(distinct s.org_id)        as orgs,
           max(s.last_seen_at)             as last_used_at
    from public.feature_usage_sessions s
    where s.last_seen_at >= p_from and s.last_seen_at < p_to
    group by s.feature_key
  ),
  ai as (
    select feature as feature_key, count(*) as ai_requests
    from public.usage_events
    where feature is not null and created_at >= p_from and created_at < p_to
    group by feature
  ),
  total as (select nullif(sum(active_ms), 0) as total_ms from usage)
  select
    f.key, f.label, f.area,
    coalesce(u.sessions, 0),
    coalesce(u.active_ms, 0),
    round(coalesce(u.active_ms, 0) / 3600000.0, 2),
    coalesce(u.users, 0),
    coalesce(u.orgs, 0),
    case when coalesce(u.sessions, 0) > 0
      then round(u.active_ms / (u.sessions * 60000.0), 1) else 0 end,
    round(coalesce(u.active_ms, 0) * 100.0 / coalesce((select total_ms from total), 1), 1),
    row_number() over (order by coalesce(u.active_ms, 0) desc, f.sort_order),
    coalesce(a.ai_requests, 0),
    u.last_used_at
  from public.feature_catalog f
  left join usage u on u.feature_key = f.key
  left join ai a on a.feature_key = f.key
  where f.is_active
  order by coalesce(u.active_ms, 0) desc, f.sort_order;
end;
$$;

/** Per-customer detail. Internal scope only — this is the identifying view. */
create or replace function public.analytics_accounts(
  p_from  timestamptz default (now() - interval '30 days'),
  p_to    timestamptz default now(),
  p_limit integer default 500
) returns table (
  org_id           uuid,
  org_name         text,
  created_at       timestamptz,
  plan_code        text,
  plan_name        text,
  billing_interval text,
  status           text,
  seats            integer,
  members          bigint,
  mrr_cents        bigint,
  arr_cents        bigint,
  revenue_in_range_cents bigint,
  credit_spend_cents numeric,
  active_hours     numeric,
  top_feature      text,
  last_active_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  -- Internal scope only: this is the view that names customers.
  perform private.require_analytics('internal');

  return query
  select
    o.id, o.name, o.created_at,
    coalesce(b.plan_code, 'free'),
    coalesce(p.name, 'Free'),
    coalesce(b.billing_interval::text, 'monthly'),
    coalesce(b.status::text, 'active'),
    coalesce(b.seats, 0),
    (select count(*) from public.org_members m where m.org_id = o.id),
    coalesce(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status), 0)::bigint,
    coalesce(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status), 0)::bigint * 12,
    (select coalesce(sum(amount_cents), 0) from public.payments pay
      where pay.org_id = o.id and pay.status = 'succeeded'
        and pay.created_at >= p_from and pay.created_at < p_to),
    (select round(coalesce(sum(price_nanos), 0) / 10000000.0, 2) from public.usage_events u
      where u.org_id = o.id and u.created_at >= p_from and u.created_at < p_to),
    (select round(coalesce(sum(active_ms), 0) / 3600000.0, 2) from public.feature_usage_sessions s
      where s.org_id = o.id and s.last_seen_at >= p_from and s.last_seen_at < p_to),
    (select f.label from public.feature_usage_sessions s
      join public.feature_catalog f on f.key = s.feature_key
      where s.org_id = o.id and s.last_seen_at >= p_from and s.last_seen_at < p_to
      group by f.label order by sum(s.active_ms) desc limit 1),
    (select max(s.last_seen_at) from public.feature_usage_sessions s where s.org_id = o.id)
  from public.orgs o
  left join public.org_billing b on b.org_id = o.id
  left join public.billing_plans p on p.code = b.plan_code
  order by coalesce(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status), 0) desc,
           o.created_at desc
  limit least(greatest(p_limit, 1), 5000);
end;
$$;

/** Distribution of orgs, seats and MRR across plans. */
create or replace function public.analytics_plan_mix()
returns table (
  plan_code   text,
  plan_name   text,
  billing_interval text,
  orgs        bigint,
  seats       bigint,
  mrr_cents   bigint,
  arr_cents   bigint,
  mrr_share_pct numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform private.require_analytics('investor');

  return query
  with rows_ as (
    select
      coalesce(b.plan_code, 'free') as plan_code,
      coalesce(p.name, 'Free') as plan_name,
      coalesce(b.billing_interval::text, 'monthly') as billing_interval,
      count(*)::bigint as orgs,
      coalesce(sum(b.seats), 0)::bigint as seats,
      coalesce(sum(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status)), 0)::bigint as mrr_cents
    from public.orgs o
    left join public.org_billing b on b.org_id = o.id
    left join public.billing_plans p on p.code = b.plan_code
    group by 1, 2, 3
  )
  select r.plan_code, r.plan_name, r.billing_interval, r.orgs, r.seats, r.mrr_cents, r.mrr_cents * 12,
         round(r.mrr_cents * 100.0 / nullif((select sum(x.mrr_cents) from rows_ x), 0), 1)
  from rows_ r
  order by r.mrr_cents desc, r.orgs desc;
end;
$$;

/**
 * Signup-month cohorts and how many of each cohort were still active N months
 * later. Emitted long (one row per cohort/offset) so it pivots cleanly in Excel.
 */
create or replace function public.analytics_retention(p_months integer default 12)
returns table (
  cohort_month   date,
  cohort_size    bigint,
  month_offset   integer,
  active_orgs    bigint,
  retention_pct  numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform private.require_analytics('investor');

  return query
  with cohorts as (
    select date_trunc('month', o.created_at) as cohort_month,
           o.id as org_id
    from public.orgs o
    where o.created_at >= date_trunc('month', now()) - ((least(greatest(p_months, 1), 36) - 1) * interval '1 month')
  ),
  sized as (
    select cohort_month, count(*) as cohort_size from cohorts group by cohort_month
  ),
  activity as (
    select org_id, date_trunc('month', seen_at) as active_month from (
      select org_id, last_seen_at as seen_at from public.feature_usage_sessions
      union all
      select org_id, created_at from public.usage_events) a
    group by 1, 2
  )
  select
    s.cohort_month::date,
    s.cohort_size,
    (extract(year from age(m.month, s.cohort_month)) * 12
      + extract(month from age(m.month, s.cohort_month)))::integer as month_offset,
    count(distinct a.org_id) as active_orgs,
    round(count(distinct a.org_id) * 100.0 / nullif(s.cohort_size, 0), 1)
  from sized s
  join lateral generate_series(s.cohort_month, date_trunc('month', now()), interval '1 month') as m(month) on true
  left join cohorts c on c.cohort_month = s.cohort_month
  left join activity a on a.org_id = c.org_id and a.active_month = m.month
  group by s.cohort_month, s.cohort_size, m.month
  order by s.cohort_month desc, 3;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — signed-in users only; anon has no business here at all
-- ---------------------------------------------------------------------------

revoke all on function public.analytics_whoami()                                     from public, anon;
revoke all on function public.analytics_summary(timestamptz, timestamptz)            from public, anon;
revoke all on function public.analytics_monthly(integer)                             from public, anon;
revoke all on function public.analytics_features(timestamptz, timestamptz)           from public, anon;
revoke all on function public.analytics_accounts(timestamptz, timestamptz, integer)  from public, anon;
revoke all on function public.analytics_plan_mix()                                   from public, anon;
revoke all on function public.analytics_retention(integer)                           from public, anon;
revoke all on function public.feature_heartbeat(text, uuid, integer, text, integer)  from public, anon;

grant execute on function public.analytics_whoami()                                     to authenticated;
grant execute on function public.analytics_summary(timestamptz, timestamptz)            to authenticated;
grant execute on function public.analytics_monthly(integer)                             to authenticated;
grant execute on function public.analytics_features(timestamptz, timestamptz)           to authenticated;
grant execute on function public.analytics_accounts(timestamptz, timestamptz, integer)  to authenticated;
grant execute on function public.analytics_plan_mix()                                   to authenticated;
grant execute on function public.analytics_retention(integer)                           to authenticated;
grant execute on function public.feature_heartbeat(text, uuid, integer, text, integer)  to authenticated;

-- Private helpers are never called directly by a client.
revoke all on function private.analytics_scope()                                                             from public, anon, authenticated;
revoke all on function private.require_analytics(public.analytics_scope)                                     from public, anon, authenticated;
revoke all on function private.plan_mrr_cents(text, public.billing_interval, integer, public.subscription_status) from public, anon, authenticated;
revoke all on function private.mrr_cents_at(timestamptz)                                                     from public, anon, authenticated;
revoke all on function private.seats_at(timestamptz)                                                         from public, anon, authenticated;
revoke all on function private.paying_orgs_at(timestamptz)                                                   from public, anon, authenticated;
revoke all on function private.pct_change(numeric, numeric)                                                  from public, anon, authenticated;
