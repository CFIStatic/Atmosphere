-- Atmosphere Analytics: corrections from the 2026-10-07 metric audit.
--
-- Changes what the staff analytics reports count. Writes no customer data
-- except (a) the one-time BACKFILL blocks below and (b) one "rebase" row per
-- org in org_billing_events so MRR history starts from the corrected model.
--
--  1. Internal / test / comp exclusion. orgs.exclude_from_analytics flags
--     internal and test orgs; orgs whose subscription id starts with comp_
--     count as internal automatically. Every report takes
--     p_include_internal (default false) and leaves those orgs out unless the
--     staff toggle "Include internal & test accounts" is on.
--  2. Revenue reads the real Atmosphere plan. MRR used to price orgs from the
--     legacy credits catalog (org_billing.plan_code -> billing_plans). The
--     Stripe webhook never writes plan_code (it writes atmosphere_plan_code),
--     so every real subscription recorded $0. MRR now comes from
--     org_billing.stripe_mrr_cents: the net monthly amount the webhook computes
--     from the Stripe subscription items (discounts applied, tax excluded,
--     annual / 12). Until that is set it falls back to the price catalog
--     (Starter $399, Work Verification $849, Scale $1,999, +$125 per extra Field
--     Capture seat; annual = 10x monthly / 12). Only a real Stripe subscription
--     (sub_...) in status active or past_due counts. Trialing, canceled, comp_
--     and test-mode (stripe_livemode = false) subscriptions count as $0.
--  3. Seats are Field Capture seats: included_fc_seats + extra_fc_seats on
--     paying orgs. Filled = private.field_capture_seats_used.
--  4. Churn = distinct orgs whose subscription leaves a paying status
--     (canceled etc.) in the month after carrying MRR > 0.
--  5. Time to analysis uses job_proofs.first_analysed_at (write-once trigger).
--     BACKFILL: first_analysed_at = analysed_at, except proofs re-analysed in a
--     bulk batch (an hour with >= 10 analyses finishing > 1 day after upload):
--     everything analysed in that hour and received before it stays NULL,
--     because its original analysis time was overwritten. The report counts
--     those separately instead of inventing a time.
--  6. Collected revenue = live-mode payments, tax excluded, refunds netted;
--     usage invoices are kind 'usage', not 'subscription'. payments.tax_cents
--     and payments.livemode are written by the webhook from now on (older rows:
--     NULL = tax 0, live).
--  7. Deleted jobs and videos are excluded (crm_jobs / job_proofs deleted_at).
--  8. Metering reads the real ledger (token_usage_events), not the empty
--     private.ai_usage_events.
--  9. The Feature usage AI column maps ledger features to catalog keys.
-- 10. pct_change divides by abs(prior), like the site.
--
-- Time zone: windows stay UTC (months = date_trunc in UTC, weeks Monday 00:00
-- UTC). The site labels them as UTC.
--
-- Report RPCs stay SECURITY DEFINER, gated by private.require_analytics,
-- EXECUTE for service_role only (20261002193000_internal_analytics_actor).

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.orgs
  add column if not exists exclude_from_analytics boolean not null default false,
  add column if not exists analytics_exclusion_reason text;

comment on column public.orgs.exclude_from_analytics is
  'Internal, test and demo orgs. Analytics leaves them out unless staff include internal & test accounts. comp_ subscriptions are excluded automatically.';

alter table public.org_billing
  add column if not exists stripe_mrr_cents integer,
  add column if not exists stripe_interval text,
  add column if not exists stripe_livemode boolean,
  add column if not exists stripe_amount_synced_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'org_billing_stripe_mrr_cents_check') then
    alter table public.org_billing add constraint org_billing_stripe_mrr_cents_check
      check (stripe_mrr_cents is null or stripe_mrr_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_billing_stripe_interval_check') then
    alter table public.org_billing add constraint org_billing_stripe_interval_check
      check (stripe_interval is null or stripe_interval in ('month', 'year'));
  end if;
end $$;

comment on column public.org_billing.stripe_mrr_cents is
  'Net monthly recurring amount of the org''s Stripe subscriptions in cents, written by the webhook: discounts applied, tax excluded, annual / 12.';

alter table public.org_billing_events
  add column if not exists atmosphere_plan_code text,
  add column if not exists fc_seats integer;

alter table public.job_proofs
  add column if not exists first_analysed_at timestamptz;

comment on column public.job_proofs.first_analysed_at is
  'When analysis first finished; written once by a trigger, re-analysis leaves it unchanged. NULL = not analysed yet, or first time unknown (overwritten by a bulk re-analysis before this column existed).';

alter table public.payments
  add column if not exists tax_cents integer,
  add column if not exists livemode boolean;

do $$
declare v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.payments'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%subscription%credits%refund%'
    and pg_get_constraintdef(oid) not like '%usage%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%usage%'
  ) then
    alter table public.payments add constraint payments_kind_check
      check (kind = any (array['subscription', 'credits', 'refund', 'usage']));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. BACKFILL: internal / test / demo orgs (audit 2026-10-07): Atmosphere Test
--    Org, Jettx LLC (x6), Jettx E2E Test, Auth Audit Org, Field Audit Office,
--    Riley Audit Co, Ask Chip Demo, App Review Demo, Delete Test Throwaway Org.
--    No-op where the ids do not exist.
-- ---------------------------------------------------------------------------

update public.orgs
set exclude_from_analytics = true,
    analytics_exclusion_reason = coalesce(analytics_exclusion_reason, 'internal / test / demo (analytics audit 2026-10-07)')
where id in (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '8b2cc105-1eec-4123-90db-fdcbc5565252',
  '51bcd088-92b2-451b-81de-7fcd3682d992',
  'feeb8b2d-a6dd-4f33-a9f2-9bbcf87d6fed',
  '3f34c941-6c44-4fa4-8e1b-888c0768da56',
  'e1450ad8-0edd-418d-b8b3-5fffda7f384b',
  'c22df837-887b-4470-8931-a5caae6554ff',
  '7ba54f30-c054-4f5c-97fe-a4a722c5db90',
  '694d76f1-81b1-49d6-a72d-d186181c40f4',
  '6154de3f-1563-487f-9d07-915199fc1f7d',
  'a0539dd4-da3b-403b-a5a6-5b4e907bdb18',
  '0e039df5-9006-447b-9082-6a82712086ce',
  '63885525-5e2b-4e12-8608-3c34f5916be0',
  'fcf0f7fd-21d1-46c8-ba14-e56659deaab7'
)
and not exclude_from_analytics;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Why an org is internal, or NULL for a customer.
create or replace function private.org_internal_reason(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when o.exclude_from_analytics then coalesce(o.analytics_exclusion_reason, 'internal / test')
    when b.stripe_subscription_id like 'comp\_%' then 'comp account'
  end
  from public.orgs o
  left join public.org_billing b on b.org_id = o.id
  where o.id = p_org;
$$;

-- True when rows for this org belong in a report. Rows with no org are kept.
create or replace function private.analytics_in_scope(p_org uuid, p_include_internal boolean)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_include_internal, false)
      or p_org is null
      or private.org_internal_reason(p_org) is null;
$$;

