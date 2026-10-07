#!/usr/bin/env bash
#
# Analytics audit corrections (20261007230000_analytics_audit_corrections).
#
# Applies the actor migration, then the corrections migration twice (to prove
# it is idempotent), to a throwaway Postgres on a minimal Supabase stand-in
# that already holds TEST DATA billing rows (so the one-time backfills and the
# MRR rebase run on realistic history). Then asserts each corrected formula:
#   - MRR / ARR / paying orgs / ARPA from the real Atmosphere plan fields:
#     active + past_due only, trialing / canceled / comp_ / test-mode = $0,
#     stored Stripe amount wins over the catalog, annual / 12, +$125 per seat
#   - one internal / test / comp exclusion applied to every report, with the
#     p_include_internal toggle
#   - churn from subscription status changes; paying delta on paying orgs
#   - Field Capture seats and utilization
#   - collected revenue: live mode only, tax excluded, refunds netted once,
#     usage separate from subscription
#   - time to analysis from first_analysed_at (write-once), bulk re-analysis
#     left unknown, deleted films excluded, proofs analysed counted once
#   - deleted jobs excluded from the account file
#   - Feature usage AI column mapped to catalog keys
#   - metering reads token_usage_events
#   - grants: service_role only, staff actor re-checked
#
# Fixture rows are synthetic TEST DATA.
#
# Usage:  supabase/tests/11_analytics_audit_corrections.sh [psql-connection-args...]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$HERE/../migrations"
DB="${ANALYTICS_AUDIT_TEST_DB:-analytics_audit_test}"
PSQL=(psql "$@")
RUN=("${PSQL[@]}" -q -X -v ON_ERROR_STOP=1 -d "$DB")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -X -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in"
"${RUN[@]}" <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists private;
grant usage on schema auth, public to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text);

create type public.analytics_scope as enum ('investor', 'internal');
create type public.subscription_status as enum ('active', 'trialing', 'past_due', 'canceled');
create type public.billing_interval as enum ('monthly', 'annual');
create type public.token_usage_feature as enum ('ask', 'chat', 'web_search', 'computer', 'video_analysis', 'other');

create table public.orgs (id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now() - interval '90 days');
create table public.analytics_staff (user_id uuid primary key, scope public.analytics_scope not null, display_name text);
create table public.profiles (id uuid primary key, email text, full_name text);
create table public.org_members (id uuid primary key default gen_random_uuid(), org_id uuid not null, user_id uuid not null,
  role text not null default 'member', work_type text, status text default 'active',
  created_at timestamptz not null default now() - interval '60 days', usage_intents text[]);
create table public.org_invites (id uuid primary key default gen_random_uuid(), org_id uuid, email text, role text, status text);
create table public.org_billing (
  org_id uuid primary key, plan_code text not null default 'free',
  billing_interval public.billing_interval not null default 'monthly', seats integer not null default 1,
  status public.subscription_status not null default 'active',
  period_start timestamptz, period_end timestamptz,
  created_at timestamptz not null default now() - interval '90 days', updated_at timestamptz default now(),
  stripe_customer_id text, stripe_subscription_id text,
  extra_fc_seats integer not null default 0, atmosphere_plan_code text, included_fc_seats integer);
create table public.org_billing_events (
  id bigserial primary key, org_id uuid not null, effective_at timestamptz not null default now(),
  plan_code text, billing_interval public.billing_interval, seats integer not null default 0,
  status public.subscription_status not null, mrr_cents integer not null default 0, source text);
create table public.feature_catalog (key text primary key, label text, area text, is_active boolean default true, sort_order integer default 0);
create table public.feature_usage_sessions (id uuid primary key default gen_random_uuid(), org_id uuid, user_id uuid,
  feature_key text, started_at timestamptz, last_seen_at timestamptz, active_ms bigint default 0);
