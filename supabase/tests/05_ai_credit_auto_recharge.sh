#!/usr/bin/env bash
#
# AI credit auto-recharge: the database is the last guard against a loop or a
# double charge, so this applies 20261003160000_ai_credit_auto_recharge twice
# (idempotent) on a minimal Supabase stand-in and asserts:
#   - auto-recharge is off by default and an org with no row cannot claim
#   - only one attempt can be in flight per org
#   - the cooldown and the 24-hour cap refuse new attempts
#   - each attempt gets its own idempotency key
#   - a failed charge turns auto-recharge off and stores the reason
#   - a late failure cannot overwrite a succeeded attempt
#   - only service_role can claim or finish; authenticated cannot
#
# Fixture rows are synthetic TEST DATA.
#
# Usage:  supabase/tests/05_ai_credit_auto_recharge.sh [psql-connection-args...]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="$HERE/../migrations/20261003160000_ai_credit_auto_recharge.sql"
DB="${AI_AUTO_RECHARGE_TEST_DB:-ai_auto_recharge_test}"
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
create table public.orgs (id uuid primary key default gen_random_uuid(), name text not null);
create or replace function private.is_org_member(p_org uuid) returns boolean
  language sql stable as $$ select false $$;
SQL

echo "==> Migration (twice)"
"${RUN[@]}" -f "$MIGRATION" 2>&1 | grep -v 'NOTICE:.*skipping' || true
"${RUN[@]}" -f "$MIGRATION" 2>&1 | grep -v 'NOTICE:.*skipping' || true

echo "==> Assertions"
# Result rows go to /dev/null; each assertion prints "ok: ..." as a NOTICE.
"${RUN[@]}" >/dev/null <<'SQL'
\set QUIET on
insert into public.orgs (id, name) values
  ('a0000000-0000-4000-8000-000000000001', 'TEST Org A'),
  ('b0000000-0000-4000-8000-000000000002', 'TEST Org B');

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 600, 3)) = 'disabled',
  'an org with no settings row cannot claim');

insert into public.ai_credit_auto_recharge_settings (org_id) values ('a0000000-0000-4000-8000-000000000001');
select pg_temp.expect(
  (select not enabled and pack_code = 'ai_10' from public.ai_credit_auto_recharge_settings
    where org_id = 'a0000000-0000-4000-8000-000000000001'),
  'auto-recharge defaults to off');
select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 600, 3)) = 'disabled',
  'default-off org cannot claim');

update public.ai_credit_auto_recharge_settings set enabled = true, pack_code = 'ai_25'
 where org_id = 'a0000000-0000-4000-8000-000000000001';

create temp table first_claim as
  select * from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 600, 3, 900, 'test');
select pg_temp.expect((select claimed and pack_code = 'ai_25' from first_claim), 'enabled org claims one attempt');
select pg_temp.expect(
  (select idempotency_key = 'ai-auto-recharge:a0000000-0000-4000-8000-000000000001:' || recharge_id from first_claim),
  'idempotency key is bound to the attempt id');
select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3)) = 'in_flight',
  'a second attempt is refused while one is in flight');

select public.finish_ai_auto_recharge((select recharge_id from first_claim), 'succeeded', 'pi_test_1', 'ch_test_1', 2500, 'usd', 25000000000000);
select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 600, 3)) = 'cooldown',
  'the cooldown refuses an immediate retry');

select pg_temp.expect(
  (select status from public.finish_ai_auto_recharge((select recharge_id from first_claim), 'failed', null, null, null, null, null, 'x', 'late')) = 'succeeded',
  'a late failure cannot undo a succeeded attempt');
select pg_temp.expect(
  (select enabled from public.ai_credit_auto_recharge_settings where org_id = 'a0000000-0000-4000-8000-000000000001'),
  'a late failure on a succeeded attempt does not turn auto-recharge off');

create temp table second_claim as
  select * from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3);
select pg_temp.expect(
  (select s.idempotency_key <> f.idempotency_key from second_claim s, first_claim f),
  'each attempt gets a new idempotency key');
select public.finish_ai_auto_recharge((select recharge_id from second_claim), 'failed', 'pi_test_2', null, 2500, 'usd', null, 'card_declined', 'Your card was declined.');
select pg_temp.expect(
  (select not enabled and disabled_reason = 'Your card was declined.' and disabled_at is not null
     from public.ai_credit_auto_recharge_settings where org_id = 'a0000000-0000-4000-8000-000000000001'),
  'a failed charge turns auto-recharge off with the reason');
select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3)) = 'disabled',
  'nothing is claimed after a failure until the owner turns it back on');

update public.ai_credit_auto_recharge_settings set enabled = true
 where org_id = 'a0000000-0000-4000-8000-000000000001';
create temp table third_claim as
  select * from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3);
select public.finish_ai_auto_recharge((select recharge_id from third_claim), 'succeeded', 'pi_test_3', null, 2500, 'usd', 25000000000000);
select pg_temp.expect(
  (select reason from public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3)) = 'daily_cap',
  'the 24-hour cap refuses a fourth attempt');

insert into public.ai_credit_auto_recharge_settings (org_id, enabled) values ('b0000000-0000-4000-8000-000000000002', true);
insert into public.ai_credit_auto_recharges (org_id, pack_code, idempotency_key, created_at)
  values ('b0000000-0000-4000-8000-000000000002', 'ai_10', 'stale-key', now() - interval '1 hour');
select pg_temp.expect(
  (select claimed from public.claim_ai_auto_recharge('b0000000-0000-4000-8000-000000000002', 0, 3, 900)),
  'a crashed attempt older than the stale window is closed so the org is not stuck');
select pg_temp.expect(
  (select status = 'failed' and failure_code = 'stale_attempt' from public.ai_credit_auto_recharges where idempotency_key = 'stale-key'),
  'the stale attempt is recorded as failed');
commit;

-- Callers other than service_role are refused.
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$ begin
  perform public.claim_ai_auto_recharge('a0000000-0000-4000-8000-000000000001', 0, 3);
  raise exception 'FAIL: authenticated claimed an attempt';
exception when insufficient_privilege then
  raise notice 'ok: authenticated cannot claim';
end $$;
rollback;

select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.claim_ai_auto_recharge(uuid, integer, integer, integer, text)', 'execute'),
  'authenticated has no execute grant on claim');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.finish_ai_auto_recharge(uuid, text, text, text, integer, text, bigint, text, text)', 'execute'),
  'authenticated has no execute grant on finish');
select pg_temp.expect(
  not has_table_privilege('authenticated', 'public.ai_credit_auto_recharge_settings', 'update'),
  'authenticated cannot update settings directly');
select pg_temp.expect(
  not has_table_privilege('anon', 'public.ai_credit_auto_recharges', 'select'),
  'anon cannot read attempts');
SQL

echo "==> Done. Every assertion printed 'ok'."