-- Catalog price per month, only used until the webhook stores the real Stripe
-- amount. Annual = prepaid yearly price / 12.
create or replace function private.atmosphere_catalog_mrr_cents(
  p_plan text,
  p_interval text,
  p_extra_seats integer
) returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(p_interval, 'month') = 'year' then
      round((
        (case p_plan when 'starter' then 399000 when 'scale' then 1999000 else 849000 end)
        + greatest(coalesce(p_extra_seats, 0), 0) * 125000
      ) / 12.0)::integer
    else
      (case p_plan when 'starter' then 39900 when 'scale' then 199900 else 84900 end)
      + greatest(coalesce(p_extra_seats, 0), 0) * 12500
  end;
$$;

create or replace function private.atmosphere_plan_name(p_plan text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case coalesce(p_plan, 'work_verification')
    when 'starter' then 'Starter'
    when 'work_verification' then 'Work Verification'
    when 'scale' then 'Scale'
    else initcap(replace(p_plan, '_', ' '))
  end;
$$;

-- What an org actually pays per month, in cents. 0 unless there is a real,
-- live-mode Stripe subscription in status active or past_due.
create or replace function private.org_mrr_cents(
  p_status public.subscription_status,
  p_subscription_id text,
  p_livemode boolean,
  p_stripe_mrr_cents integer,
  p_atmosphere_plan text,
  p_interval text,
  p_extra_seats integer,
  p_legacy_plan text,
  p_legacy_interval public.billing_interval,
  p_legacy_seats integer
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_status is null or p_status not in ('active', 'past_due') then 0
    when p_subscription_id is null or p_subscription_id not like 'sub\_%' then 0
    when p_livemode is false then 0
    when p_stripe_mrr_cents is not null then p_stripe_mrr_cents
    when p_atmosphere_plan is not null then
      private.atmosphere_catalog_mrr_cents(p_atmosphere_plan, p_interval, p_extra_seats)
    when coalesce(p_legacy_plan, 'free') <> 'free' then
      private.plan_mrr_cents(p_legacy_plan, p_legacy_interval, p_legacy_seats, p_status)
    else 0
  end;
$$;

create or replace function private.org_billing_mrr_cents(b public.org_billing)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.org_mrr_cents(
    b.status, b.stripe_subscription_id, b.stripe_livemode, b.stripe_mrr_cents,
    b.atmosphere_plan_code, b.stripe_interval, b.extra_fc_seats,
    b.plan_code, b.billing_interval, b.seats);
$$;

create or replace function private.org_billing_fc_seats(b public.org_billing)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(coalesce(b.included_fc_seats, 0), 0) + greatest(coalesce(b.extra_fc_seats, 0), 0);
$$;

-- comp / no_subscription / test_mode / active / past_due / trialing / canceled
create or replace function private.org_billing_label(b public.org_billing)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when b.org_id is null then 'no_subscription'
    when b.stripe_subscription_id like 'comp\_%' then 'comp'
    when b.stripe_subscription_id is null or b.stripe_subscription_id not like 'sub\_%' then 'no_subscription'
    when b.stripe_livemode is false then 'test_mode'
    else b.status::text
  end;
$$;

create or replace function private.pct_change(p_now numeric, p_prev numeric)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_prev is null or p_prev = 0 or p_now is null then null
    else round(((p_now - p_prev) / abs(p_prev)) * 100, 1)
  end;
$$;

-- Ledger feature (token_usage_events.feature) -> feature_catalog key.
create or replace function private.ai_feature_catalog_key(p_feature text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_feature
    when 'ask' then 'ai_assistant'
    when 'chat' then 'ai_assistant'
    when 'web_search' then 'ai_assistant'
    when 'computer' then 'computer_use'
    when 'video_analysis' then 'verifier_library'
    else p_feature
  end;
$$;

-- Latest activity across web sessions, uploads, Ask turns and AI calls.
create or replace function private.org_last_active_at(p_org uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(
    (select max(s.last_seen_at) from public.feature_usage_sessions s where s.org_id = p_org),
    (select max(p.received_at) from public.job_proofs p where p.org_id = p_org and p.deleted_at is null),
    (select max(t.created_at) from public.ask_turn_events t where t.org_id = p_org),
    (select max(e.created_at) from public.token_usage_events e where e.org_id = p_org));
$$;

-- Net, pre-tax, live-mode money per payment row. Refund rows carry Stripe's
-- cumulative amount_refunded, so only the largest refund per charge counts,
-- scaled by the original charge's tax share.
create or replace view private.payments_net as
with refunds as (
  select distinct on (r.stripe_charge_id)
         r.id, r.org_id, r.created_at, r.amount_cents, r.stripe_charge_id, r.livemode
  from public.payments r
  where r.kind = 'refund' and r.status = 'refunded'
  order by r.stripe_charge_id, r.amount_cents asc, r.created_at desc
)
select p.id, p.org_id, p.created_at, p.kind,
       (p.amount_cents - coalesce(p.tax_cents, 0))::bigint as net_cents,
       coalesce(p.tax_cents, 0)::bigint as tax_cents
from public.payments p
where p.status = 'succeeded'
  and p.kind in ('subscription', 'usage', 'credits')
  and p.livemode is distinct from false
union all
select r.id, r.org_id, r.created_at, 'refund'::text,
       round(r.amount_cents * (1 - coalesce(
         (select o.tax_cents::numeric / nullif(o.amount_cents, 0)
          from public.payments o
          where o.stripe_charge_id = regexp_replace(r.stripe_charge_id, '_refund$', '')
            and o.status = 'succeeded'
          limit 1), 0)))::bigint,
       0::bigint
from refunds r
where r.livemode is distinct from false;

revoke all on private.payments_net from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Billing history records the real plan and price
-- ---------------------------------------------------------------------------

create or replace function private.record_billing_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.plan_code              is not distinct from old.plan_code
     and new.billing_interval       is not distinct from old.billing_interval
     and new.seats                  is not distinct from old.seats
     and new.status                 is not distinct from old.status
     and new.atmosphere_plan_code   is not distinct from old.atmosphere_plan_code
     and new.included_fc_seats      is not distinct from old.included_fc_seats
     and new.extra_fc_seats         is not distinct from old.extra_fc_seats
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id
     and new.stripe_mrr_cents       is not distinct from old.stripe_mrr_cents
     and new.stripe_interval        is not distinct from old.stripe_interval
     and new.stripe_livemode        is not distinct from old.stripe_livemode then
    return new;
  end if;

  insert into public.org_billing_events (
    org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source,
    atmosphere_plan_code, fc_seats)
  values (
    new.org_id, now(), new.plan_code, new.billing_interval, new.seats, new.status,
    private.org_billing_mrr_cents(new),
    case when tg_op = 'INSERT' then 'signup' else 'change' end,
    new.atmosphere_plan_code, private.org_billing_fc_seats(new));

  return new;
end;
$$;

-- BACKFILL: a rebase event for each org whose latest event disagrees with the
-- corrected model.
insert into public.org_billing_events (
  org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source,
  atmosphere_plan_code, fc_seats)
select b.org_id, now(), b.plan_code, b.billing_interval, b.seats, b.status,
       private.org_billing_mrr_cents(b), 'rebase',
       b.atmosphere_plan_code, private.org_billing_fc_seats(b)
from public.org_billing b
left join lateral (
  select ev.mrr_cents, ev.fc_seats, ev.atmosphere_plan_code
  from public.org_billing_events ev
  where ev.org_id = b.org_id
  order by ev.effective_at desc, ev.id desc
  limit 1
) last on true
where last.mrr_cents is distinct from private.org_billing_mrr_cents(b)
   or last.fc_seats is distinct from private.org_billing_fc_seats(b)
   or last.atmosphere_plan_code is distinct from b.atmosphere_plan_code;

-- Point-in-time helpers: the latest billing event at p_at for each org.
drop function if exists private.mrr_cents_at(timestamptz);
drop function if exists private.paying_orgs_at(timestamptz);
drop function if exists private.seats_at(timestamptz);

create or replace function private.mrr_cents_at(p_at timestamptz, p_include_internal boolean default false)
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
  ) e
  where private.analytics_in_scope(o.id, p_include_internal);
$$;

create or replace function private.paying_orgs_at(p_at timestamptz, p_include_internal boolean default false)
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
  where e.mrr_cents > 0
    and private.analytics_in_scope(o.id, p_include_internal);
$$;

-- Field Capture seats on paying orgs.
create or replace function private.seats_at(p_at timestamptz, p_include_internal boolean default false)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(greatest(coalesce(e.fc_seats, 0), 0)), 0)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents, ev.fc_seats
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e
  where e.mrr_cents > 0
    and private.analytics_in_scope(o.id, p_include_internal);
$$;

-- Distinct orgs whose subscription left a paying status (canceled, unpaid,
-- etc.) in [p_from, p_to) after carrying MRR. A reclassification that keeps
-- the status (e.g. a test-mode subscription found later) is not churn.
create or replace function private.churned_orgs_between(
  p_from timestamptz, p_to timestamptz, p_include_internal boolean default false
) returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct t.org_id)::bigint
  from (
    select ev.org_id, ev.effective_at, ev.mrr_cents, ev.status,
           lag(ev.mrr_cents) over (partition by ev.org_id order by ev.effective_at, ev.id) as prev_mrr
    from public.org_billing_events ev
    where ev.effective_at < p_to
  ) t
  where t.effective_at >= p_from
    and t.mrr_cents = 0
    and t.status not in ('active', 'past_due')
    and coalesce(t.prev_mrr, 0) > 0
    and private.analytics_in_scope(t.org_id, p_include_internal);
$$;

-- ---------------------------------------------------------------------------
-- 5. First analysis time
-- ---------------------------------------------------------------------------

create or replace function private.job_proofs_first_analysed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.first_analysed_at is not null then
    new.first_analysed_at := old.first_analysed_at;
  elsif new.first_analysed_at is null
        and new.analysed_at is not null
        and (tg_op = 'INSERT' or old.analysed_at is null) then
    new.first_analysed_at := new.analysed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists job_proofs_first_analysed on public.job_proofs;
create trigger job_proofs_first_analysed
  before insert or update of analysed_at, first_analysed_at on public.job_proofs
  for each row execute function private.job_proofs_first_analysed();

-- BACKFILL (header point 5). Runs only while first_analysed_at is NULL, so a
-- re-run never overwrites a value the trigger wrote.
with late as (
  select date_trunc('hour', analysed_at) as h
  from public.job_proofs
  where analysed_at is not null and analysed_at - received_at > interval '1 day'
),
bulk as (
  select h from late group by h having count(*) >= 10
)
update public.job_proofs p
set first_analysed_at = p.analysed_at
where p.first_analysed_at is null
  and p.analysed_at is not null
  and not exists (
    select 1 from bulk b
    where date_trunc('hour', p.analysed_at) = b.h
      and p.received_at < b.h
  );

-- ---------------------------------------------------------------------------
-- 6. Reports. Old signatures are dropped; every report gains
--    p_include_internal boolean default false.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_summary(timestamptz, timestamptz);
drop function if exists public.analytics_monthly(integer);
drop function if exists public.analytics_features(timestamptz, timestamptz);
drop function if exists public.analytics_account_detail(uuid, timestamptz, timestamptz);
drop function if exists public.analytics_accounts(timestamptz, timestamptz, integer);
drop function if exists public.analytics_plan_mix();
drop function if exists public.analytics_retention(integer);
drop function if exists public.analytics_product_health(integer);
drop function if exists public.admin_token_usage_analytics(timestamptz, timestamptz);
drop function if exists public.admin_metering_analytics(timestamptz, timestamptz);

-- Orgs left out of reports by default, and why. Internal scope only.
create or replace function public.analytics_internal_orgs()
returns table (org_id uuid, org_name text, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform private.require_analytics('internal');
  return query
  select o.id, o.name, private.org_internal_reason(o.id)
  from public.orgs o
  where private.org_internal_reason(o.id) is not null
  order by o.name;
end;
$$;

create or replace function public.analytics_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now(),
  p_include_internal boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope public.analytics_scope;
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
  v_month_start timestamptz;
  v_mrr bigint; v_mrr_prev bigint;
  v_seats bigint; v_seats_prev bigint;
  v_paying bigint; v_paying_prev bigint;
  v_users bigint; v_users_prev bigint;
  v_orgs bigint; v_orgs_prev bigint;
  v_filled bigint;
  v_trial_mrr bigint;
  v_annual_mrr bigint;
  v_revenue bigint; v_sub_revenue bigint; v_usage_revenue bigint; v_credit_revenue bigint;
  v_refunds bigint; v_tax bigint;
  v_result jsonb;
  v_days numeric;
begin
  v_scope := private.require_analytics('investor');

  v_month_start := date_trunc('month', now());
  v_days := greatest(extract(epoch from (p_to - p_from)) / 86400.0, 1);

  v_mrr         := private.mrr_cents_at(now(), v_inc);
  v_mrr_prev    := private.mrr_cents_at(v_month_start, v_inc);
  v_seats       := private.seats_at(now(), v_inc);
  v_seats_prev  := private.seats_at(v_month_start, v_inc);
  v_paying      := private.paying_orgs_at(now(), v_inc);
  v_paying_prev := private.paying_orgs_at(v_month_start, v_inc);

  select count(distinct m.user_id) into v_users
  from public.org_members m where private.analytics_in_scope(m.org_id, v_inc);
  select count(distinct m.user_id) into v_users_prev
  from public.org_members m
  where m.created_at < v_month_start and private.analytics_in_scope(m.org_id, v_inc);
  select count(*) into v_orgs from public.orgs o where private.analytics_in_scope(o.id, v_inc);
  select count(*) into v_orgs_prev from public.orgs o
  where o.created_at < v_month_start and private.analytics_in_scope(o.id, v_inc);

  -- Field Capture seats in use on paying orgs.
  select coalesce(sum(private.field_capture_seats_used(b.org_id)), 0) into v_filled
  from public.org_billing b
  where private.org_billing_mrr_cents(b) > 0
    and private.analytics_in_scope(b.org_id, v_inc);

  -- Trial pipeline: MRR if every live trial converted at its stored price.
  select coalesce(sum(private.org_mrr_cents(
           'active', b.stripe_subscription_id, b.stripe_livemode, b.stripe_mrr_cents,
           b.atmosphere_plan_code, b.stripe_interval, b.extra_fc_seats,
           b.plan_code, b.billing_interval, b.seats)), 0)
    into v_trial_mrr
  from public.org_billing b
  where b.status = 'trialing' and private.analytics_in_scope(b.org_id, v_inc);

  -- The slice of MRR on annual (prepaid) terms.
  select coalesce(sum(private.org_billing_mrr_cents(b)), 0) into v_annual_mrr
  from public.org_billing b
  where coalesce(b.stripe_interval, case when b.billing_interval = 'annual' then 'year' end) = 'year'
    and private.analytics_in_scope(b.org_id, v_inc);

  select
    coalesce(sum(net_cents), 0),
    coalesce(sum(net_cents) filter (where kind = 'subscription'), 0),
    coalesce(sum(net_cents) filter (where kind = 'usage'), 0),
    coalesce(sum(net_cents) filter (where kind = 'credits'), 0),
    coalesce(sum(net_cents) filter (where kind = 'refund'), 0),
    coalesce(sum(tax_cents), 0)
  into v_revenue, v_sub_revenue, v_usage_revenue, v_credit_revenue, v_refunds, v_tax
  from private.payments_net
  where created_at >= p_from and created_at < p_to
    and private.analytics_in_scope(org_id, v_inc);

  v_result := jsonb_build_object(
    'scope', v_scope,
    'include_internal', v_inc,
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', round(v_days, 1)),

    'customers', jsonb_build_object(
      'orgs_total', v_orgs,
      'orgs_new', (select count(*) from public.orgs o
                   where o.created_at >= p_from and o.created_at < p_to
                     and private.analytics_in_scope(o.id, v_inc)),
      'orgs_paying', v_paying,
      'orgs_paying_prev', v_paying_prev,
      'orgs_active', (
        select count(distinct a.org_id) from (
          select org_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select org_id from public.usage_events where created_at >= p_from and created_at < p_to
        ) a where private.analytics_in_scope(a.org_id, v_inc)),
      'orgs_excluded', (select count(*) from public.orgs o where private.org_internal_reason(o.id) is not null),
      'orgs_growth_mom_pct', private.pct_change(v_orgs, v_orgs_prev),
      'paying_growth_mom_pct', private.pct_change(v_paying, v_paying_prev)),

    'users', jsonb_build_object(
      'users_total', v_users,
      'users_new', (select count(distinct m.user_id) from public.org_members m
                    where m.created_at >= p_from and m.created_at < p_to
                      and private.analytics_in_scope(m.org_id, v_inc)),
      'users_active', (
        select count(distinct a.user_id) from (
          select user_id, org_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select user_id, org_id from public.usage_events where user_id is not null and created_at >= p_from and created_at < p_to
        ) a where private.analytics_in_scope(a.org_id, v_inc)),
      'users_growth_mom_pct', private.pct_change(v_users, v_users_prev)),

    'seats', jsonb_build_object(
      'seats_licensed', v_seats,
      'seats_filled', v_filled,
      'seat_utilization_pct', case when v_seats > 0 then round(v_filled::numeric / v_seats * 100, 1) end,
      'seats_growth_mom_pct', private.pct_change(v_seats, v_seats_prev)),

    'revenue', jsonb_build_object(
      'mrr_cents', v_mrr,
      'arr_cents', v_mrr * 12,
      'annual_contracted_mrr_cents', v_annual_mrr,
      'annual_contracted_arr_cents', v_annual_mrr * 12,
      'monthly_billed_mrr_cents', v_mrr - v_annual_mrr,
      'trial_pipeline_mrr_cents', v_trial_mrr,
      'mrr_growth_mom_pct', private.pct_change(v_mrr, v_mrr_prev),
      'net_new_mrr_cents', v_mrr - v_mrr_prev,
      'churned_orgs_this_month', private.churned_orgs_between(v_month_start, now(), v_inc),
      'collected_in_range_cents', v_revenue,
      'subscription_revenue_cents', v_sub_revenue,
      'usage_revenue_cents', v_usage_revenue,
      'credit_revenue_cents', v_credit_revenue,
      'refunds_cents', v_refunds,
      'tax_excluded_cents', v_tax,
      'trailing_12m_revenue_cents', (
        select coalesce(sum(net_cents), 0) from private.payments_net
        where created_at >= now() - interval '12 months'
          and private.analytics_in_scope(org_id, v_inc)),
      'avg_monthly_spend_per_account_cents', case when v_paying > 0
        then round((v_revenue / v_days * 30.0) / v_paying) end,
      'avg_monthly_spend_per_seat_cents', case when v_seats > 0
        then round((v_revenue / v_days * 30.0) / v_seats) end,
      'arpa_mrr_cents', case when v_paying > 0 then round(v_mrr::numeric / v_paying) end),

    'engagement', jsonb_build_object(
      'tracked_hours', (
        select round(coalesce(sum(active_ms), 0) / 3600000.0, 2)
        from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'sessions', (
        select count(*) from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'features_used', (
        select count(distinct feature_key) from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'features_tracked', (select count(*) from public.feature_catalog where is_active),
      'ai_requests', (
        select count(*) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc))));

  -- AI cost: internal only. List value (cost x customer markup) is NOT
  -- revenue: usage is covered by the plan's AI allowance, not invoiced.
  if v_scope >= 'internal' then
    v_result := v_result || jsonb_build_object('unit_economics', jsonb_build_object(
      'model_cost_cents', (
        select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc)),
      'list_value_cents', (
        select round(coalesce(sum(u.price_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc)),
      'model_cost_30d_cents', (
        select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= now() - interval '30 days'
          and private.analytics_in_scope(u.org_id, v_inc))));
  end if;

  return v_result;
end;
$$;

create or replace function public.analytics_monthly(
  p_months integer default 24,
  p_include_internal boolean default false
) returns table (
  month date, new_orgs bigint, total_orgs bigint, paying_orgs bigint, active_orgs bigint,
  churned_orgs bigint, new_users bigint, total_users bigint, active_users bigint, seats bigint,
  mrr_cents bigint, arr_cents bigint, revenue_cents bigint, subscription_revenue_cents bigint,
  usage_revenue_cents bigint, credit_revenue_cents bigint, refunds_cents bigint,
  arpa_cents numeric, mrr_growth_pct numeric, user_growth_pct numeric, seat_growth_pct numeric,
  tracked_hours numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
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
           least(m_start + interval '1 month', now()) as m_at
    from months
  ),
  pay as (
    select pn.* from private.payments_net pn where private.analytics_in_scope(pn.org_id, v_inc)
  ),
  base as (
    select
      b.m_start::date as month,
      (select count(*) from public.orgs o
        where o.created_at >= b.m_start and o.created_at < b.m_end
          and private.analytics_in_scope(o.id, v_inc)) as new_orgs,
      (select count(*) from public.orgs o
        where o.created_at < b.m_at and private.analytics_in_scope(o.id, v_inc)) as total_orgs,
      private.paying_orgs_at(b.m_at, v_inc) as paying_orgs,
      (select count(distinct a.org_id) from (
         select org_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select org_id, created_at from public.usage_events) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end
         and private.analytics_in_scope(a.org_id, v_inc)) as active_orgs,
      private.churned_orgs_between(b.m_start, b.m_end, v_inc) as churned_orgs,
      (select count(distinct m.user_id) from public.org_members m
        where m.created_at >= b.m_start and m.created_at < b.m_end
          and private.analytics_in_scope(m.org_id, v_inc)) as new_users,
      (select count(distinct m.user_id) from public.org_members m
        where m.created_at < b.m_at and private.analytics_in_scope(m.org_id, v_inc)) as total_users,
      (select count(distinct a.user_id) from (
         select user_id, org_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select user_id, org_id, created_at from public.usage_events where user_id is not null) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end
         and private.analytics_in_scope(a.org_id, v_inc)) as active_users,
      private.seats_at(b.m_at, v_inc) as seats,
      private.mrr_cents_at(b.m_at, v_inc) as mrr_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.created_at >= b.m_start and p.created_at < b.m_end)::bigint as revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'subscription' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as subscription_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'usage' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as usage_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'credits' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as credit_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'refund' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as refunds_cents,
      (select round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) from public.feature_usage_sessions s
        where s.last_seen_at >= b.m_start and s.last_seen_at < b.m_end
          and private.analytics_in_scope(s.org_id, v_inc)) as tracked_hours
    from bounds b
  )
  select
    month, new_orgs, total_orgs, paying_orgs, active_orgs, churned_orgs,
    new_users, total_users, active_users, seats, mrr_cents, mrr_cents * 12 as arr_cents,
    revenue_cents, subscription_revenue_cents, usage_revenue_cents, credit_revenue_cents, refunds_cents,
    case when paying_orgs > 0 then round(mrr_cents::numeric / paying_orgs) end as arpa_cents,
    private.pct_change(mrr_cents, lag(mrr_cents) over (order by month)) as mrr_growth_pct,
    private.pct_change(total_users, lag(total_users) over (order by month)) as user_growth_pct,
    private.pct_change(seats, lag(seats) over (order by month)) as seat_growth_pct,
    tracked_hours
  from base
  order by base.month;
end;
$$;

create or replace function public.analytics_features(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now(),
  p_include_internal boolean default false
) returns table (
  feature_key text, label text, area text, sessions bigint, active_ms bigint, active_hours numeric,
  users bigint, orgs bigint, avg_session_minutes numeric, share_pct numeric, time_rank bigint,
  ai_requests bigint, last_used_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with usage as (
    select s.feature_key,
           count(*)                              as sessions,
           coalesce(sum(s.active_ms), 0)::bigint as active_ms,
           count(distinct s.user_id)             as users,
           count(distinct s.org_id)              as orgs,
           max(s.last_seen_at)                   as last_used_at
    from public.feature_usage_sessions s
    where s.last_seen_at >= p_from and s.last_seen_at < p_to
      and private.analytics_in_scope(s.org_id, v_inc)
    group by s.feature_key
  ),
  ai as (
    select private.ai_feature_catalog_key(u.feature) as feature_key, count(*) as ai_requests
    from public.usage_events u
    where u.feature is not null and u.created_at >= p_from and u.created_at < p_to
      and private.analytics_in_scope(u.org_id, v_inc)
    group by 1
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

create or replace function public.analytics_accounts(
  p_from  timestamptz default (now() - interval '30 days'),
  p_to    timestamptz default now(),
  p_limit integer default 500,
  p_include_internal boolean default false
) returns table (
  org_id uuid, org_name text, created_at timestamptz, plan_code text, plan_name text,
  billing_interval text, status text, seats integer, seats_used integer, members bigint,
  mrr_cents bigint, arr_cents bigint, revenue_in_range_cents bigint, credit_spend_cents numeric,
  ai_cost_cents numeric, active_hours numeric, top_feature text, last_active_at timestamptz,
  internal boolean, internal_reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  return query
  with rows_ as (
    select
      o.id, o.name, o.created_at,
      b.org_id as billing_org,
      b.atmosphere_plan_code, b.stripe_interval, b.billing_interval as legacy_interval,
      private.org_billing_label(b) as label,
      case when b.org_id is null then 0 else private.org_billing_fc_seats(b) end as fc_seats,
      coalesce(private.org_billing_mrr_cents(b), 0)::bigint as mrr,
      private.org_internal_reason(o.id) as reason
    from public.orgs o
    left join public.org_billing b on b.org_id = o.id
    where private.analytics_in_scope(o.id, v_inc)
  )
  select
    r.id, r.name, r.created_at,
    case when r.billing_org is null then 'none' else coalesce(r.atmosphere_plan_code, 'work_verification') end,
    case when r.billing_org is null then 'No plan' else private.atmosphere_plan_name(r.atmosphere_plan_code) end,
    case coalesce(r.stripe_interval, case when r.legacy_interval = 'annual' then 'year' else 'month' end)
      when 'year' then 'annual' else 'monthly' end,
    r.label,
    r.fc_seats,
    private.field_capture_seats_used(r.id),
    (select count(*) from public.org_members m where m.org_id = r.id),
    r.mrr,
    r.mrr * 12,
    (select coalesce(sum(pn.net_cents), 0) from private.payments_net pn
      where pn.org_id = r.id and pn.created_at >= p_from and pn.created_at < p_to)::bigint,
    (select round(coalesce(sum(u.price_nanos), 0) / 10000000.0, 2) from public.usage_events u
      where u.org_id = r.id and u.created_at >= p_from and u.created_at < p_to),
    (select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0, 2) from public.usage_events u
      where u.org_id = r.id and u.created_at >= p_from and u.created_at < p_to),
    (select round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) from public.feature_usage_sessions s
      where s.org_id = r.id and s.last_seen_at >= p_from and s.last_seen_at < p_to),
    (select f.label from public.feature_usage_sessions s
      join public.feature_catalog f on f.key = s.feature_key
      where s.org_id = r.id and s.last_seen_at >= p_from and s.last_seen_at < p_to
      group by f.label order by sum(s.active_ms) desc limit 1),
    private.org_last_active_at(r.id),
    r.reason is not null,
    r.reason
  from rows_ r
  order by r.mrr desc, r.created_at desc
  limit least(greatest(p_limit, 1), 5000);
end;
$$;

create or replace function public.analytics_account_detail(
  p_org_id uuid,
  p_from   timestamptz default (now() - interval '30 days'),
  p_to     timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account jsonb;
begin
  perform private.require_analytics('internal');

  if not exists (select 1 from public.orgs where id = p_org_id) then
    return null;
  end if;

  select to_jsonb(a) into v_account
  from public.analytics_accounts(p_from, p_to, 5000, true) a
  where a.org_id = p_org_id;

  return jsonb_build_object(
    'account', v_account,
    'members', (
      select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt"), '[]'::jsonb)
      from (
        select m.user_id as "userId", pr.email, pr.full_name as "fullName", m.role::text as role,
               m.work_type::text as "workType", m.status, m.created_at as "createdAt"
        from public.org_members m
        left join public.profiles pr on pr.id = m.user_id
        where m.org_id = p_org_id
      ) t
    ),
    'jobs', jsonb_build_object(
      'total', (select count(*) from public.crm_jobs j where j.org_id = p_org_id and j.deleted_at is null),
      'deleted', (select count(*) from public.crm_jobs j where j.org_id = p_org_id and j.deleted_at is not null),
      'byStatus', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select j.status::text as status, count(*)::int as count
          from public.crm_jobs j
          where j.org_id = p_org_id and j.deleted_at is null
          group by j.status
          order by count(*) desc
        ) t
      ),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select j.id, j.title, j.status::text as status, j.work_type::text as "workType",
                 j.job_number as "jobNumber", j.created_at as "createdAt"
          from public.crm_jobs j
          where j.org_id = p_org_id and j.deleted_at is null
          order by j.created_at desc
          limit 25
        ) t
      )
    ),
    'features', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select s.feature_key as "featureKey", coalesce(f.label, s.feature_key) as label,
               round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) as "activeHours",
               count(*)::int as sessions
        from public.feature_usage_sessions s
        left join public.feature_catalog f on f.key = s.feature_key
        where s.org_id = p_org_id and s.last_seen_at >= p_from and s.last_seen_at < p_to
        group by s.feature_key, f.label
        order by sum(s.active_ms) desc
        limit 20
      ) t
    )
  );
