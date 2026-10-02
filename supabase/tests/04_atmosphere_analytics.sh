#!/usr/bin/env bash
#
# Atmosphere Analytics SQL: product-health report, upload / Ask tracking,
# and staff email campaigns.
#
# Applies 20261002193000_internal_analytics_actor once, then the two Atmosphere
# Analytics migrations twice (to prove they are idempotent), to a throwaway Postgres on a minimal Supabase stand-in, then asserts:
#   - only service_role can execute the reports; anon/authenticated cannot
#     read the new tables
#   - the database re-checks analytics_staff for the actor the BFF sends
#   - the report's numbers match hand-counted fixture rows
#   - campaign sends skip suppressed addresses, a campaign sends once, and an
#     unsubscribe token suppresses that address
#
# Fixture rows are synthetic TEST DATA (example.test addresses).
#
# Usage:  supabase/tests/04_atmosphere_analytics.sh [psql-connection-args...]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$HERE/../migrations"
DB="${ATMOSPHERE_ANALYTICS_TEST_DB:-atmosphere_analytics_test}"
PSQL=(psql "$@")
RUN=("${PSQL[@]}" -q -X -v ON_ERROR_STOP=1 -d "$DB")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -X -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in"
"${RUN[@]}" <<'SQL'
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

create type public.analytics_scope as enum ('investor', 'internal');
create type public.subscription_status as enum ('active', 'trialing', 'past_due', 'canceled');

create table public.orgs (id uuid primary key default gen_random_uuid(), name text not null);
create table public.analytics_staff (user_id uuid primary key, scope public.analytics_scope not null, display_name text);
create table public.org_billing_events (
  id bigserial primary key, org_id uuid not null, effective_at timestamptz not null,
  seats integer not null, status public.subscription_status not null, mrr_cents integer not null);
create table public.job_proofs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, received_at timestamptz,
  duration_seconds numeric, analysis_status text, analysed_at timestamptz);
create table public.daily_job_reports (id uuid primary key default gen_random_uuid(), status text, sent_at timestamptz);
create table public.evidence_downloads (id uuid primary key default gen_random_uuid(), created_at timestamptz);
create table public.verifier_shares (
  id uuid primary key default gen_random_uuid(), created_at timestamptz, last_opened_at timestamptz, open_count integer);
create table public.job_proof_questions (id uuid primary key default gen_random_uuid(), org_id uuid, created_at timestamptz);

-- The actor migration rewrites these two; give it something to rewrite.
create function public.admin_metering_analytics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object('ok', exists (select 1 from public.analytics_staff where user_id = auth.uid())) $$;
create function public.admin_token_usage_analytics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object('ok', exists (select 1 from public.analytics_staff where user_id = auth.uid())) $$;
SQL

echo "==> Migration 20261002193000_internal_analytics_actor (prerequisite)"
"${RUN[@]}" -f "$MIG/20261002193000_internal_analytics_actor.sql"

for pass in 1 2; do
  echo "==> Atmosphere Analytics migrations (pass $pass)"
  PGOPTIONS="-c client_min_messages=warning" "${RUN[@]}" -f "$MIG/20261002210000_atmosphere_analytics_health.sql"
  PGOPTIONS="-c client_min_messages=warning" "${RUN[@]}" -f "$MIG/20261002211000_atmosphere_analytics_campaigns.sql"
done

echo "==> Fixtures (TEST DATA)"
"${RUN[@]}" <<'SQL'
insert into public.analytics_staff values
  ('00000000-0000-4000-8000-000000000001', 'internal', 'Test Staff'),
  ('00000000-0000-4000-8000-000000000002', 'investor', 'Test Investor');