create table public.token_usage_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, user_id uuid, job_id uuid,
  feature public.token_usage_feature not null, source text, model_id text,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0, cache_tokens bigint not null default 0,
  total_tokens bigint generated always as (input_tokens + output_tokens + cache_tokens) stored,
  price_nanos bigint not null default 0, cost_nanos bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create view public.usage_events as
  select id, org_id, user_id, created_at, price_nanos, cost_nanos, feature::text as feature
  from public.token_usage_events;
create table public.job_proofs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, received_at timestamptz,
  duration_seconds numeric, analysis_status text, analysed_at timestamptz, deleted_at timestamptz);
create table public.crm_jobs (id uuid primary key default gen_random_uuid(), org_id uuid not null, title text,
  status text, work_type text, job_number bigint, created_at timestamptz default now(), deleted_at timestamptz);
create table public.payments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  kind text not null check (kind in ('subscription','credits','refund')),
  status text not null, amount_cents integer not null,
  stripe_payment_intent_id text, stripe_invoice_id text, stripe_charge_id text,
  created_at timestamptz not null default now());
create table public.capture_upload_attempts (org_id uuid, upload_key text, started_at timestamptz, last_attempt_at timestamptz,
  attempts integer default 1, completed_at timestamptz, failed_at timestamptz, last_error_code text);
create table public.ask_turn_events (id bigserial primary key, org_id uuid, outcome text, total_ms integer, ttft_ms integer,
  created_at timestamptz default now());
create table public.daily_job_reports (id uuid primary key default gen_random_uuid(), org_id uuid, status text, sent_at timestamptz);
create table public.evidence_downloads (id uuid primary key default gen_random_uuid(), org_id uuid, created_at timestamptz);
create table public.verifier_shares (id uuid primary key default gen_random_uuid(), org_id uuid, created_at timestamptz,
  last_opened_at timestamptz, open_count integer default 0);
create table public.job_proof_questions (id uuid primary key default gen_random_uuid(), org_id uuid, created_at timestamptz);

-- Legacy credits-catalog pricing (always $0 for plan_code 'free').
create function private.plan_mrr_cents(p_plan text, p_interval public.billing_interval, p_seats integer,
  p_status public.subscription_status) returns integer language sql immutable as $$
  select case when p_plan = 'free' or p_status not in ('active', 'past_due') then 0 else 1000 * greatest(p_seats, 1) end $$;
-- Field Capture seat count stand-in: members with the field_capture intent.
create function private.field_capture_seats_used(p_org uuid, p_exclude_user uuid default null,
  p_exclude_invite uuid default null) returns integer language sql stable as $$
  select count(*)::int from public.org_members m where m.org_id = p_org and 'field_capture' = any(coalesce(m.usage_intents, '{}')) $$;

-- The trigger as it is in production before the corrections.
create function private.record_billing_event() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.plan_code is not distinct from old.plan_code
     and new.billing_interval is not distinct from old.billing_interval
     and new.seats is not distinct from old.seats and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.org_billing_events (org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source)
  values (new.org_id, now(), new.plan_code, new.billing_interval, new.seats, new.status,
          private.plan_mrr_cents(new.plan_code, new.billing_interval, new.seats, new.status),
          case when tg_op = 'INSERT' then 'signup' else 'change' end);
  return new;
end $$;
create trigger org_billing_history after insert or update on public.org_billing
  for each row execute function private.record_billing_event();

-- The actor migration rewrites these two; give it something to rewrite.
create function public.admin_metering_analytics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object('ok', exists (select 1 from public.analytics_staff where user_id = auth.uid())) $$;
create function public.admin_token_usage_analytics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object('ok', exists (select 1 from public.analytics_staff where user_id = auth.uid())) $$;
SQL

echo "==> Migration 20261002193000_internal_analytics_actor (prerequisite)"
PGOPTIONS="-c client_min_messages=warning" "${RUN[@]}" -f "$MIG/20261002193000_internal_analytics_actor.sql"

