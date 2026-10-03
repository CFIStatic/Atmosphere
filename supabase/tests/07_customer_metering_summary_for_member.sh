#!/usr/bin/env bash
#
# Settings › Billing usage summary (20261003190200).
#
# customer_metering_summary is service-role only in production, so the backend
# reads the summary with the service role through
# customer_metering_summary_for_member(p_org, p_user). This checks, inside a
# transaction that is rolled back, on a database with every migration applied:
#
#   - the service role gets the summary for a member of the org
#   - a non-member (or a null user) is refused with 42501
#   - authenticated and anon cannot execute it, and still cannot execute
#     customer_metering_summary / calculate_metering_period (grants unchanged)
#   - the private calculators are not executable by authenticated
#   - customer_metering_summary under a member JWT returns the same summary
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  METERING_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/07_customer_metering_summary_for_member.sh [psql-connection-args...]
#
set -euo pipefail

DB="${METERING_TEST_DB:-atmosphere_migration_manifest}"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -d "$DB")

"${PSQL[@]}" >/dev/null <<'SQL'
\set QUIET on
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Returns the SQLSTATE a statement raised as `role`, or 'ok'.
create or replace function pg_temp.sqlstate_as(p_role text, p_claims jsonb, p_sql text) returns text
language plpgsql as $$
declare v_state text := 'ok';
begin
  begin
    -- Hosted Supabase reads request.jwt.claims; the local stub reads request.jwt.claim.sub.
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(p_claims->>'sub', ''), true);
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  return v_state;
end $$;
grant execute on function pg_temp.sqlstate_as(text, jsonb, text) to public;

insert into auth.users (id, email) values
  ('0e000000-0000-4000-8000-000000000071', 'member@test.invalid'),
  ('0e000000-0000-4000-8000-000000000072', 'outsider@test.invalid');
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-0000000000a7', 'TEST Org 07', 'TEST-A-07'),
  ('b0000000-0000-4000-8000-0000000000b7', 'TEST Org 07 other', 'TEST-B-07');
insert into public.org_members (org_id, user_id, role, work_type)
values ('a0000000-0000-4000-8000-0000000000a7', '0e000000-0000-4000-8000-000000000071', 'global_admin', 'mitigation')
on conflict do nothing;
insert into public.org_members (org_id, user_id, role, work_type)
values ('b0000000-0000-4000-8000-0000000000b7', '0e000000-0000-4000-8000-000000000072', 'global_admin', 'mitigation')
on conflict do nothing;
insert into public.org_metering (org_id, plan_version_id)
select 'a0000000-0000-4000-8000-0000000000a7', v.id
from public.metering_plan_versions v order by v.created_at limit 1
on conflict (org_id) do nothing;

-- Service role, member: summary returned.
set local role service_role;
create temp table s as
  select public.customer_metering_summary_for_member(
    'a0000000-0000-4000-8000-0000000000a7', '0e000000-0000-4000-8000-000000000071') as j;
reset role;
select pg_temp.expect((select j ? 'estimatedUpcomingBillCents' and j ? 'periodStart' and j->>'planName' is not null from s),
  'service role reads the summary for a member');
select pg_temp.expect((select not (j ? 'estimatedAiCostCents') and not (j ? 'estimatedGrossMarginPct') from s),
  'summary carries no cost or margin fields');

-- Service role, not a member / null user: refused.
select pg_temp.expect(pg_temp.sqlstate_as('service_role', null,
  $q$select public.customer_metering_summary_for_member('a0000000-0000-4000-8000-0000000000a7', '0e000000-0000-4000-8000-000000000072')$q$) = '42501',
  'non-member refused with 42501');
select pg_temp.expect(pg_temp.sqlstate_as('service_role', null,
  $q$select public.customer_metering_summary_for_member('a0000000-0000-4000-8000-0000000000a7', null)$q$) = '42501',
  'null user refused with 42501');

-- authenticated / anon cannot execute any of these.
select pg_temp.expect(pg_temp.sqlstate_as('authenticated', '{"sub":"0e000000-0000-4000-8000-000000000071","role":"authenticated"}',
  $q$select public.customer_metering_summary_for_member('a0000000-0000-4000-8000-0000000000a7', '0e000000-0000-4000-8000-000000000071')$q$) = '42501',
  'authenticated cannot execute customer_metering_summary_for_member');
select pg_temp.expect(pg_temp.sqlstate_as('anon', null,
  $q$select public.customer_metering_summary_for_member('a0000000-0000-4000-8000-0000000000a7', '0e000000-0000-4000-8000-000000000071')$q$) = '42501',
  'anon cannot execute customer_metering_summary_for_member');
select pg_temp.expect(pg_temp.sqlstate_as('authenticated', '{"sub":"0e000000-0000-4000-8000-000000000071","role":"authenticated"}',
  $q$select public.customer_metering_summary('a0000000-0000-4000-8000-0000000000a7')$q$) = '42501',
  'customer_metering_summary stays service-role only');
select pg_temp.expect(pg_temp.sqlstate_as('authenticated', '{"sub":"0e000000-0000-4000-8000-000000000071","role":"authenticated"}',
  $q$select public.calculate_metering_period('a0000000-0000-4000-8000-0000000000a7', null)$q$) = '42501',
  'calculate_metering_period stays service-role only');
select pg_temp.expect(not has_function_privilege('authenticated', 'private.calculate_metering_period_unchecked(uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'private.customer_metering_summary_unchecked(uuid)', 'execute'),
  'private calculators not executable by authenticated');

-- The existing entry point still checks auth.uid() membership and agrees.
select set_config('request.jwt.claims', '{"sub":"0e000000-0000-4000-8000-000000000071"}', true),
       set_config('request.jwt.claim.sub', '0e000000-0000-4000-8000-000000000071', true);
select pg_temp.expect(
  public.customer_metering_summary('a0000000-0000-4000-8000-0000000000a7') = (select j from s),
  'customer_metering_summary (member JWT) = customer_metering_summary_for_member');
select pg_temp.expect(pg_temp.sqlstate_as('postgres', '{"sub":"0e000000-0000-4000-8000-000000000072"}',
  $q$select public.customer_metering_summary('a0000000-0000-4000-8000-0000000000a7')$q$) = '42501',
  'customer_metering_summary still refuses a non-member JWT');

rollback;
SQL

echo "07_customer_metering_summary_for_member: ok"