insert into public.orgs (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Test Org Paying'),
  ('10000000-0000-4000-8000-000000000002', 'Test Org Trial');
-- Paying org: 4 seats since 60 days ago. Trial org: 10 seats, not paying.
insert into public.org_billing_events (org_id, effective_at, seats, status, mrr_cents) values
  ('10000000-0000-4000-8000-000000000001', now() - interval '60 days', 4, 'active', 340000),
  ('10000000-0000-4000-8000-000000000002', now() - interval '60 days', 10, 'trialing', 0);
-- Last complete week: paying org files 8 h, trial org 5 h.
insert into public.job_proofs (org_id, received_at, duration_seconds, analysis_status, analysed_at)
select '10000000-0000-4000-8000-000000000001'::uuid, ws + interval '1 day', 4 * 3600, 'done'::text, ws + interval '1 day' + interval '10 minutes'
from (select (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') - interval '7 days' as ws) w
union all
select '10000000-0000-4000-8000-000000000001'::uuid, ws + interval '2 days', 4 * 3600, 'done', ws + interval '2 days' + interval '30 minutes'
from (select (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') - interval '7 days' as ws) w
union all
select '10000000-0000-4000-8000-000000000002'::uuid, ws + interval '2 days', 5 * 3600, 'failed', null
from (select (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') - interval '7 days' as ws) w;
insert into public.verifier_shares (created_at, last_opened_at, open_count) values
  (now() - interval '3 days', now() - interval '1 day', 5),
  (now() - interval '40 days', null, 2);
insert into public.daily_job_reports (status, sent_at) values ('sent', now() - interval '2 days'), ('failed', now() - interval '2 days');
insert into public.job_proof_questions (org_id, created_at) values
  ('10000000-0000-4000-8000-000000000001', now() - interval '1 day'),
  ('10000000-0000-4000-8000-000000000001', now() - interval '30 days');
insert into public.ask_turn_events (org_id, outcome, total_ms, ttft_ms) values
  ('10000000-0000-4000-8000-000000000001', 'answered', 1000, 300),
  ('10000000-0000-4000-8000-000000000001', 'answered', 3000, 500),
  ('10000000-0000-4000-8000-000000000001', 'error', 200, null);
SQL

echo "==> Assertions"
"${RUN[@]}" -o /dev/null <<'SQL'
\set QUIET on
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- 1. Grants: browser roles cannot run reports or read tracking tables.
select pg_temp.check(not has_function_privilege('authenticated', 'public.analytics_product_health(integer)', 'execute'), 'authenticated cannot execute analytics_product_health');
select pg_temp.check(not has_function_privilege('anon', 'public.record_capture_upload(uuid, text, text, uuid, text)', 'execute'), 'anon cannot execute record_capture_upload');
select pg_temp.check(not has_function_privilege('authenticated', 'public.analytics_campaign_begin_send(uuid, text[])', 'execute'), 'authenticated cannot start a campaign send');
select pg_temp.check(has_function_privilege('service_role', 'public.analytics_product_health(integer)', 'execute'), 'service_role can execute analytics_product_health');
select pg_temp.check(not has_table_privilege('authenticated', 'public.capture_upload_attempts', 'select'), 'authenticated cannot read capture_upload_attempts');
select pg_temp.check(not has_table_privilege('anon', 'public.ask_turn_events', 'select'), 'anon cannot read ask_turn_events');
select pg_temp.check(not has_table_privilege('authenticated', 'public.analytics_email_suppressions', 'select'), 'authenticated cannot read suppressions');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.analytics_campaigns'::regclass), 'RLS on analytics_campaigns');

-- 2. Upload lifecycle writer (service role, as the BFF calls it).
set role service_role;
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/a.mp4', 'start');
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/a.mp4', 'start');
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/a.mp4', 'complete');
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/b.mp4', 'start');
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/b.mp4', 'fail', null, 'upload_missing');
select public.record_capture_upload('10000000-0000-4000-8000-000000000001', 'org/job/c.mp4', 'start');
reset role;
select pg_temp.check((select attempts from public.capture_upload_attempts where upload_key = 'org/job/a.mp4') = 2, 'retry increments attempts');
select pg_temp.check((select completed_at is not null from public.capture_upload_attempts where upload_key = 'org/job/a.mp4'), 'complete stamps completed_at');
select pg_temp.check((select last_error_code from public.capture_upload_attempts where upload_key = 'org/job/b.mp4') = 'upload_missing', 'fail keeps the error code');

-- 3. The report re-checks the staff row of the actor header.
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-0000000000ff"}';
do $$ begin
  perform public.analytics_product_health(12);
  raise exception 'FAIL: non-staff actor read the report';
exception when insufficient_privilege then raise notice 'ok - non-staff actor is refused (42501)';
end $$;
set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-000000000002"}';
do $$ begin
  perform public.analytics_campaigns_list();
  raise exception 'FAIL: investor scope listed campaigns';
exception when insufficient_privilege then raise notice 'ok - investor scope cannot list campaigns';
end $$;
select pg_temp.check((public.analytics_product_health(12) -> 'weeks')::int = 12, 'investor scope can read product health');

set request.headers = '{"x-analytics-user-id":"00000000-0000-4000-8000-000000000001"}';
create temp table h as select public.analytics_product_health(12) as j;
reset role;

select pg_temp.check(
  (select (w ->> 'hours_per_seat')::numeric = 2
            and (w ->> 'paying_seats')::int = 4
            and (w ->> 'hours_paying')::numeric = 8
            and (w ->> 'hours_all')::numeric = 13
     from h, jsonb_array_elements(j -> 'north_star' -> 'weekly') w
    where (w ->> 'week_start')::timestamptz = (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') - interval '7 days'),
  'north star: 8 h paying / 4 paying seats = 2.0 h per seat; trial hours excluded');
select pg_temp.check(
  (select (w ->> 'partial')::boolean from h, jsonb_array_elements(j -> 'north_star' -> 'weekly') w
    order by (w ->> 'week_start')::timestamptz desc limit 1),
  'current week is flagged partial');
select pg_temp.check((select (j -> 'uploads' -> 'current' ->> 'started')::int = 3 from h), 'uploads started = 3');
select pg_temp.check((select (j -> 'uploads' -> 'current' ->> 'completed')::int = 1 from h), 'uploads completed = 1');
select pg_temp.check((select (j -> 'uploads' -> 'current' ->> 'failed')::int = 1 from h), 'uploads failed = 1');
select pg_temp.check((select (j -> 'uploads' -> 'current' ->> 'in_flight')::int = 1 from h), 'uploads in flight = 1');
select pg_temp.check((select (j -> 'uploads' -> 'current' ->> 'retried')::int = 1 from h), 'uploads retried = 1');
select pg_temp.check((select j -> 'uploads' -> 'top_errors' -> 0 ->> 'code' = 'upload_missing' from h), 'top upload error code');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'median_seconds')::numeric = 1200 from h), 'analysis median = 20 min');
select pg_temp.check((select (j -> 'analysis' -> 'current' ->> 'failed')::int = 1 from h), 'analysis failed = 1');
select pg_temp.check((select (j -> 'evidence' -> 'current' ->> 'share_links_created')::int = 1 from h), 'share links created (28 d) = 1');
select pg_temp.check((select (j -> 'evidence' -> 'lifetime' ->> 'share_link_opens')::int = 7 from h), 'lifetime share-link opens = 7');
select pg_temp.check((select (j -> 'evidence' -> 'current' ->> 'daily_reports_sent')::int = 1 from h), 'daily reports sent = 1');
select pg_temp.check((select (j -> 'ask' -> 'questions' ->> 'current')::int = 1 from h), 'questions asked (28 d) = 1');
select pg_temp.check((select (j -> 'ask' -> 'current' ->> 'errors')::int = 1 from h), 'ask errors = 1');
select pg_temp.check((select (j -> 'ask' -> 'current' ->> 'median_ms')::numeric = 2000 from h), 'ask median latency = 2000 ms');
select pg_temp.check((select j -> 'ask' -> 'feedback' = 'null'::jsonb from h), 'ask feedback is honestly null');

-- 4. Campaigns: drafts, suppression, single send, unsubscribe.
insert into public.analytics_email_suppressions (email, reason) values ('suppressed@example.test', 'manual');
set role service_role;
create temp table c as select public.analytics_campaign_save(null, 'Test campaign', 'Hello', 'Body', '{"statuses":["active"]}') as j;
create temp table s as select public.analytics_campaign_begin_send((select (j ->> 'id')::uuid from c),
  array['A@Example.test', 'a@example.test', 'b@example.test', 'suppressed@example.test', 'not-an-email']) as j;
reset role;
select pg_temp.check((select jsonb_array_length(j -> 'recipients') = 2 from s), 'two unique, unsuppressed recipients');
select pg_temp.check((select (j ->> 'suppressed')::int = 1 from s), 'one suppressed address skipped');
select pg_temp.check((select status = 'sending' from public.analytics_campaigns), 'campaign moved to sending');
set role service_role;
do $$ begin
  perform public.analytics_campaign_begin_send((select id from public.analytics_campaigns limit 1), array['c@example.test']);
  raise exception 'FAIL: a campaign started sending twice';
exception when no_data_found then raise notice 'ok - a campaign cannot start sending twice';
end $$;
do $$ begin
  perform public.analytics_campaign_save((select id from public.analytics_campaigns limit 1), 'x', 'x', 'x', '{}');
  raise exception 'FAIL: edited a campaign that is sending';
exception when no_data_found then raise notice 'ok - only drafts are editable';
end $$;
select public.analytics_campaign_finish_send((select id from public.analytics_campaigns limit 1),
  '[{"email":"a@example.test","ok":true,"provider_id":"test-1"},{"email":"b@example.test","ok":false,"error":"bounced"}]');
select public.record_unsubscribe((select unsubscribe_token from public.analytics_campaign_sends where email = 'a@example.test'));
select pg_temp.check(public.record_unsubscribe('not-a-real-token-but-long-enough-0000000000'), 'unknown token still answers true');
reset role;
select pg_temp.check((select status = 'sent' and sent_count = 1 and failed_count = 1 from public.analytics_campaigns), 'campaign results recorded');
select pg_temp.check(exists (select 1 from public.analytics_email_suppressions where email = 'a@example.test' and reason = 'unsubscribe'), 'unsubscribe link suppresses the address');
select pg_temp.check((select count(*) = 2 from public.analytics_email_suppressions), 'unknown token suppresses nobody');
SQL

echo
echo "==> Done. Every line above starting 'ok -' is a passing assertion."