echo "==> Pre-migration fixtures (TEST DATA)"
"${RUN[@]}" <<'SQL'
insert into public.analytics_staff values
  ('00000000-0000-4000-8000-000000000001', 'internal', 'Test Staff'),
  ('00000000-0000-4000-8000-000000000002', 'investor', 'Test Investor');

-- A starter monthly + 2 extra seats | B scale annual (Stripe amount set later)
-- C trialing | D comp_ | E internal (an id the backfill flags) | F canceled later
-- G test mode (set later) | H past_due starter | I no billing row
insert into public.orgs (id, name) values
  ('20000000-0000-4000-8000-00000000000a', 'Test A Starter'),
  ('20000000-0000-4000-8000-00000000000b', 'Test B Scale Annual'),
  ('20000000-0000-4000-8000-00000000000c', 'Test C Trial'),
  ('20000000-0000-4000-8000-00000000000d', 'Test D Comp'),
  ('8b2cc105-1eec-4123-90db-fdcbc5565252', 'Test E Internal'),
  ('20000000-0000-4000-8000-00000000000f', 'Test F Churns'),
  ('20000000-0000-4000-8000-000000000011', 'Test G Test Mode'),
  ('20000000-0000-4000-8000-000000000012', 'Test H Past Due'),
  ('20000000-0000-4000-8000-000000000013', 'Test I No Billing');

insert into public.org_billing (org_id, status, stripe_subscription_id, atmosphere_plan_code, included_fc_seats, extra_fc_seats) values
  ('20000000-0000-4000-8000-00000000000a', 'active',   'sub_A', 'starter',           3, 2),
  ('20000000-0000-4000-8000-00000000000b', 'active',   'sub_B', 'scale',             10, 0),
  ('20000000-0000-4000-8000-00000000000c', 'trialing', 'sub_C', 'work_verification', 3, 0),
  ('20000000-0000-4000-8000-00000000000d', 'active',   'comp_D', 'work_verification', 3, 0),
  ('8b2cc105-1eec-4123-90db-fdcbc5565252', 'active',   'sub_E', 'work_verification', 3, 0),
  ('20000000-0000-4000-8000-00000000000f', 'active',   'sub_F', 'starter',           3, 0),
  ('20000000-0000-4000-8000-000000000011', 'active',   'sub_G', 'starter',           3, 0),
  ('20000000-0000-4000-8000-000000000012', 'past_due', 'sub_H', 'starter',           3, 0);

insert into public.profiles (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'a1@example.test'),
  ('30000000-0000-4000-8000-000000000002', 'a2@example.test'),
  ('30000000-0000-4000-8000-000000000003', 'a3@example.test');
insert into public.org_members (org_id, user_id, usage_intents) values
  ('20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', '{field_capture}'),
  ('20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000002', '{field_capture}'),
  ('20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000003', '{office}');

-- Payments: A subscription $700 incl. $51 tax, A credits $50, two cumulative
-- refund rows on A's charge ($20 then $35 total), E (internal) $849.
insert into public.payments (org_id, kind, status, amount_cents, stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, created_at) values
  ('20000000-0000-4000-8000-00000000000a', 'subscription', 'succeeded', 70000, 'in_A', null, 'ch_A', now() - interval '5 days'),
  ('20000000-0000-4000-8000-00000000000a', 'credits', 'succeeded', 5000, null, 'pi_A2', 'ch_A2', now() - interval '4 days'),
  ('20000000-0000-4000-8000-00000000000a', 'refund', 'refunded', -2000, null, null, 'ch_A_refund', now() - interval '3 days'),
  ('20000000-0000-4000-8000-00000000000a', 'refund', 'refunded', -3500, null, null, 'ch_A_refund', now() - interval '2 days'),
  ('8b2cc105-1eec-4123-90db-fdcbc5565252', 'subscription', 'succeeded', 84900, 'in_E', null, 'ch_E', now() - interval '5 days'),
  ('20000000-0000-4000-8000-000000000011', 'subscription', 'succeeded', 99999, 'in_G', null, 'ch_G', now() - interval '5 days');