end;
$$;

-- Paying subscriptions by plan and term, plus $0 rows for comp and unpaid
-- orgs so the org counts add up to the total.
create or replace function public.analytics_plan_mix(p_include_internal boolean default false)
returns table (
  plan_code text, plan_name text, billing_interval text, orgs bigint, seats bigint,
  mrr_cents bigint, arr_cents bigint, mrr_share_pct numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with classified as (
    select o.id,
           b.atmosphere_plan_code, b.stripe_interval,
           case when b.org_id is null then 0 else private.org_billing_fc_seats(b) end as fc_seats,
           coalesce(private.org_billing_mrr_cents(b), 0) as mrr,
           private.org_billing_label(b) as label
    from public.orgs o
    left join public.org_billing b on b.org_id = o.id
    where private.analytics_in_scope(o.id, v_inc)
  ),
  rows_ as (
    select
      case when c.mrr > 0 then coalesce(c.atmosphere_plan_code, 'work_verification')
           when c.label = 'comp' then 'comp'
           else 'none' end as plan_code,
      case when c.mrr > 0 then private.atmosphere_plan_name(c.atmosphere_plan_code)
           when c.label = 'comp' then 'Comp (no charge)'
           else 'No paid subscription' end as plan_name,
      case when c.mrr > 0 then
             case coalesce(c.stripe_interval, 'month') when 'year' then 'annual' else 'monthly' end
           else '—' end as billing_interval,
      count(*)::bigint as orgs,
      coalesce(sum(case when c.mrr > 0 then c.fc_seats else 0 end), 0)::bigint as seats,
      coalesce(sum(c.mrr), 0)::bigint as mrr_cents
    from classified c
    group by 1, 2, 3
  )
  select r.plan_code, r.plan_name, r.billing_interval, r.orgs, r.seats, r.mrr_cents, r.mrr_cents * 12,
         round(r.mrr_cents * 100.0 / nullif((select sum(x.mrr_cents) from rows_ x), 0), 1)
  from rows_ r
  order by r.mrr_cents desc, r.orgs desc;
end;
$$;

create or replace function public.analytics_retention(
  p_months integer default 12,
  p_include_internal boolean default false
) returns table (
  cohort_month date, cohort_size bigint, month_offset integer, active_orgs bigint, retention_pct numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with cohorts as (
    select date_trunc('month', o.created_at) as cohort_month, o.id as org_id
    from public.orgs o
    where o.created_at >= date_trunc('month', now()) - ((least(greatest(p_months, 1), 36) - 1) * interval '1 month')
      and private.analytics_in_scope(o.id, v_inc)
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

-- Product health. Changes from 20261002210000: scope filter everywhere,
-- Field Capture seats as the north-star denominator, deleted films excluded,
-- and upload -> analysis time measured to the FIRST analysis (re-analysis no
-- longer counts). Films whose first analysis time is unknown (the Sep 21
-- re-analysis batch) are counted in first_time_unknown and left out of the
-- percentiles.
create or replace function public.analytics_product_health(
  p_weeks integer default 12,
  p_include_internal boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inc        boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
  v_weeks      integer := greatest(4, least(coalesce(p_weeks, 12), 52));
  v_now        timestamptz := now();
  v_this_week  timestamptz := date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC';
  v_from       timestamptz := v_this_week - make_interval(weeks => v_weeks);
  v_cur_from   timestamptz := v_now - interval '28 days';
  v_prev_from  timestamptz := v_now - interval '56 days';
  v_series     jsonb;
  v_uploads    jsonb;
  v_analysis   jsonb;
  v_evidence   jsonb;
  v_ask        jsonb;
begin
  perform private.require_analytics('investor');

  -- North star: hours filmed (live films only) by orgs paying at the end of
  -- the week, over the Field Capture seats those orgs pay for.
  with weeks as (
    select ws,
           least(ws + interval '7 days', v_now) as we,
           (ws + interval '7 days') > v_now     as partial
    from generate_series(v_from, v_this_week, interval '1 week') as ws
  ),
  paying as (
    select w.ws, o.id as org_id, coalesce(e.fc_seats, 0) as seats
    from weeks w
    cross join public.orgs o
    cross join lateral (
      select ev.fc_seats, ev.mrr_cents
      from public.org_billing_events ev
      where ev.org_id = o.id and ev.effective_at <= w.we
      order by ev.effective_at desc, ev.id desc
      limit 1
    ) e
    where e.mrr_cents > 0
      and private.analytics_in_scope(o.id, v_inc)
  ),
  seat_weeks as (
    select ws, sum(greatest(seats, 0))::bigint as seats, count(*)::bigint as orgs
    from paying group by ws
  ),
  proof_weeks as (
    select w.ws,
           coalesce(sum(p.duration_seconds), 0) / 3600.0 as hours_all,
           coalesce(sum(p.duration_seconds) filter (where pa.org_id is not null), 0) / 3600.0 as hours_paying,
           count(p.id)::bigint as films
    from weeks w
    left join public.job_proofs p
      on p.received_at >= w.ws and p.received_at < w.ws + interval '7 days'
     and p.deleted_at is null
     and private.analytics_in_scope(p.org_id, v_inc)
    left join paying pa on pa.ws = w.ws and pa.org_id = p.org_id
    group by w.ws
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start',     w.ws,
           'partial',        w.partial,
           'paying_seats',   coalesce(s.seats, 0),
           'paying_orgs',    coalesce(s.orgs, 0),
           'hours_paying',   round(coalesce(pw.hours_paying, 0)::numeric, 3),
           'hours_all',      round(coalesce(pw.hours_all, 0)::numeric, 3),
           'films',          coalesce(pw.films, 0),
           'hours_per_seat', case when coalesce(s.seats, 0) > 0
                               then round((pw.hours_paying / s.seats)::numeric, 3) end
         ) order by w.ws), '[]'::jsonb)
    into v_series
  from weeks w
  left join seat_weeks s on s.ws = w.ws
  left join proof_weeks pw on pw.ws = w.ws;

  with u as (
    select a.*,
           case when a.started_at >= v_cur_from then 'cur'
                when a.started_at >= v_prev_from then 'prev' end as period,
           (a.completed_at is null and a.failed_at is null
             and a.last_attempt_at > v_now - interval '24 hours') as in_flight
    from public.capture_upload_attempts a
    where a.started_at >= v_prev_from
      and private.analytics_in_scope(a.org_id, v_inc)
  ),
  agg as (
    select period,
           count(*)                                                        as started,
           count(*) filter (where completed_at is not null)                as completed,
           count(*) filter (where completed_at is null and failed_at is not null) as failed,
           count(*) filter (where completed_at is null and failed_at is null and not in_flight) as abandoned,
           count(*) filter (where in_flight)                               as in_flight,
           count(*) filter (where attempts > 1)                            as retried,
           count(*) filter (where attempts > 1 and completed_at is null and in_flight) as retrying
    from u where period is not null group by period
  ),
  errs as (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n) order by n desc, code), '[]'::jsonb) as top
    from (
      select last_error_code as code, count(*) as n
      from u
      where period = 'cur' and completed_at is null and last_error_code is not null
      group by last_error_code
      order by count(*) desc
      limit 5
    ) e
  )
  select jsonb_build_object(
    'tracking_since', (select min(a.started_at) from public.capture_upload_attempts a
                       where private.analytics_in_scope(a.org_id, v_inc)),
    'current',  (select to_jsonb(agg) - 'period' from agg where period = 'cur'),
    'prior',    (select to_jsonb(agg) - 'period' from agg where period = 'prev'),
    'top_errors', (select top from errs)
  ) into v_uploads;

  -- Upload -> FIRST analysis.
  with p as (
    select received_at,
           extract(epoch from (first_analysed_at - received_at)) as secs,
           analysis_status,
           first_analysed_at,
           case when received_at >= v_cur_from then 'cur'
                when received_at >= v_prev_from then 'prev' end as period
    from public.job_proofs
    where received_at >= least(v_prev_from, v_from)
      and deleted_at is null
      and private.analytics_in_scope(org_id, v_inc)
  ),
  per as (
    select period,
           count(*)                                                           as received,
           count(*) filter (where analysis_status = 'done' and secs >= 0)     as analysed,
           count(*) filter (where analysis_status = 'done' and first_analysed_at is null) as first_time_unknown,
           count(*) filter (where analysis_status = 'failed')                 as failed,
           count(*) filter (where analysis_status is null or analysis_status not in ('done', 'failed')) as pending,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where period is not null group by period
  ),
  wk as (
    select date_trunc('week', received_at at time zone 'UTC') at time zone 'UTC' as ws,
           count(*) filter (where analysis_status = 'done' and secs >= 0) as analysed,
           count(*) filter (where analysis_status = 'done' and first_analysed_at is null) as first_time_unknown,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where received_at >= v_from group by 1
  )
  select jsonb_build_object(
    'measured_to', 'first_analysis',
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'weekly',  coalesce((select jsonb_agg(jsonb_build_object(
                  'week_start', ws, 'analysed', analysed, 'first_time_unknown', first_time_unknown,
                  'median_seconds', round(median_seconds::numeric, 1),
                  'p90_seconds', round(p90_seconds::numeric, 1)) order by ws) from wk), '[]'::jsonb)
  ) into v_analysis;

  -- Evidence delivered. Proofs analysed = live films whose FIRST analysis
  -- finished in the window (re-analysis is not new evidence).
  select jsonb_build_object(
    'current', jsonb_build_object(
      'proofs_analysed', (select count(*) from public.job_proofs p
        where p.first_analysed_at >= v_cur_from and p.deleted_at is null
          and private.analytics_in_scope(p.org_id, v_inc)),
      'daily_reports_sent', (select count(*) from public.daily_job_reports d
        where d.status = 'sent' and d.sent_at >= v_cur_from and private.analytics_in_scope(d.org_id, v_inc)),
      'evidence_downloads', (select count(*) from public.evidence_downloads e
        where e.created_at >= v_cur_from and private.analytics_in_scope(e.org_id, v_inc)),
      'share_links_created', (select count(*) from public.verifier_shares s
        where s.created_at >= v_cur_from and private.analytics_in_scope(s.org_id, v_inc)),
      'share_links_opened', (select count(*) from public.verifier_shares s
        where s.last_opened_at >= v_cur_from and private.analytics_in_scope(s.org_id, v_inc))),
    'prior', jsonb_build_object(
      'proofs_analysed', (select count(*) from public.job_proofs p
        where p.first_analysed_at >= v_prev_from and p.first_analysed_at < v_cur_from and p.deleted_at is null
          and private.analytics_in_scope(p.org_id, v_inc)),
      'daily_reports_sent', (select count(*) from public.daily_job_reports d
        where d.status = 'sent' and d.sent_at >= v_prev_from and d.sent_at < v_cur_from
          and private.analytics_in_scope(d.org_id, v_inc)),
      'evidence_downloads', (select count(*) from public.evidence_downloads e
        where e.created_at >= v_prev_from and e.created_at < v_cur_from
          and private.analytics_in_scope(e.org_id, v_inc)),
      'share_links_created', (select count(*) from public.verifier_shares s
        where s.created_at >= v_prev_from and s.created_at < v_cur_from
          and private.analytics_in_scope(s.org_id, v_inc)),
      'share_links_opened', null),
    'lifetime', jsonb_build_object(
      'share_links', (select count(*) from public.verifier_shares s where private.analytics_in_scope(s.org_id, v_inc)),
      'share_link_opens', (select coalesce(sum(s.open_count), 0) from public.verifier_shares s
        where private.analytics_in_scope(s.org_id, v_inc)))
  ) into v_evidence;

  with t as (
    select outcome, total_ms, ttft_ms,
           case when created_at >= v_cur_from then 'cur'
                when created_at >= v_prev_from then 'prev' end as period
    from public.ask_turn_events
    where created_at >= v_prev_from
      and private.analytics_in_scope(org_id, v_inc)
  ),
  per as (
    select period,
           count(*)                                           as turns,
           count(*) filter (where outcome = 'answered')       as answered,
           count(*) filter (where outcome = 'error')          as errors,
           count(*) filter (where outcome = 'refused')        as refused,
           count(*) filter (where outcome = 'stopped')        as stopped,
           percentile_cont(0.5) within group (order by total_ms) filter (where outcome = 'answered') as median_ms,
           percentile_cont(0.9) within group (order by total_ms) filter (where outcome = 'answered') as p90_ms,
           percentile_cont(0.5) within group (order by ttft_ms)  filter (where outcome = 'answered' and ttft_ms is not null) as median_ttft_ms
    from t where period is not null group by period
  )
  select jsonb_build_object(
    'tracking_since', (select min(a.created_at) from public.ask_turn_events a
                       where private.analytics_in_scope(a.org_id, v_inc)),
    'questions', jsonb_build_object(
      'current', (select count(*) from public.job_proof_questions q
        where q.created_at >= v_cur_from and private.analytics_in_scope(q.org_id, v_inc)),
      'prior', (select count(*) from public.job_proof_questions q
        where q.created_at >= v_prev_from and q.created_at < v_cur_from and private.analytics_in_scope(q.org_id, v_inc)),
      'orgs_current', (select count(distinct q.org_id) from public.job_proof_questions q
        where q.created_at >= v_cur_from and private.analytics_in_scope(q.org_id, v_inc))),
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'feedback', null
  ) into v_ask;

  return jsonb_build_object(
    'generated_at', v_now,
    'weeks', v_weeks,
    'include_internal', v_inc,
    'windows', jsonb_build_object(
      'current', jsonb_build_object('from', v_cur_from, 'to', v_now),
      'prior',   jsonb_build_object('from', v_prev_from, 'to', v_cur_from)),
    'north_star', jsonb_build_object('weekly', v_series),
    'uploads', v_uploads,
    'analysis', v_analysis,
    'evidence', v_evidence,
    'ask', v_ask
  );
