#!/usr/bin/env bash
#
# What a signed-in user can do straight against PostgREST with their own
# access token (20261018230000_lock_down_direct_writes.sql and
# 20261018230100_pin_function_search_path.sql), on a database built from
# supabase/migrations, inside a rolled-back transaction. Every check that
# matters runs as the real `authenticated` role, so RLS and grants apply:
#
#   - nobody can add themselves to a workspace, or move / re-seat their row
#   - a member can still edit their own role / kind of work / usage intents
#   - join_org, preview_org_by_join_code and the billing + usage writers are
#     server-only; the *_as wrappers still enforce owner / member checks
#   - members cannot rewrite their workspace's limits, fees or quotas
#   - open_finance_share is gone; flagged functions carry a fixed search_path
#
# Usage:  supabase/tests/18_direct_write_lockdown.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${LOCKDOWN_TEST_DB:-direct_write_lockdown_test}"
PSQL=(psql "$@")

if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Direct-write lockdown test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED direct-write lockdown test: pgvector is not installed on this Postgres server."
  exit 0
fi

"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_supabase_bootstrap_stub.sql" >/dev/null
for f in "$HERE"/../migrations/*.sql; do
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1 || {
    echo "FAIL: $(basename "$f") did not apply" >&2
    "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | grep -v NOTICE | tail -5 >&2
    exit 1
  }
done

"${PSQL[@]}" -q -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET on
\o /dev/null
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- True when the statement fails with an error containing needle.
create or replace function pg_temp.raises(stmt text, needle text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  if position(needle in sqlerrm) = 0 then
    raise notice 'unexpected error for [%]: %', stmt, sqlerrm;
  end if;
  return position(needle in sqlerrm) > 0;
end $$;

-- Rows the statement touched (0 when RLS hides the target).
create or replace function pg_temp.touched(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function pg_temp.expect(boolean, text), pg_temp.raises(text, text), pg_temp.touched(text)
  to authenticated, anon, service_role;

-- Act as a signed-in user, as anon, as the server, or as the migration owner.
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_anon(), pg_temp.as_service()
  to authenticated, anon, service_role;

-- People: owner A (org A), owner B (org B, the outsider), employee E in org A.
insert into auth.users (id, email) values
  ('18000000-0000-4000-8000-00000000000a', 'owner18a@example.com'),
  ('18000000-0000-4000-8000-00000000000b', 'owner18b@example.com'),
  ('18000000-0000-4000-8000-00000000000e', 'employee18@example.com'),
  ('18000000-0000-4000-8000-00000000000f', 'invitee18@example.com');
insert into public.profiles (id, email) values
  ('18000000-0000-4000-8000-00000000000a', 'owner18a@example.com'),
  ('18000000-0000-4000-8000-00000000000b', 'owner18b@example.com'),
  ('18000000-0000-4000-8000-00000000000e', 'employee18@example.com'),
  ('18000000-0000-4000-8000-00000000000f', 'invitee18@example.com');
insert into public.orgs (id, name, join_code, created_by) values
  ('18000000-0000-4000-8000-0000000000a1', 'TEST Lockdown A', 'TESTLKA1', '18000000-0000-4000-8000-00000000000a'),
  ('18000000-0000-4000-8000-0000000000b1', 'TEST Lockdown B', 'TESTLKB1', '18000000-0000-4000-8000-00000000000b');
insert into public.billing_plans (code, name, monthly_price_cents, included_credits_nanos, per_seat, min_seats,
  rate_multiplier, features, is_contact_sales, is_active, sort_order)
values ('test18', 'Test 18', 0, 0, false, 1, 1, '{}'::jsonb, false, true, 99) on conflict do nothing;
insert into public.org_billing (org_id, plan_code, billing_interval, seats, status, period_start, period_end,
  cancel_at_period_end, auto_reload_enabled, auto_reload_threshold_nanos, auto_reload_amount_nanos,
  created_at, updated_at, extra_fc_seats, atmosphere_plan_code, included_fc_seats, stripe_subscription_id)
select o, 'test18', 'monthly', 1, 'active', now(), now() + interval '30 days',
  false, false, 0, 0, now(), now(), 0, 'work_verification', 3, 'comp_test18_' || right(o::text, 2)
from unnest(array['18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-0000000000b1']::uuid[]) o
on conflict (org_id) do nothing;
insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents) values
  ('18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-00000000000a', 'global_admin', 'mitigation', 'active', now(), '{}'),
  ('18000000-0000-4000-8000-0000000000b1', '18000000-0000-4000-8000-00000000000b', 'global_admin', 'mitigation', 'active', now(), '{}'),
  ('18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-00000000000e', 'employee', 'mitigation', 'active', now(), '{}');

------------------------------------------------------------------ membership
select pg_temp.as_user('18000000-0000-4000-8000-00000000000b');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents)
  values ('18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-00000000000b', 'employee', 'mitigation', 'active', now(), '{}')
$s$, 'permission denied'), 'an outsider cannot add themselves to another workspace');
select pg_temp.expect(pg_temp.raises($s$
  select public.join_org('TESTLKA1', 'employee', 'mitigation')
$s$, 'permission denied'), 'an outsider cannot call join_org with a user token');
select pg_temp.expect(pg_temp.raises($s$
  select * from public.preview_org_by_join_code('TESTLKA1')
$s$, 'permission denied'), 'preview_org_by_join_code is not callable with a user token');
select pg_temp.expect(pg_temp.touched($s$
  update public.org_members set work_type = 'construction' where user_id = '18000000-0000-4000-8000-00000000000e'
$s$) = 0, 'an outsider cannot touch another member''s row');

select pg_temp.as_user('18000000-0000-4000-8000-00000000000e');
select pg_temp.expect(pg_temp.raises($s$
  update public.org_members set org_id = '18000000-0000-4000-8000-0000000000b1' where user_id = '18000000-0000-4000-8000-00000000000e'
$s$, 'permission denied'), 'a member cannot move their row to another workspace');
select pg_temp.expect(pg_temp.raises($s$
  update public.org_members set seat_type = 'platform' where user_id = '18000000-0000-4000-8000-00000000000e'
$s$, 'permission denied'), 'a member cannot change their own seat type');
select pg_temp.expect(pg_temp.raises($s$
  update public.org_members set user_id = '18000000-0000-4000-8000-00000000000b' where user_id = '18000000-0000-4000-8000-00000000000e'
$s$, 'permission denied'), 'a member cannot hand their row to someone else');
select pg_temp.expect(pg_temp.raises($s$
  update public.org_members set status = 'active' where user_id = '18000000-0000-4000-8000-00000000000e'
$s$, 'permission denied'), 'a member cannot change their own status');
select pg_temp.expect(pg_temp.raises($s$
  delete from public.org_members where user_id = '18000000-0000-4000-8000-00000000000e'
$s$, 'permission denied'), 'a member cannot delete membership rows');
update public.org_members set role = 'global_admin' where user_id = '18000000-0000-4000-8000-00000000000e';
select pg_temp.expect((select role::text from public.org_members where user_id = '18000000-0000-4000-8000-00000000000e') <> 'global_admin',
  'a member still cannot promote themselves to Global Admin (the seat guard keeps their role)');
select pg_temp.expect(pg_temp.touched($s$
  update public.org_members set work_type = 'construction', usage_intents = '{exploring}', role = 'project_manager'
  where user_id = '18000000-0000-4000-8000-00000000000e'
$s$) = 1, 'a member can still edit their own account type, kind of work and usage intents');

select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents)
  values ('18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-00000000000b', 'employee', 'mitigation', 'active', now(), '{}')
$s$, 'permission denied'), 'anon cannot write org_members');

-------------------------------------------------------------- billing writers
select pg_temp.as_user('18000000-0000-4000-8000-00000000000a');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_plan('18000000-0000-4000-8000-0000000000a1', 'test18', 'monthly', 1)
$s$, 'permission denied'), 'even the owner cannot call set_billing_plan with a user token');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_settings('18000000-0000-4000-8000-0000000000a1', true)
$s$, 'permission denied'), 'set_billing_settings is server-only');
select pg_temp.expect(pg_temp.raises($s$
  select public.record_usage('18000000-0000-4000-8000-0000000000a1', 'm', 'r-18')
$s$, 'permission denied'), 'record_usage is server-only');
select pg_temp.expect(pg_temp.raises($s$
  select public.record_token_usage('18000000-0000-4000-8000-0000000000a1', 'r-18')
$s$, 'permission denied'), 'record_token_usage is server-only');
select pg_temp.expect(pg_temp.raises($s$
  select public.link_stripe_customer('18000000-0000-4000-8000-0000000000a1', 'cus_someone_else')
$s$, 'permission denied'), 'link_stripe_customer is server-only');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_settings_as('18000000-0000-4000-8000-00000000000a', '18000000-0000-4000-8000-0000000000a1', true)
$s$, 'permission denied'), 'the *_as wrappers are not callable with a user token');
select pg_temp.expect(pg_temp.raises($s$
  select public.join_org_as('18000000-0000-4000-8000-00000000000a', 'TESTLKB1', 'employee', 'mitigation')
$s$, 'permission denied'), 'join_org_as is not callable with a user token');

select pg_temp.as_service();
select pg_temp.expect((public.set_billing_settings_as('18000000-0000-4000-8000-00000000000a',
  '18000000-0000-4000-8000-0000000000a1', true)).auto_reload_enabled,
  'the server can change settings on the owner''s behalf');
select pg_temp.expect(auth.uid() is null and auth.role() = 'service_role',
  'the wrapper restores the server identity afterwards');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_settings_as('18000000-0000-4000-8000-00000000000e', '18000000-0000-4000-8000-0000000000a1', false)
$s$, 'billing_forbidden'), 'the wrapper still refuses a non-owner');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_plan_as('18000000-0000-4000-8000-00000000000b', '18000000-0000-4000-8000-0000000000a1', 'test18', 'monthly', 1)
$s$, 'billing_forbidden'), 'set_billing_plan_as refuses another workspace''s owner');
select pg_temp.expect(pg_temp.raises($s$
  select public.set_billing_settings_as(null, '18000000-0000-4000-8000-0000000000a1', true)
$s$, 'not authenticated'), 'the wrapper needs an actor');
select pg_temp.expect((public.join_org_as('18000000-0000-4000-8000-00000000000f', 'TESTLKB1', 'employee', 'mitigation')).id
  = '18000000-0000-4000-8000-0000000000b1', 'the server can join an invited user to a workspace');
select pg_temp.expect(exists (select 1 from public.org_members where user_id = '18000000-0000-4000-8000-00000000000f'
  and org_id = '18000000-0000-4000-8000-0000000000b1'), 'the joined membership belongs to the invited user');

---------------------------------------------------------- member-writable limits
select pg_temp.as_user('18000000-0000-4000-8000-00000000000e');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.verification_usage_limits (org_id, monthly_budget_usd) values ('18000000-0000-4000-8000-0000000000a1', 0)
$s$, 'permission denied'), 'a member cannot lift the verification AI budget');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.evidence_download_policy (org_id, download_fee_cents) values ('18000000-0000-4000-8000-0000000000a1', 0)
$s$, 'permission denied'), 'a member cannot zero the guest download fee');
select pg_temp.expect(pg_temp.raises($s$
  update public.job_evidence_policy set auto_purge = true where org_id = '18000000-0000-4000-8000-0000000000a1'
$s$, 'permission denied'), 'a member cannot set evidence auto-purge');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_media_quotas (org_id, max_total_bytes) values ('18000000-0000-4000-8000-0000000000a1', 1)
$s$, 'permission denied'), 'a member cannot rewrite media quotas directly');

--------------------------------------------------------------------- leftovers
reset role;
select pg_temp.expect(to_regprocedure('public.open_finance_share(text)') is null, 'open_finance_share is gone');
select pg_temp.expect(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname in ('private.is_field_capture_seat', 'private.platform_seats_used',
    'public.touch_updated_at', 'memory.touch_updated_at', 'public.classify_token_feature', 'private.legal_vault_guard')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
), 'advisor-flagged functions carry a fixed search_path');
select pg_temp.expect(private.is_field_capture_seat('employee', null, null, 'field_capture')
  and not private.is_field_capture_seat('employee', null, null, 'platform'), 'pinned functions behave the same');

rollback;
SQL
echo "==> Direct-write lockdown OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