-- Films. Fresh: 30 s and 60 s; deleted: 5 s. Bulk re-analysis: 10 old films
-- all re-analysed in one hour two days ago; one film uploaded inside that
-- hour keeps its real first time (60 s).
insert into public.job_proofs (org_id, received_at, duration_seconds, analysis_status, analysed_at, deleted_at) values
  ('20000000-0000-4000-8000-00000000000a', now() - interval '3 days', 1800, 'done', now() - interval '3 days' + interval '30 seconds', null),
  ('20000000-0000-4000-8000-00000000000a', now() - interval '4 days', 1800, 'done', now() - interval '4 days' + interval '60 seconds', null),
  ('20000000-0000-4000-8000-00000000000a', now() - interval '4 days', 3600, 'done', now() - interval '4 days' + interval '5 seconds', now() - interval '1 day'),
  ('20000000-0000-4000-8000-00000000000a', date_trunc('hour', now() - interval '2 days') + interval '5 minutes', 600, 'done',
     date_trunc('hour', now() - interval '2 days') + interval '6 minutes', null),
  ('8b2cc105-1eec-4123-90db-fdcbc5565252', now() - interval '1 day', 600, 'done', now() - interval '1 day' + interval '1000 seconds', null);
insert into public.job_proofs (org_id, received_at, duration_seconds, analysis_status, analysed_at)
select '20000000-0000-4000-8000-00000000000a', now() - interval '20 days', 60, 'done',
       date_trunc('hour', now() - interval '2 days') + interval '10 minutes'
from generate_series(1, 10);

insert into public.crm_jobs (org_id, title, status, deleted_at) values
  ('20000000-0000-4000-8000-00000000000a', 'Job 1', 'open', null),
  ('20000000-0000-4000-8000-00000000000a', 'Job 2', 'open', null),
  ('20000000-0000-4000-8000-00000000000a', 'Job 3', 'open', now() - interval '1 day');

insert into public.feature_catalog (key, label, area, sort_order) values
  ('ai_assistant', 'AI assistant', 'ai', 1), ('computer_use', 'Computer use', 'ai', 2),
  ('verifier_library', 'Verifier library', 'capture', 3);
insert into public.token_usage_events (org_id, feature, model_id, cost_nanos, price_nanos, input_tokens)
select '20000000-0000-4000-8000-00000000000a', f::public.token_usage_feature, 'claude-test', 1000000000, 10000000000, 100
from unnest(array['ask', 'ask', 'chat', 'computer', 'video_analysis']) f;
insert into public.token_usage_events (org_id, feature, model_id, cost_nanos, price_nanos, input_tokens)
select '8b2cc105-1eec-4123-90db-fdcbc5565252', 'ask', 'gpt-test', 2000000000, 20000000000, 100
from generate_series(1, 5);
SQL

for pass in 1 2; do
  echo "==> Migration 20261007230000_analytics_audit_corrections (pass $pass)"
  PGOPTIONS="-c client_min_messages=warning" "${RUN[@]}" -f "$MIG/20261007230000_analytics_audit_corrections.sql"
done