end;
$$;

-- Token usage. Same shape as 20260913190000 plus costNanos on every group,
-- the scope filter, and private.require_analytics('internal').
-- priceNanos is list value (cost x customer markup), not an invoiced amount.
create or replace function public.admin_token_usage_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_include_internal boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $$
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'includeInternal', v_inc,
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'inputTokens', coalesce(sum(e.input_tokens), 0),
        'outputTokens', coalesce(sum(e.output_tokens), 0),
        'cacheTokens', coalesce(sum(e.cache_tokens), 0),
        'totalTokens', coalesce(sum(e.total_tokens), 0),
        'priceNanos', coalesce(sum(e.price_nanos), 0),
        'costNanos', coalesce(sum(e.cost_nanos), 0),
        'distinctOrgs', count(distinct e.org_id)::int,
        'distinctUsers', count(distinct e.user_id) filter (where e.user_id is not null)::int,
        'distinctModels', count(distinct e.model_id) filter (
          where e.model_id is not null and btrim(e.model_id) <> '')::int
      )
      from public.token_usage_events e
      where e.created_at >= p_from and e.created_at < p_to
        and private.analytics_in_scope(e.org_id, v_inc)
    ),
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.org_id as "orgId", o.name as "orgName",
               private.org_internal_reason(e.org_id) is not null as "internal",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos",
               count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers",
               count(distinct e.model_id) filter (
                 where e.model_id is not null and btrim(e.model_id) <> '')::int as "distinctModels"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.org_id, o.name
        order by sum(e.total_tokens) desc, o.name asc
        limit 200
      ) t
    ),
    'byUser', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.user_id as "userId",
               coalesce(nullif(btrim(pr.full_name), ''), split_part(coalesce(au.email, ''), '@', 1), 'Unattributed') as "userName",
               au.email as "email",
               e.org_id as "orgId", o.name as "orgName",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        left join public.profiles pr on pr.id = e.user_id
        left join auth.users au on au.id = e.user_id
        where e.created_at >= p_from and e.created_at < p_to
          and e.user_id is not null
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.user_id, pr.full_name, au.email, e.org_id, o.name
        order by sum(e.total_tokens) desc, coalesce(au.email, '') asc
        limit 200
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(e.model_id), ''), '(unknown)') as "model",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos",
               count(distinct e.org_id)::int as "distinctOrgs",
               count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by coalesce(nullif(btrim(e.model_id), ''), '(unknown)')
        order by sum(e.total_tokens) desc, 1 asc
        limit 100
      ) t
    ),
    'byFeature', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.feature::text as "feature",
               count(*)::int as "eventCount",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.feature
        order by sum(e.total_tokens) desc
      ) t
    )
  );
