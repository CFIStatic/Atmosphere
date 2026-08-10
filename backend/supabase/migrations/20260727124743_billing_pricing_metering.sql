-- NOTE: repo copy of this migration. It is ALREADY APPLIED to project
-- ccxatzfsvzetciiwsjlj as version 20260727124743; the authoritative applied text
-- (md5 ada55695eeee6892dd3b981ef7a7feda, 42573 bytes) is recorded in supabase_migrations.schema_migrations
-- and may differ from this copy in comments or whitespace. Do not re-run by hand.
--
-- ============================================================================
-- Atmosphere — pricing, metering, credits and subscriptions
-- ============================================================================
--
-- Money is stored as BIGINT **nanodollars** (1e-9 USD) everywhere. Floats are
-- never used for money, and micro-dollars are too coarse: a single cached-read
-- token on Haiku costs 200 nanodollars, which would round to zero at 1e-6
-- granularity and silently give away usage. 1 credit == 1 USD == 1e9 nanos.
--
-- Margin is never exposed to the client. What we PAY (`private.model_costs`)
-- lives in the private schema, which PostgREST does not expose. What we CHARGE
-- (`public.model_rate_card`) is a separate, readable table derived from it by
-- `private.sync_rate_card()`. A customer can read the rate card and can never
-- read the cost basis or the markup.
--
-- Every balance-changing write goes through a SECURITY DEFINER function that
-- validates `auth.uid()` internally — the same pattern as create_org/join_org.
-- The billing tables therefore carry SELECT policies only: there is no way to
-- mint credits by POSTing to a table.
-- ============================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.billing_interval as enum ('monthly', 'annual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum ('active', 'trialing', 'past_due', 'canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Where a lot of credits came from. Plan credits expire at the end of the
  -- billing period; purchased credits are paid for and must not silently
  -- vanish, so they are consumed only after plan credits are exhausted.
  create type public.credit_bucket as enum ('plan', 'purchased', 'promotional');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_entry_type as enum
    ('plan_grant', 'purchase', 'usage', 'refund', 'expiration', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.purchase_status as enum ('pending', 'completed', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Billing is money: viewing it is fine for any member, but changing the plan,
-- buying credits or setting a spend limit is restricted to the roles that would
-- actually hold the company card, plus whoever created the organization.
create or replace function private.can_manage_billing(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('accountant', 'office_manager', 'project_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Cost basis (PRIVATE — never reaches the browser)
-- ---------------------------------------------------------------------------

create table if not exists private.model_costs (
  model_id                   text primary key,
  display_name               text not null,
  family                     text not null,
  provider                   text not null default 'anthropic',

  -- What the upstream provider charges us, USD per million tokens.
  input_cost_per_mtok        numeric(12, 6) not null check (input_cost_per_mtok >= 0),
  output_cost_per_mtok       numeric(12, 6) not null check (output_cost_per_mtok >= 0),

  -- Provider multipliers, applied to the INPUT rate. These are structural
  -- (they mirror how the upstream API prices cache traffic), so they multiply
  -- cost and sell price identically and the margin ratio is preserved.
  cache_write_5m_multiplier  numeric(6, 4) not null default 1.25,
  cache_write_1h_multiplier  numeric(6, 4) not null default 2.0,
  cache_read_multiplier      numeric(6, 4) not null default 0.1,
  batch_multiplier           numeric(6, 4) not null default 0.5,

  -- Resale markup. 2.0 == we sell at twice what we buy for.
  markup                     numeric(6, 4) not null default 2.0 check (markup >= 1),

  context_window             integer,
  max_output_tokens          integer,
  is_active                  boolean not null default true,
  sort_order                 integer not null default 100,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists model_costs_touch on private.model_costs;
create trigger model_costs_touch before update on private.model_costs
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Customer-facing rate card (sell prices only)
-- ---------------------------------------------------------------------------

create table if not exists public.model_rate_card (
  model_id                        text primary key,
  display_name                    text not null,
  family                          text not null,
  input_price_per_mtok            numeric(12, 6) not null,
  output_price_per_mtok           numeric(12, 6) not null,
  cache_write_5m_price_per_mtok   numeric(12, 6) not null,
  cache_write_1h_price_per_mtok   numeric(12, 6) not null,
  cache_read_price_per_mtok       numeric(12, 6) not null,
  batch_discount_pct              numeric(5, 2) not null,
  context_window                  integer,
  max_output_tokens               integer,
  is_active                       boolean not null default true,
  sort_order                      integer not null default 100,
  updated_at                      timestamptz not null default now()
);

alter table public.model_rate_card enable row level security;

drop policy if exists model_rate_card_select on public.model_rate_card;
create policy model_rate_card_select on public.model_rate_card
  for select using (true);

-- Projects the private cost basis through the markup. Called after any change
-- to costs or markup so the two can never drift apart.
create or replace function private.sync_rate_card()
returns integer
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  insert into public.model_rate_card as rc (
    model_id, display_name, family,
    input_price_per_mtok, output_price_per_mtok,
    cache_write_5m_price_per_mtok, cache_write_1h_price_per_mtok,
    cache_read_price_per_mtok, batch_discount_pct,
    context_window, max_output_tokens, is_active, sort_order, updated_at
  )
  select
    c.model_id, c.display_name, c.family,
    round(c.input_cost_per_mtok  * c.markup, 6),
    round(c.output_cost_per_mtok * c.markup, 6),
    round(c.input_cost_per_mtok * c.markup * c.cache_write_5m_multiplier, 6),
    round(c.input_cost_per_mtok * c.markup * c.cache_write_1h_multiplier, 6),
    round(c.input_cost_per_mtok * c.markup * c.cache_read_multiplier, 6),
    round((1 - c.batch_multiplier) * 100, 2),
    c.context_window, c.max_output_tokens, c.is_active, c.sort_order, now()
  from private.model_costs c
  on conflict (model_id) do update set
    display_name                  = excluded.display_name,
    family                        = excluded.family,
    input_price_per_mtok          = excluded.input_price_per_mtok,
    output_price_per_mtok         = excluded.output_price_per_mtok,
    cache_write_5m_price_per_mtok = excluded.cache_write_5m_price_per_mtok,
    cache_write_1h_price_per_mtok = excluded.cache_write_1h_price_per_mtok,
    cache_read_price_per_mtok     = excluded.cache_read_price_per_mtok,
    batch_discount_pct            = excluded.batch_discount_pct,
    context_window                = excluded.context_window,
    max_output_tokens             = excluded.max_output_tokens,
    is_active                     = excluded.is_active,
    sort_order                    = excluded.sort_order,
    updated_at                    = now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan catalog
-- ---------------------------------------------------------------------------

create table if not exists public.billing_plans (
  code                    text primary key,
  name                    text not null,
  tagline                 text,
  monthly_price_cents     integer not null check (monthly_price_cents >= 0),
  -- Per-month price when billed annually (0 for free, null for "contact us").
  annual_price_cents      integer check (annual_price_cents >= 0),
  -- Usage credits granted at the start of every billing period. Per seat when
  -- `per_seat` is true. Kept at 1.25x the plan price: at a 2x markup that is a
  -- 37.5% gross margin even when a customer burns the whole allowance.
  included_credits_nanos  bigint not null default 0 check (included_credits_nanos >= 0),
  per_seat                boolean not null default false,
  min_seats               integer not null default 1 check (min_seats >= 1),
  -- Relative throughput ceiling vs. the Pro plan (this is what "5x"/"20x" mean).
  rate_multiplier         numeric(6, 2) not null default 1,
  features                jsonb not null default '[]'::jsonb,
  is_contact_sales        boolean not null default false,
  is_active               boolean not null default true,
  sort_order              integer not null default 100
);

alter table public.billing_plans enable row level security;

drop policy if exists billing_plans_select on public.billing_plans;
create policy billing_plans_select on public.billing_plans
  for select using (true);

-- ---------------------------------------------------------------------------
-- Prepaid credit packs
-- ---------------------------------------------------------------------------

create table if not exists public.credit_packs (
  code           text primary key,
  name           text not null,
  price_cents    integer not null check (price_cents > 0),
  credits_nanos  bigint not null check (credits_nanos > 0),
  -- Volume kicker, granted on top of the face value.
  bonus_nanos    bigint not null default 0 check (bonus_nanos >= 0),
  is_active      boolean not null default true,
  sort_order     integer not null default 100
);

alter table public.credit_packs enable row level security;

drop policy if exists credit_packs_select on public.credit_packs;
create policy credit_packs_select on public.credit_packs
  for select using (true);

-- ---------------------------------------------------------------------------
-- Per-organization subscription + billing settings
-- ---------------------------------------------------------------------------

create table if not exists public.org_billing (
  org_id                      uuid primary key references public.orgs(id) on delete cascade,
  plan_code                   text not null references public.billing_plans(code) default 'free',
  billing_interval            public.billing_interval not null default 'monthly',
  seats                       integer not null default 1 check (seats >= 1),
  status                      public.subscription_status not null default 'active',
  period_start                timestamptz not null default now(),
  period_end                  timestamptz not null default (now() + interval '1 month'),
  cancel_at_period_end        boolean not null default false,

  -- Auto-reload, as Anthropic and OpenAI do it: when the balance drops below
  -- the threshold, buy another `amount` of credits.
  auto_reload_enabled         boolean not null default false,
  auto_reload_threshold_nanos bigint not null default 5000000000,   -- $5
  auto_reload_amount_nanos    bigint not null default 25000000000,  -- $25

  -- Hard ceiling on billable usage inside one period. NULL == uncapped.
  monthly_spend_limit_nanos   bigint check (monthly_spend_limit_nanos >= 0),

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.org_billing enable row level security;

drop policy if exists org_billing_select on public.org_billing;
create policy org_billing_select on public.org_billing
  for select using (private.is_org_member(org_id));

drop trigger if exists org_billing_touch on public.org_billing;
create trigger org_billing_touch before update on public.org_billing
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Credit lots — the live balance, consumed FIFO
-- ---------------------------------------------------------------------------

create table if not exists public.credit_lots (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  bucket          public.credit_bucket not null,
  granted_nanos   bigint not null check (granted_nanos > 0),
  remaining_nanos bigint not null check (remaining_nanos >= 0),
  -- NULL means "never expires" (purchased credits).
  expires_at      timestamptz,
  purchase_id     uuid,
  description     text,
  created_at      timestamptz not null default now(),
  constraint credit_lots_remaining_within_grant check (remaining_nanos <= granted_nanos)
);

alter table public.credit_lots enable row level security;

drop policy if exists credit_lots_select on public.credit_lots;
create policy credit_lots_select on public.credit_lots
  for select using (private.is_org_member(org_id));

-- Consumption order: soonest-expiring first, then oldest. Plan credits are
-- always dated and purchased credits are not, so this spends the credits the
-- customer would otherwise lose before the ones they paid cash for.
create index if not exists credit_lots_spend_order
  on public.credit_lots (org_id, expires_at nulls last, created_at)
  where remaining_nanos > 0;

-- ---------------------------------------------------------------------------
-- Credit ledger — append-only audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  entry_type     public.ledger_entry_type not null,
  bucket         public.credit_bucket,
  -- Signed: positive adds credits, negative consumes them.
  amount_nanos   bigint not null,
  description    text,
  lot_id         uuid references public.credit_lots(id) on delete set null,
  usage_event_id uuid,
  purchase_id    uuid,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select using (private.is_org_member(org_id));

create index if not exists credit_ledger_org_time
  on public.credit_ledger (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Credit purchases
-- ---------------------------------------------------------------------------

create table if not exists public.credit_purchases (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  pack_code       text references public.credit_packs(code),
  credits_nanos   bigint not null check (credits_nanos > 0),
  bonus_nanos     bigint not null default 0 check (bonus_nanos >= 0),
  amount_cents    integer not null check (amount_cents > 0),
  currency        text not null default 'usd',
  status          public.purchase_status not null default 'pending',
  -- Payment processor that owns this charge, and its identifier there. The
  -- unique constraint is what makes webhook redelivery safe.
  provider        text not null default 'manual',
  provider_ref    text,
  is_auto_reload  boolean not null default false,
  failure_reason  text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

alter table public.credit_purchases enable row level security;

drop policy if exists credit_purchases_select on public.credit_purchases;
create policy credit_purchases_select on public.credit_purchases
  for select using (private.is_org_member(org_id));

create unique index if not exists credit_purchases_provider_ref
  on public.credit_purchases (provider, provider_ref)
  where provider_ref is not null;

create index if not exists credit_purchases_org_time
  on public.credit_purchases (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Metered usage
-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.orgs(id) on delete cascade,
  user_id                 uuid references auth.users(id) on delete set null,
  -- Caller-supplied idempotency key. A retried request must not double-bill.
  request_id              text not null,
  model_id                text not null,
  feature                 text,

  input_tokens            bigint not null default 0 check (input_tokens >= 0),
  output_tokens           bigint not null default 0 check (output_tokens >= 0),
  cache_write_5m_tokens   bigint not null default 0 check (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens   bigint not null default 0 check (cache_write_1h_tokens >= 0),
  cache_read_tokens       bigint not null default 0 check (cache_read_tokens >= 0),
  is_batch                boolean not null default false,

  -- What the upstream provider charged us, and what we charged the customer.
  cost_nanos              bigint not null check (cost_nanos >= 0),
  price_nanos             bigint not null check (price_nanos >= 0),
  margin_nanos            bigint generated always as (price_nanos - cost_nanos) stored,
  breakdown               jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now()
);

alter table public.usage_events enable row level security;

drop policy if exists usage_events_select on public.usage_events;
create policy usage_events_select on public.usage_events
  for select using (private.is_org_member(org_id));

create unique index if not exists usage_events_idempotency
  on public.usage_events (org_id, request_id);

create index if not exists usage_events_org_time
  on public.usage_events (org_id, created_at desc);

-- Pre-aggregated per org/day/model so the usage dashboard never scans the raw
-- event stream.
create table if not exists public.usage_daily (
  org_id                uuid not null references public.orgs(id) on delete cascade,
  day                   date not null,
  model_id              text not null,
  events                integer not null default 0,
  input_tokens          bigint not null default 0,
  output_tokens         bigint not null default 0,
  cache_write_tokens    bigint not null default 0,
  cache_read_tokens     bigint not null default 0,
  cost_nanos            bigint not null default 0,
  price_nanos           bigint not null default 0,
  primary key (org_id, day, model_id)
);

alter table public.usage_daily enable row level security;

drop policy if exists usage_daily_select on public.usage_daily;
create policy usage_daily_select on public.usage_daily
  for select using (private.is_org_member(org_id));

create or replace function private.rollup_usage_daily()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.usage_daily as d (
    org_id, day, model_id, events,
    input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
    cost_nanos, price_nanos
  )
  values (
    new.org_id, (new.created_at at time zone 'utc')::date, new.model_id, 1,
    new.input_tokens, new.output_tokens,
    new.cache_write_5m_tokens + new.cache_write_1h_tokens, new.cache_read_tokens,
    new.cost_nanos, new.price_nanos
  )
  on conflict (org_id, day, model_id) do update set
    events             = d.events + 1,
    input_tokens       = d.input_tokens + excluded.input_tokens,
    output_tokens      = d.output_tokens + excluded.output_tokens,
    cache_write_tokens = d.cache_write_tokens + excluded.cache_write_tokens,
    cache_read_tokens  = d.cache_read_tokens + excluded.cache_read_tokens,
    cost_nanos         = d.cost_nanos + excluded.cost_nanos,
    price_nanos        = d.price_nanos + excluded.price_nanos;
  return new;
end;
$$;

drop trigger if exists usage_events_rollup on public.usage_events;
create trigger usage_events_rollup after insert on public.usage_events
  for each row execute function private.rollup_usage_daily();

-- ============================================================================
-- Pricing engine
-- ============================================================================

-- Prices one call in both directions: what it costs us and what we charge.
-- Pure arithmetic, no writes — safe to call for quotes and estimates.
--
-- nanos = tokens * (usd_per_mtok) * 1000, because 1e9 nanos/USD / 1e6 tokens
-- per MTok collapses to a factor of 1000. Rounding happens once, on the total.
create or replace function private.price_usage(
  p_model_id              text,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens     bigint default 0,
  p_is_batch              boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
declare
  c            private.model_costs%rowtype;
  v_batch      numeric;
  v_cost_in    numeric;
  v_cost_out   numeric;
  v_cost_cw5   numeric;
  v_cost_cw1h  numeric;
  v_cost_cr    numeric;
  v_cost       numeric;
  v_price      numeric;
begin
  select * into c from private.model_costs where model_id = p_model_id;
  if not found then
    raise exception 'unknown_model' using detail = p_model_id, errcode = 'P0002';
  end if;
  if not c.is_active then
    raise exception 'model_inactive' using detail = p_model_id, errcode = 'P0002';
  end if;

  v_batch := case when p_is_batch then c.batch_multiplier else 1 end;

  -- Per-component COST in nanodollars (unrounded).
  v_cost_in   := p_input_tokens          * c.input_cost_per_mtok  * 1000 * v_batch;
  v_cost_out  := p_output_tokens         * c.output_cost_per_mtok * 1000 * v_batch;
  v_cost_cw5  := p_cache_write_5m_tokens * c.input_cost_per_mtok  * 1000 * c.cache_write_5m_multiplier * v_batch;
  v_cost_cw1h := p_cache_write_1h_tokens * c.input_cost_per_mtok  * 1000 * c.cache_write_1h_multiplier * v_batch;
  v_cost_cr   := p_cache_read_tokens     * c.input_cost_per_mtok  * 1000 * c.cache_read_multiplier     * v_batch;

  v_cost  := v_cost_in + v_cost_out + v_cost_cw5 + v_cost_cw1h + v_cost_cr;
  v_price := v_cost * c.markup;

  return jsonb_build_object(
    'model_id',    c.model_id,
    'is_batch',    p_is_batch,
    'cost_nanos',  round(v_cost)::bigint,
    'price_nanos', round(v_price)::bigint,
    'breakdown',   jsonb_build_object(
      'input',          jsonb_build_object('tokens', p_input_tokens,          'price_nanos', round(v_cost_in   * c.markup)::bigint),
      'output',         jsonb_build_object('tokens', p_output_tokens,         'price_nanos', round(v_cost_out  * c.markup)::bigint),
      'cache_write_5m', jsonb_build_object('tokens', p_cache_write_5m_tokens, 'price_nanos', round(v_cost_cw5  * c.markup)::bigint),
      'cache_write_1h', jsonb_build_object('tokens', p_cache_write_1h_tokens, 'price_nanos', round(v_cost_cw1h * c.markup)::bigint),
      'cache_read',     jsonb_build_object('tokens', p_cache_read_tokens,     'price_nanos', round(v_cost_cr   * c.markup)::bigint)
    )
  );
end;
$$;

-- Customer-facing quote. Identical maths, but the cost basis is stripped out
-- before the result leaves the database.
create or replace function public.quote_usage(
  p_model_id              text,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens     bigint default 0,
  p_is_batch              boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
  select private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  ) - 'cost_nanos';
$$;

-- ============================================================================
-- Balance & billing period
-- ============================================================================

create or replace function public.credit_balance(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_result jsonb;
begin
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_nanos',     coalesce(sum(remaining_nanos), 0),
    'plan_nanos',      coalesce(sum(remaining_nanos) filter (where bucket = 'plan'), 0),
    'purchased_nanos', coalesce(sum(remaining_nanos) filter (where bucket = 'purchased'), 0),
    'promo_nanos',     coalesce(sum(remaining_nanos) filter (where bucket = 'promotional'), 0),
    'next_expiry',     min(expires_at) filter (where expires_at is not null)
  )
  into v_result
  from public.credit_lots
  where org_id = p_org
    and remaining_nanos > 0
    and (expires_at is null or expires_at > now());

  return v_result;
end;
$$;

-- Expires elapsed lots and rolls the billing period forward, granting the
-- plan's included credits for each period that has begun. Idempotent, and
-- called on every billing read so the system self-heals without a scheduler.
create or replace function private.advance_billing_period(p_org uuid)
returns public.org_billing
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b         public.org_billing%rowtype;
  p         public.billing_plans%rowtype;
  v_grant   bigint;
  v_lot     uuid;
  v_guard   integer := 0;
  v_created boolean := false;
begin
  -- Lock the row so two concurrent readers cannot both grant the same period.
  select * into b from public.org_billing where org_id = p_org for update;

  if not found then
    insert into public.org_billing (org_id, period_start, period_end)
    values (p_org, now(), now() + interval '1 month')
    on conflict (org_id) do nothing;
    select * into b from public.org_billing where org_id = p_org for update;
    v_created := true;
  end if;

  select * into p from public.billing_plans where code = b.plan_code;

  -- The opening period has to be granted here. The roll-forward loop below
  -- only fires once a period has ELAPSED, so without this a brand-new
  -- organization would sit at a zero balance until its second month.
  if v_created then
    v_grant := coalesce(p.included_credits_nanos, 0) * (case when p.per_seat then b.seats else 1 end);
    if v_grant > 0 then
      insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, expires_at, description)
      values (p_org, 'plan', v_grant, v_grant, b.period_end, p.name || ' plan credits')
      returning id into v_lot;

      insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
      values (p_org, 'plan_grant', 'plan', v_grant, p.name || ' plan credits', v_lot);
    end if;
  end if;

  -- Retire anything past its expiry, recording the write-off.
  insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
  select org_id, 'expiration', bucket, -remaining_nanos, 'Credits expired', id
  from public.credit_lots
  where org_id = p_org and remaining_nanos > 0
    and expires_at is not null and expires_at <= now();

  update public.credit_lots
     set remaining_nanos = 0
   where org_id = p_org and remaining_nanos > 0
     and expires_at is not null and expires_at <= now();

  -- Roll forward one period at a time so a long-dormant org still gets exactly
  -- one grant per elapsed period rather than a single lump sum.
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

    v_grant := coalesce(p.included_credits_nanos, 0) * (case when p.per_seat then b.seats else 1 end);

    if v_grant > 0 then
      insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, expires_at, description)
      values (p_org, 'plan', v_grant, v_grant, b.period_end, p.name || ' plan credits')
      returning id into v_lot;

      insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
      values (p_org, 'plan_grant', 'plan', v_grant, p.name || ' plan credits', v_lot);
    end if;
  end loop;

  return b;
end;
$$;

-- ============================================================================
-- Metering — the one place credits are consumed
-- ============================================================================

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
  v_balance   bigint;
  v_existing  public.usage_events%rowtype;
  v_event_id  uuid;
  b           public.org_billing%rowtype;
  v_spent     bigint;
  v_remaining bigint;
  v_take      bigint;
  lot         record;
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

  -- Idempotency: a replayed request returns the original receipt untouched.
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

  -- Spend limit is evaluated against the current period only.
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

  select coalesce(sum(remaining_nanos), 0) into v_balance
  from public.credit_lots
  where org_id = p_org and remaining_nanos > 0
    and (expires_at is null or expires_at > now());

  if v_balance < v_price then
    raise exception 'insufficient_credits'
      using detail = format('balance=%s required=%s', v_balance, v_price),
            errcode = 'P0001';
  end if;

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

  -- Draw down lots in expiry order, one ledger row per lot touched.
  v_remaining := v_price;
  for lot in
    select id, bucket, remaining_nanos
    from public.credit_lots
    where org_id = p_org and remaining_nanos > 0
      and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at
    for update
  loop
    exit when v_remaining <= 0;

    v_take := least(lot.remaining_nanos, v_remaining);

    update public.credit_lots
       set remaining_nanos = remaining_nanos - v_take
     where id = lot.id;

    insert into public.credit_ledger (
      org_id, entry_type, bucket, amount_nanos, description, lot_id, usage_event_id, created_by
    ) values (
      p_org, 'usage', lot.bucket, -v_take, p_model_id || ' usage', lot.id, v_event_id, v_uid
    );

    v_remaining := v_remaining - v_take;
  end loop;

  return jsonb_build_object(
    'event_id',    v_event_id,
    'price_nanos', v_price,
    'breakdown',   v_priced -> 'breakdown',
    'duplicate',   false,
    'balance',     public.credit_balance(p_org)
  );
end;
$$;

-- ============================================================================
-- Subscription & settings management
-- ============================================================================

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
  b       public.org_billing%rowtype;
  p       public.billing_plans%rowtype;
  v_grant bigint;
  v_lot   uuid;
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

  -- Downgrading to free is deferred to the period end so the customer keeps
  -- what they already paid for. Every other change takes effect now, which
  -- means the old plan's allowance is retired and the new one is granted.
  if p_plan = 'free' and b.plan_code <> 'free' then
    update public.org_billing set cancel_at_period_end = true where org_id = p_org;
    return jsonb_build_object(
      'plan', b.plan_code, 'changed', true, 'effective_at', b.period_end,
      'cancel_at_period_end', true, 'balance', public.credit_balance(p_org)
    );
  end if;

  insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id, created_by)
  select org_id, 'expiration', 'plan', -remaining_nanos, 'Plan changed', id, auth.uid()
  from public.credit_lots
  where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.credit_lots set remaining_nanos = 0
   where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

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

  v_grant := p.included_credits_nanos * (case when p.per_seat then p_seats else 1 end);

  if v_grant > 0 then
    insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, expires_at, description)
    values (p_org, 'plan', v_grant, v_grant, b.period_end, p.name || ' plan credits')
    returning id into v_lot;

    insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id, created_by)
    values (p_org, 'plan_grant', 'plan', v_grant, p.name || ' plan credits', v_lot, auth.uid());
  end if;

  return jsonb_build_object(
    'plan', p_plan, 'changed', true, 'seats', p_seats,
    'period_end', b.period_end, 'granted_nanos', v_grant,
    'balance', public.credit_balance(p_org)
  );
end;
$$;

create or replace function public.set_billing_settings(
  p_org                       uuid,
  p_auto_reload_enabled       boolean default null,
  p_auto_reload_threshold     bigint  default null,
  p_auto_reload_amount        bigint  default null,
  p_monthly_spend_limit       bigint  default null,
  p_clear_spend_limit         boolean default false
)
returns public.org_billing
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b public.org_billing%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;

  perform private.advance_billing_period(p_org);

  update public.org_billing
     set auto_reload_enabled = coalesce(p_auto_reload_enabled, auto_reload_enabled),
         auto_reload_threshold_nanos = coalesce(p_auto_reload_threshold, auto_reload_threshold_nanos),
         auto_reload_amount_nanos = coalesce(p_auto_reload_amount, auto_reload_amount_nanos),
         monthly_spend_limit_nanos =
           case when p_clear_spend_limit then null
                else coalesce(p_monthly_spend_limit, monthly_spend_limit_nanos) end
   where org_id = p_org
   returning * into b;

  return b;
end;
$$;

-- ============================================================================
-- Credit purchases
-- ============================================================================

-- Opens a purchase in `pending`. No credits exist until the payment provider
-- confirms, which is `complete_credit_purchase`'s job.
create or replace function public.start_credit_purchase(
  p_org            uuid,
  p_pack_code      text default null,
  p_amount_cents   integer default null,
  p_provider       text default 'manual',
  p_is_auto_reload boolean default false
)
returns public.credit_purchases
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pk       public.credit_packs%rowtype;
  v_credits bigint;
  v_bonus   bigint := 0;
  v_cents   integer;
  v_row     public.credit_purchases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;

  if p_pack_code is not null then
    select * into pk from public.credit_packs where code = p_pack_code and is_active;
    if not found then
      raise exception 'unknown_pack' using detail = p_pack_code, errcode = 'P0002';
    end if;
    v_credits := pk.credits_nanos;
    v_bonus   := pk.bonus_nanos;
    v_cents   := pk.price_cents;
  else
    if p_amount_cents is null or p_amount_cents < 500 then
      raise exception 'amount_below_minimum' using detail = '500', errcode = '22023';
    end if;
    if p_amount_cents > 10000000 then
      raise exception 'amount_above_maximum' using detail = '10000000', errcode = '22023';
    end if;
    -- Custom top-ups convert 1:1 — one cent buys ten million nanodollars.
    v_credits := p_amount_cents::bigint * 10000000;
    v_cents   := p_amount_cents;
  end if;

  insert into public.credit_purchases (
    org_id, pack_code, credits_nanos, bonus_nanos, amount_cents,
    provider, is_auto_reload, created_by
  ) values (
    p_org, p_pack_code, v_credits, v_bonus, v_cents,
    p_provider, p_is_auto_reload, auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Settles a pending purchase and mints the credits. Callable by the service
-- role (the payment webhook path) or, for the `dev` provider only, by a
-- billing manager so the flow is exercisable before a processor is wired up.
create or replace function public.complete_credit_purchase(
  p_purchase_id  uuid,
  p_provider_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pu        public.credit_purchases%rowtype;
  v_is_svc  boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_total   bigint;
  v_lot     uuid;
begin
  select * into pu from public.credit_purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'unknown_purchase' using errcode = 'P0002';
  end if;

  if not v_is_svc then
    if pu.provider <> 'dev' then
      raise exception 'payment_confirmation_forbidden' using errcode = '42501';
    end if;
    if not private.can_manage_billing(pu.org_id) then
      raise exception 'billing_forbidden' using errcode = '42501';
    end if;
  end if;

  if pu.status = 'completed' then
    return jsonb_build_object('purchase_id', pu.id, 'status', pu.status,
                              'duplicate', true, 'balance', public.credit_balance(pu.org_id));
  end if;
  if pu.status <> 'pending' then
    raise exception 'purchase_not_pending' using detail = pu.status::text, errcode = 'P0001';
  end if;

  v_total := pu.credits_nanos + pu.bonus_nanos;

  insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, purchase_id, description)
  values (pu.org_id, 'purchased', v_total, v_total, pu.id,
          coalesce(pu.pack_code, 'custom') || ' credit purchase')
  returning id into v_lot;

  insert into public.credit_ledger (
    org_id, entry_type, bucket, amount_nanos, description, lot_id, purchase_id, created_by
  ) values (
    pu.org_id, 'purchase', 'purchased', v_total,
    coalesce(pu.pack_code, 'custom') || ' credit purchase', v_lot, pu.id, pu.created_by
  );

  update public.credit_purchases
     set status = 'completed',
         completed_at = now(),
         provider_ref = coalesce(p_provider_ref, provider_ref)
   where id = pu.id;

  return jsonb_build_object(
    'purchase_id', pu.id, 'status', 'completed', 'duplicate', false,
    'credited_nanos', v_total, 'balance', public.credit_balance(pu.org_id)
  );
end;
$$;

create or replace function public.fail_credit_purchase(
  p_purchase_id uuid,
  p_reason      text default null
)
returns public.credit_purchases
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pu       public.credit_purchases%rowtype;
  v_is_svc boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  select * into pu from public.credit_purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'unknown_purchase' using errcode = 'P0002';
  end if;
  if not v_is_svc and not private.can_manage_billing(pu.org_id) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;
  if pu.status <> 'pending' then
    raise exception 'purchase_not_pending' using detail = pu.status::text, errcode = 'P0001';
  end if;

  update public.credit_purchases
     set status = 'failed', failure_reason = p_reason
   where id = pu.id
   returning * into pu;

  return pu;
end;
$$;

-- ============================================================================
-- Read model for the billing screen — one round trip
-- ============================================================================

create or replace function public.billing_overview(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b          public.org_billing%rowtype;
  p          public.billing_plans%rowtype;
  v_usage    jsonb;
  v_by_model jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  b := private.advance_billing_period(p_org);
  select * into p from public.billing_plans where code = b.plan_code;

  select jsonb_build_object(
    'events',        coalesce(count(*), 0),
    'price_nanos',   coalesce(sum(price_nanos), 0),
    'input_tokens',  coalesce(sum(input_tokens), 0),
    'output_tokens', coalesce(sum(output_tokens), 0),
    'cache_tokens',  coalesce(sum(cache_write_5m_tokens + cache_write_1h_tokens + cache_read_tokens), 0)
  )
  into v_usage
  from public.usage_events
  where org_id = p_org and created_at >= b.period_start;

  select coalesce(jsonb_agg(t order by t.price_nanos desc), '[]'::jsonb)
  into v_by_model
  from (
    select u.model_id,
           coalesce(rc.display_name, u.model_id) as display_name,
           count(*)::bigint                     as events,
           sum(u.input_tokens)                  as input_tokens,
           sum(u.output_tokens)                 as output_tokens,
           sum(u.price_nanos)                   as price_nanos
    from public.usage_events u
    left join public.model_rate_card rc on rc.model_id = u.model_id
    where u.org_id = p_org and u.created_at >= b.period_start
    group by u.model_id, rc.display_name
  ) t;

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
    'period_usage', v_usage,
    'usage_by_model', v_by_model,
    'can_manage', private.can_manage_billing(p_org)
  );
end;
$$;

-- ============================================================================
-- Grants — the API surface is the functions, not the tables
-- ============================================================================

revoke all on private.model_costs from anon, authenticated;
revoke all on schema private from anon, authenticated;

revoke all on function private.price_usage(text, bigint, bigint, bigint, bigint, bigint, boolean) from anon, authenticated;
revoke all on function private.advance_billing_period(uuid) from anon, authenticated;
revoke all on function private.sync_rate_card() from anon, authenticated;

-- Postgres grants EXECUTE to PUBLIC by default, which would put the whole
-- billing surface within reach of the `anon` role. Every function fails closed
-- on its own auth.uid()/membership check, but an unauthenticated caller should
-- not reach billing at all — revoke first, then re-grant deliberately.
revoke execute on function public.credit_balance(uuid) from public, anon;
revoke execute on function public.billing_overview(uuid) from public, anon;
revoke execute on function public.record_usage(uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) from public, anon;
revoke execute on function public.set_billing_plan(uuid, text, public.billing_interval, integer) from public, anon;
revoke execute on function public.set_billing_settings(uuid, boolean, bigint, bigint, bigint, boolean) from public, anon;
revoke execute on function public.start_credit_purchase(uuid, text, integer, text, boolean) from public, anon;
revoke execute on function public.complete_credit_purchase(uuid, text) from public, anon;
revoke execute on function public.fail_credit_purchase(uuid, text) from public, anon;

-- quote_usage stays reachable by anon on purpose: it is a pure calculator over
-- the public rate card, touches no organization data, and powers the pricing
-- page for signed-out visitors.
grant execute on function public.quote_usage(text, bigint, bigint, bigint, bigint, bigint, boolean) to authenticated;
grant execute on function public.credit_balance(uuid) to authenticated;
grant execute on function public.billing_overview(uuid) to authenticated;
grant execute on function public.record_usage(uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) to authenticated;
grant execute on function public.set_billing_plan(uuid, text, public.billing_interval, integer) to authenticated;
grant execute on function public.set_billing_settings(uuid, boolean, bigint, bigint, bigint, boolean) to authenticated;
grant execute on function public.start_credit_purchase(uuid, text, integer, text, boolean) to authenticated;
grant execute on function public.complete_credit_purchase(uuid, text) to authenticated;
grant execute on function public.fail_credit_purchase(uuid, text) to authenticated;

-- ============================================================================
-- Seed data
-- ============================================================================

-- Upstream list prices, USD per million tokens. `markup` turns these into what
-- we charge; the rate card is regenerated from them below.
insert into private.model_costs (
  model_id, display_name, family, input_cost_per_mtok, output_cost_per_mtok,
  context_window, max_output_tokens, sort_order
) values
  ('claude-fable-5',   'Atmosphere Apex',     'apex',     10.0, 50.0, 1000000, 128000, 10),
  ('claude-opus-5',    'Atmosphere Pro',      'pro',       5.0, 25.0, 1000000, 128000, 20),
  ('claude-opus-4-8',  'Atmosphere Pro 4.8',  'pro',       5.0, 25.0, 1000000, 128000, 30),
  ('claude-sonnet-5',  'Atmosphere Core',     'core',      3.0, 15.0, 1000000, 128000, 40),
  ('claude-sonnet-4-6','Atmosphere Core 4.6', 'core',      3.0, 15.0, 1000000, 128000, 50),
  ('claude-haiku-4-5', 'Atmosphere Lite',     'lite',      1.0,  5.0,  200000,  64000, 60)
on conflict (model_id) do update set
  display_name        = excluded.display_name,
  family              = excluded.family,
  input_cost_per_mtok = excluded.input_cost_per_mtok,
  output_cost_per_mtok= excluded.output_cost_per_mtok,
  context_window      = excluded.context_window,
  max_output_tokens   = excluded.max_output_tokens,
  sort_order          = excluded.sort_order;

select private.sync_rate_card();

-- Plan tiers. `rate_multiplier` is what "5x" and "20x" refer to: throughput
-- relative to Pro. Included credits sit at 1.25x the plan price, so a fully
-- consumed allowance still clears a 37.5% gross margin at a 2x markup.
insert into public.billing_plans (
  code, name, tagline, monthly_price_cents, annual_price_cents,
  included_credits_nanos, per_seat, min_seats, rate_multiplier,
  features, is_contact_sales, sort_order
) values
  ('free', 'Free', 'Try Atmosphere on a single project', 0, 0,
   3000000000, false, 1, 0.2,
   '["$3 of usage credits each month","1 seat","Community support"]'::jsonb, false, 10),

  ('pro', 'Pro', 'For individual estimators and PMs', 2000, 1700,
   25000000000, false, 1, 1,
   '["$25 of usage credits each month","Priority model access","Email support","Usage analytics"]'::jsonb, false, 20),

  ('max_5x', 'Max 5x', 'Heavier daily workloads', 10000, 10000,
   125000000000, false, 1, 5,
   '["$125 of usage credits each month","5x Pro throughput","Priority support","Batch processing"]'::jsonb, false, 30),

  ('max_20x', 'Max 20x', 'Power users running all day', 20000, 20000,
   250000000000, false, 1, 20,
   '["$250 of usage credits each month","20x Pro throughput","Priority support","Batch processing"]'::jsonb, false, 40),

  ('team', 'Team', 'Shared credits across the crew', 3000, 2500,
   40000000000, true, 5, 5,
   '["$40 of usage credits per seat each month","Pooled org credit balance","Central billing and spend limits","Role-based billing access"]'::jsonb, false, 50),

  ('enterprise', 'Enterprise', 'Custom volume and terms', 0, null,
   0, true, 25, 50,
   '["Custom credit allowance","Volume pricing","SSO and audit logs","Dedicated support"]'::jsonb, true, 60)
on conflict (code) do update set
  name                   = excluded.name,
  tagline                = excluded.tagline,
  monthly_price_cents    = excluded.monthly_price_cents,
  annual_price_cents     = excluded.annual_price_cents,
  included_credits_nanos = excluded.included_credits_nanos,
  per_seat               = excluded.per_seat,
  min_seats              = excluded.min_seats,
  rate_multiplier        = excluded.rate_multiplier,
  features               = excluded.features,
  is_contact_sales       = excluded.is_contact_sales,
  sort_order             = excluded.sort_order;

-- Prepaid packs. 1 credit == $1; larger packs carry a volume bonus.
insert into public.credit_packs (code, name, price_cents, credits_nanos, bonus_nanos, sort_order) values
  ('credits_10',   '$10 credits',    1000,   10000000000,           0, 10),
  ('credits_25',   '$25 credits',    2500,   25000000000,           0, 20),
  ('credits_50',   '$50 credits',    5000,   50000000000,           0, 30),
  ('credits_100',  '$100 credits',  10000,  100000000000,  3000000000, 40),
  ('credits_250',  '$250 credits',  25000,  250000000000, 10000000000, 50),
  ('credits_500',  '$500 credits',  50000,  500000000000, 25000000000, 60),
  ('credits_1000', '$1,000 credits',100000,1000000000000, 75000000000, 70)
on conflict (code) do update set
  name          = excluded.name,
  price_cents   = excluded.price_cents,
  credits_nanos = excluded.credits_nanos,
  bonus_nanos   = excluded.bonus_nanos,
  sort_order    = excluded.sort_order;