echo "==> Post-migration changes (webhook writes, re-analysis, cancel)"
"${RUN[@]}" <<'SQL'
-- History: A was already paying 40 days ago (before this month).
insert into public.org_billing_events (org_id, effective_at, status, mrr_cents, atmosphere_plan_code, fc_seats, source)
values ('20000000-0000-4000-8000-00000000000a', now() - interval '40 days', 'active', 64900, 'starter', 5, 'test');
update public.org_billing_events set effective_at = now() - interval '41 days'
where org_id = '20000000-0000-4000-8000-00000000000a' and source = 'signup';
-- Webhook stores B's real Stripe amount ($1,500/mo after discount, annual).
update public.org_billing set stripe_mrr_cents = 150000, stripe_interval = 'year', stripe_livemode = true
where org_id = '20000000-0000-4000-8000-00000000000b';
-- G turns out to be a test-mode subscription.
update public.org_billing set stripe_livemode = false where org_id = '20000000-0000-4000-8000-000000000011';
-- F cancels this month.
update public.org_billing set status = 'canceled' where org_id = '20000000-0000-4000-8000-00000000000f';
-- Webhook writes tax and mode; a usage invoice for B; G's payment was test mode.
update public.payments set tax_cents = 5100, livemode = true where stripe_invoice_id = 'in_A';
update public.payments set livemode = false where stripe_invoice_id = 'in_G';
insert into public.payments (org_id, kind, status, amount_cents, stripe_invoice_id, tax_cents, livemode, created_at)
values ('20000000-0000-4000-8000-00000000000b', 'usage', 'succeeded', 10000, 'in_B_usage', 0, true, now() - interval '1 day');
-- Re-analysis of a fresh film must not move its first analysis time.
update public.job_proofs set analysed_at = now()
where org_id = '20000000-0000-4000-8000-00000000000a' and received_at = (
  select min(received_at) from public.job_proofs
  where org_id = '20000000-0000-4000-8000-00000000000a' and received_at > now() - interval '3 days 1 minute'
    and received_at < now() - interval '2 days 23 hours');
-- A new film analysed 90 s after upload.
insert into public.job_proofs (org_id, received_at, duration_seconds, analysis_status, analysed_at)
values ('20000000-0000-4000-8000-00000000000a', now() - interval '1 hour', 60, 'done', now() - interval '1 hour' + interval '90 seconds');
SQL

echo "==> Assertions"
"${RUN[@]}" -o /dev/null <<'SQL'
\set QUIET on
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- 0. Grants and the staff actor.
select pg_temp.check(not has_function_privilege('authenticated', 'public.analytics_summary(timestamptz, timestamptz, boolean)', 'execute'), 'authenticated cannot execute analytics_summary');
select pg_temp.check(not has_function_privilege('anon', 'public.analytics_internal_orgs()', 'execute'), 'anon cannot execute analytics_internal_orgs');
select pg_temp.check(has_function_privilege('service_role', 'public.analytics_product_health(integer, boolean)', 'execute'), 'service_role can execute analytics_product_health');
select pg_temp.check(not has_table_privilege('authenticated', 'private.payments_net', 'select'), 'authenticated cannot read private.payments_net');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'analytics_summary' and p.pronargs = 2), 'old 2-arg analytics_summary is gone');

-- Backfills.
select pg_temp.check((select exclude_from_analytics from public.orgs where id = '8b2cc105-1eec-4123-90db-fdcbc5565252'), 'Jettx id flagged internal');
select pg_temp.check((select count(*) = 10 from public.job_proofs where analysis_status = 'done' and first_analysed_at is null), 'bulk re-analysis rows left unknown (10)');
select pg_temp.check((select count(*) = 1 from public.payments where kind = 'usage'), 'payments accept kind usage');

set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-0000000000ff"}';
do $$ begin
  perform public.analytics_summary(now() - interval '30 days', now(), false);
  raise exception 'FAIL: non-staff actor read the summary';
exception when insufficient_privilege then raise notice 'ok - non-staff actor is refused (42501)';
end $$;

set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-000000000002"}';
do $$ begin
  perform public.analytics_accounts(now() - interval '30 days', now(), 50, false);
  raise exception 'FAIL: investor read accounts';
exception when insufficient_privilege then raise notice 'ok - investor scope cannot read accounts';
end $$;
create temp table s_inv as select public.analytics_summary(now() - interval '30 days', now(), false) as j;
create temp table s_inv_inc as select public.analytics_summary(now() - interval '30 days', now(), true) as j;