end;
$$;

-- Metering. private.ai_usage_events has never been written in production
-- (the page showed $0 / 0 events). Read the real ledger, token_usage_events,
-- and keep the same JSON shape. byWorkflow = token feature, byAgent = source.
-- computeUnits uses the configured 1 CU = $0.01 of provider cost.
create or replace function public.admin_metering_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_include_internal boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'source', 'token_usage_events',
    'includeInternal', v_inc,
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.org_id as "orgId", o.name as "orgName",
               private.org_internal_reason(e.org_id) is not null as "internal",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos",
               round(coalesce(sum(e.cost_nanos), 0) / 10000000.0, 2) as "computeUnits",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               count(distinct e.job_id) filter (where e.job_id is not null) as "distinctJobs"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.org_id, o.name
        order by sum(e.cost_nanos) desc
        limit 100
      ) t
    ),
    'byWorkflow', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.feature::text as "workflowId",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.feature
        order by sum(e.cost_nanos) desc
        limit 50
      ) t
    ),
    'byAgent', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(e.source), ''), '(unspecified)') as "agentType",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by 1
        order by sum(e.cost_nanos) desc
        limit 50
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select x.provider, x.model,
               count(*)::int as "eventCount",
               coalesce(sum(x.cost_nanos), 0) as "aiCostNanos"
        from (
          select e.cost_nanos,
                 coalesce(nullif(btrim(e.model_id), ''), '(unknown)') as model,
                 coalesce(nullif(btrim(e.metadata ->> 'provider'), ''),
                   case
                     when e.model_id ilike 'claude%' or e.model_id ilike 'anthropic%' then 'anthropic'
                     when e.model_id ilike 'gpt%' or e.model_id ~* '^o[0-9]' or e.model_id ilike 'openai%' then 'openai'
                     when e.model_id ilike 'gemini%' or e.model_id ilike 'google%' then 'google'
                     when e.model_id ilike 'grok%' or e.model_id ilike 'xai%' then 'xai'
                     else 'unknown'
                   end) as provider
          from public.token_usage_events e
          where e.created_at >= p_from and e.created_at < p_to
            and private.analytics_in_scope(e.org_id, v_inc)
        ) x
        group by x.provider, x.model
        order by sum(x.cost_nanos) desc
        limit 50
      ) t
    ),
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'aiCostNanos', coalesce(sum(e.cost_nanos), 0),
        'computeUnits', round(coalesce(sum(e.cost_nanos), 0) / 10000000.0, 2),
        'totalTokens', coalesce(sum(e.total_tokens), 0),
        'distinctOrgs', count(distinct e.org_id)::int
      )
      from public.token_usage_events e
      where e.created_at >= p_from and e.created_at < p_to
        and private.analytics_in_scope(e.org_id, v_inc)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. Reports: service_role only (20261002193000 pattern). Helpers:
--    nobody but their SECURITY DEFINER callers.
-- ---------------------------------------------------------------------------

do $grants$
declare
  sig regprocedure;
begin
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_metering_analytics',
        'admin_token_usage_analytics',
        'analytics_account_detail',
        'analytics_accounts',
        'analytics_features',
        'analytics_internal_orgs',
        'analytics_monthly',
        'analytics_plan_mix',
        'analytics_product_health',
        'analytics_retention',
        'analytics_summary'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;

  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'org_internal_reason', 'analytics_in_scope', 'atmosphere_catalog_mrr_cents',
        'atmosphere_plan_name', 'org_mrr_cents', 'org_billing_mrr_cents',
        'org_billing_fc_seats', 'org_billing_label', 'ai_feature_catalog_key',
        'org_last_active_at', 'mrr_cents_at', 'paying_orgs_at', 'seats_at',
        'churned_orgs_between', 'job_proofs_first_analysed', 'record_billing_event'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
  end loop;
end
$grants$;