set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-000000000001"}';
create temp table s as select public.analytics_summary(now() - interval '30 days', now(), false) as j;
create temp table si as select public.analytics_summary(now() - interval '30 days', now(), true) as j;
create temp table m as select * from public.analytics_monthly(3, false);
create temp table pm as select * from public.analytics_plan_mix(false);
create temp table pmi as select * from public.analytics_plan_mix(true);
create temp table acc as select * from public.analytics_accounts(now() - interval '30 days', now(), 50, false);
create temp table acci as select * from public.analytics_accounts(now() - interval '30 days', now(), 50, true);
create temp table det as select public.analytics_account_detail('20000000-0000-4000-8000-00000000000a', now() - interval '30 days', now()) as j;
create temp table f as select * from public.analytics_features(now() - interval '30 days', now(), false);
create temp table fi as select * from public.analytics_features(now() - interval '30 days', now(), true);
create temp table h as select public.analytics_product_health(12, false) as j;
create temp table hi as select public.analytics_product_health(12, true) as j;
create temp table met as select public.admin_metering_analytics(now() - interval '30 days', now(), false) as j;
create temp table meti as select public.admin_metering_analytics(now() - interval '30 days', now(), true) as j;
create temp table tok as select public.admin_token_usage_analytics(now() - interval '30 days', now(), false) as j;
create temp table io as select * from public.analytics_internal_orgs();
reset role;

-- 1. Revenue from the real plan fields.
select pg_temp.check((select (j -> 'revenue' ->> 'mrr_cents')::bigint = 254800 from s),
  'MRR = A $649 (starter + 2 seats) + B $1,500 (stored Stripe amount) + H $399 (past_due)');
select pg_temp.check((select (j -> 'revenue' ->> 'arr_cents')::bigint = 254800 * 12 from s), 'ARR = MRR x 12');
select pg_temp.check((select (j -> 'customers' ->> 'orgs_paying')::int = 3 from s), 'paying orgs = 3 (trial, canceled, comp, test mode excluded)');
select pg_temp.check((select (j -> 'revenue' ->> 'arpa_mrr_cents')::numeric = 84933 from s), 'ARPA = MRR / paying orgs');
select pg_temp.check((select (j -> 'revenue' ->> 'annual_contracted_mrr_cents')::bigint = 150000 from s), 'annual-term MRR = B');
select pg_temp.check((select (j -> 'revenue' ->> 'trial_pipeline_mrr_cents')::bigint = 84900 from s), 'trial pipeline = C at catalog price');
select pg_temp.check((select (j -> 'revenue' ->> 'mrr_cents')::bigint = 254800 + 84900 from si), 'with internal: + E $849');
select pg_temp.check((select (j -> 'customers' ->> 'orgs_paying')::int = 4 from si), 'with internal: 4 paying');

-- 2. Exclusion everywhere.
select pg_temp.check((select (j -> 'customers' ->> 'orgs_total')::int = 7 from s), 'orgs total excludes comp + internal');
select pg_temp.check((select (j -> 'customers' ->> 'orgs_total')::int = 9 from si), 'orgs total with internal = 9');
select pg_temp.check((select (j -> 'customers' ->> 'orgs_excluded')::int = 2 from s), 'orgs excluded = 2');
select pg_temp.check((select count(*) = 2 from io), 'analytics_internal_orgs lists 2');
select pg_temp.check((select reason = 'comp account' from io where org_id = '20000000-0000-4000-8000-00000000000d'), 'comp_ subscription is internal automatically');
select pg_temp.check((select count(*) = 7 from acc) and (select count(*) = 9 from acci), 'accounts list honours the toggle');
select pg_temp.check((select internal from acci where org_id = '8b2cc105-1eec-4123-90db-fdcbc5565252'), 'accounts flag internal rows');

-- 3. Churn and the paying delta.
select pg_temp.check((select (j -> 'revenue' ->> 'churned_orgs_this_month')::int = 1 from s), 'churn this month = 1 (F canceled)');
select pg_temp.check((select churned_orgs = 1 from m order by month desc limit 1), 'monthly churned_orgs = 1');
select pg_temp.check((select (j -> 'customers' ->> 'orgs_paying_prev')::int = 1 from s), 'paying at month start = 1 (A)');
select pg_temp.check((select (j -> 'customers' ->> 'paying_growth_mom_pct')::numeric = 200.0 from s), 'paying delta computed on paying orgs (1 -> 3 = +200%)');

-- 4. Field Capture seats.
select pg_temp.check((select (j -> 'seats' ->> 'seats_licensed')::int = 18 from s), 'FC seats licensed = 5 + 10 + 3');
select pg_temp.check((select (j -> 'seats' ->> 'seats_filled')::int = 2 from s), 'FC seats filled = 2');
select pg_temp.check((select (j -> 'seats' ->> 'seat_utilization_pct')::numeric = 11.1 from s), 'utilization = 11.1%');

-- 5. Collected revenue.
select pg_temp.check((select (j -> 'revenue' ->> 'collected_in_range_cents')::bigint = 76655 from s),
  'collected = $649 net sub + $50 credits + $100 usage - $32.45 refund (pre-tax share); test mode and internal out');
select pg_temp.check((select (j -> 'revenue' ->> 'subscription_revenue_cents')::bigint = 64900 from s), 'subscription revenue excludes tax');
select pg_temp.check((select (j -> 'revenue' ->> 'usage_revenue_cents')::bigint = 10000 from s), 'usage revenue separate');
select pg_temp.check((select (j -> 'revenue' ->> 'refunds_cents')::bigint = -3245 from s), 'refund counted once (cumulative), tax share removed');
select pg_temp.check((select (j -> 'revenue' ->> 'tax_excluded_cents')::bigint = 5100 from s), 'tax excluded reported');

-- 6. Unit economics: internal only, honest names.
select pg_temp.check((select j ? 'unit_economics' from s) and not (select j ? 'unit_economics' from s_inv), 'unit economics internal-only');
select pg_temp.check((select (j->>'include_internal')::boolean = false and (j->'customers'->>'orgs_paying') = (select j->'customers'->>'orgs_paying' from s) from s_inv_inc), 'investors cannot include internal accounts');
select pg_temp.check((select not (j -> 'unit_economics' ? 'gross_margin_pct') from s), 'no gross margin on list value');
select pg_temp.check((select (j -> 'unit_economics' ->> 'model_cost_cents')::numeric = 500 from s), 'model cost = $5.00 (customer orgs)');

-- 7. Plan mix.
select pg_temp.check((select orgs = 2 and mrr_cents = 104800 from pm where plan_code = 'starter' and billing_interval = 'monthly'), 'plan mix: Starter monthly 2 orgs');
select pg_temp.check((select orgs = 1 and seats = 10 from pm where plan_code = 'scale' and billing_interval = 'annual'), 'plan mix: Scale annual 1 org, 10 FC seats');
select pg_temp.check((select orgs = 4 and mrr_cents = 0 from pm where plan_code = 'none'), 'plan mix: 4 orgs with no paid subscription');
select pg_temp.check((select sum(orgs) = 7 from pm), 'plan mix org counts add up');
select pg_temp.check((select orgs = 1 and mrr_cents = 0 from pmi where plan_code = 'comp'), 'plan mix with internal: comp row at $0');

-- 8. Accounts and the account file.
select pg_temp.check((select plan_name = 'Starter' and seats = 5 and mrr_cents = 64900 and status = 'active'
  from acc where org_id = '20000000-0000-4000-8000-00000000000a'), 'account A: Starter, 5 FC seats, $649');
select pg_temp.check((select status = 'test_mode' and mrr_cents = 0 from acc where org_id = '20000000-0000-4000-8000-000000000011'), 'account G: test mode, $0');
select pg_temp.check((select plan_code = 'none' from acc where org_id = '20000000-0000-4000-8000-000000000013'), 'account I: no plan');
select pg_temp.check((select last_active_at is not null from acc where org_id = '20000000-0000-4000-8000-00000000000a'), 'last active uses uploads / AI calls');
select pg_temp.check((select (j -> 'jobs' ->> 'total')::int = 2 and (j -> 'jobs' ->> 'deleted')::int = 1 from det), 'account file: deleted jobs excluded and counted apart');
select pg_temp.check((select jsonb_array_length(j -> 'jobs' -> 'recent') = 2 from det), 'account file: recent jobs exclude deleted');

-- 9. Feature usage AI column.
select pg_temp.check((select ai_requests = 3 from f where feature_key = 'ai_assistant'), 'AI column: ask + chat -> ai_assistant = 3');
select pg_temp.check((select ai_requests = 1 from f where feature_key = 'computer_use'), 'AI column: computer -> computer_use');
select pg_temp.check((select ai_requests = 1 from f where feature_key = 'verifier_library'), 'AI column: video_analysis -> verifier_library');
select pg_temp.check((select ai_requests = 8 from fi where feature_key = 'ai_assistant'), 'AI column with internal = 8');

-- 10. Time to analysis and proofs analysed.
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'median_seconds')::numeric = 60 from h), 'TTA median = 60 s (30, 60, 60, 90; re-analysis ignored)');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'analysed')::int = 4 from h), 'TTA analysed = 4 (deleted + unknown excluded)');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'first_time_unknown')::int = 10 from h), 'TTA first_time_unknown = 10');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'p90_seconds')::numeric < 100 from h), 'TTA p90 not skewed by the bulk batch');
select pg_temp.check((select (j -> 'evidence' -> 'current' ->> 'proofs_analysed')::int = 4 from h), 'proofs analysed = 4 (first analyses only)');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'analysed')::int = 5 from hi), 'TTA with internal = 5');
select pg_temp.check((select (w ->> 'films')::int >= 0 from h, jsonb_array_elements(j -> 'north_star' -> 'weekly') w limit 1), 'north star series present');
select pg_temp.check((select coalesce(sum((w ->> 'films')::int), 0) = 14 from h, jsonb_array_elements(j -> 'north_star' -> 'weekly') w),
  'north star counts live films only (deleted excluded, internal excluded)');

-- 11. Metering reads the ledger.
select pg_temp.check((select j ->> 'source' = 'token_usage_events' from met), 'metering source = token_usage_events');
select pg_temp.check((select (j -> 'totals' ->> 'eventCount')::int = 5 and (j -> 'totals' ->> 'aiCostNanos')::bigint = 5000000000 from met), 'metering totals (customers): 5 events, $5');
select pg_temp.check((select (j -> 'totals' ->> 'eventCount')::int = 10 from meti), 'metering with internal: 10 events');
select pg_temp.check((select j -> 'byModel' -> 0 ->> 'provider' = 'anthropic' from met), 'metering provider derived from model');
select pg_temp.check((select (j -> 'totals' ->> 'costNanos')::bigint = 5000000000 from tok), 'token usage carries costNanos');

-- 12. Billing history.
select pg_temp.check((select mrr_cents = 150000 from public.org_billing_events where org_id = '20000000-0000-4000-8000-00000000000b'
  order by effective_at desc, id desc limit 1), 'webhook amount change records a billing event');
select pg_temp.check((select count(*) = 0 from public.org_billing_events where source = 'rebase'
  and org_id = '20000000-0000-4000-8000-000000000013'), 'no rebase for an org without billing');
select pg_temp.check((select count(*) from public.org_billing_events where source = 'rebase') = 8, 'rebase is one row per billed org (second pass added none)');
SQL

echo
echo "==> Done."
