#!/usr/bin/env bash
#
# Platform-only seats (20261018200000_platform_seats.sql) and owner-only
# billing (20261018190000_billing_owner_only.sql), on a database built from
# supabase/migrations, inside a rolled-back transaction:
#
#   - a Platform seat is never a Field Capture seat, even with field_work intents
#   - Platform invites and members are capped by org_billing.platform_seats
#   - a lapsed workspace has no Platform seats
#   - a Platform member is a Global Admin, and cannot change their own seat type
#   - accepting a Platform invite makes a Platform member without a second seat
#   - Billing belongs to the owner only: a Platform seat and a free Global Admin
#     get can_manage_billing = false and billing_overview {can_manage:false}
#
# Usage:  supabase/tests/17_platform_seats.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${PLATFORM_SEATS_TEST_DB:-platform_seats_test}"
PSQL=(psql "$@")

if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Platform seat test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED platform seat test: pgvector is not installed on this Postgres server."
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

create or replace function pg_temp.raises(stmt text, needle text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return position(needle in sqlerrm) > 0;
end $$;


create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- People: owner (created the org), a free Global Admin, a Platform member to be.
insert into auth.users (id, email) values
  ('17000000-0000-4000-8000-000000000001', 'owner17@example.com'),
  ('17000000-0000-4000-8000-000000000002', 'admin17@example.com'),
  ('17000000-0000-4000-8000-000000000003', 'platform17@example.com'),
  ('17000000-0000-4000-8000-000000000004', 'platform17b@example.com');
insert into public.profiles (id, email) values
  ('17000000-0000-4000-8000-000000000001', 'owner17@example.com'),
  ('17000000-0000-4000-8000-000000000002', 'admin17@example.com'),
  ('17000000-0000-4000-8000-000000000003', 'platform17@example.com'),
  ('17000000-0000-4000-8000-000000000004', 'platform17b@example.com');
insert into public.orgs (id, name, join_code, created_by) values
  ('17000000-0000-4000-8000-0000000000a1', 'TEST Platform Seats', 'TEST-PS-17', '17000000-0000-4000-8000-000000000001');
insert into public.billing_plans (code, name, monthly_price_cents, included_credits_nanos, per_seat, min_seats,
  rate_multiplier, features, is_contact_sales, is_active, sort_order)
values ('test17', 'Test 17', 0, 0, false, 1, 1, '{}'::jsonb, false, true, 99) on conflict do nothing;
insert into public.org_billing (org_id, plan_code, billing_interval, seats, status, period_start, period_end,
  cancel_at_period_end, auto_reload_enabled, auto_reload_threshold_nanos, auto_reload_amount_nanos,
  created_at, updated_at, extra_fc_seats, atmosphere_plan_code, included_fc_seats, stripe_subscription_id)
values ('17000000-0000-4000-8000-0000000000a1', 'test17', 'monthly', 1, 'active', now(), now() + interval '30 days',
  false, false, 0, 0, now(), now(), 0, 'work_verification', 3, 'comp_test17')
on conflict (org_id) do update set status = 'active', platform_seats = 0, stripe_subscription_id = 'comp_test17';

select pg_temp.as_server();
-- One Global Admin per workspace (the owner): nobody else can be invited as one.
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_invites (org_id, email, role, status, created_at)
  values ('17000000-0000-4000-8000-0000000000a1', 'nope17@example.com', 'global_admin', 'pending', now())
$s$, 'global_admin_owner_only'), 'a Global Admin invite is refused');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_invites (org_id, email, role, status, created_at)
  values ('17000000-0000-4000-8000-0000000000a1', 'nope17b@example.com', 'office_manager', 'pending', now())
$s$, 'global_admin_owner_only'), 'a legacy office-manager (admin) invite is refused');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_invites (org_id, email, role, status, created_at)
  values ('17000000-0000-4000-8000-0000000000a1', 'nope17c@example.com', 'employee', 'pending', now());
  update public.org_invites set role = 'global_admin' where email = 'nope17c@example.com'
$s$, 'global_admin_owner_only'), 'an invite cannot be switched to Global Admin later');

-- Legacy data: an extra Global Admin from before the one-admin rule. Seed the
-- old invite without triggers so the member can join as one.
set local session_replication_role = replica;
insert into public.org_invites (org_id, email, role, status, created_at)
values ('17000000-0000-4000-8000-0000000000a1', 'admin17@example.com', 'global_admin', 'pending', now());
set local session_replication_role = origin;
insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents) values
  ('17000000-0000-4000-8000-0000000000a1', '17000000-0000-4000-8000-000000000001', 'global_admin', 'mitigation', 'active', now(), '{}'),
  ('17000000-0000-4000-8000-0000000000a1', '17000000-0000-4000-8000-000000000002', 'global_admin', 'mitigation', 'active', now(), '{}');

update public.org_invites set status = 'joined' where email = 'admin17@example.com';
select pg_temp.expect((select role::text from public.org_members where user_id = '17000000-0000-4000-8000-000000000002') = 'global_admin',
  'an existing (legacy) extra Global Admin is left as is');
select pg_temp.expect((select seat_type from public.org_members where user_id = '17000000-0000-4000-8000-000000000002') = 'field_capture',
  'existing members default to the field_capture seat type');
select pg_temp.expect(private.field_capture_seats_used('17000000-0000-4000-8000-0000000000a1') = 0, 'Global Admins use no Field Capture seat');
select pg_temp.expect(private.platform_seats_allowed('17000000-0000-4000-8000-0000000000a1') = 0, 'no Platform seats until some are added');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_invites (id, org_id, email, role, status, created_at, seat_type)
  values ('17000000-0000-4000-8000-0000000000b1', '17000000-0000-4000-8000-0000000000a1', 'platform17@example.com', 'employee', 'pending', now(), 'platform')
$s$, 'platform_seat_limit'), 'a Platform invite with no Platform seat left is refused');

update public.org_billing set platform_seats = 1 where org_id = '17000000-0000-4000-8000-0000000000a1';
insert into public.org_invites (id, org_id, email, role, status, created_at, seat_type)
values ('17000000-0000-4000-8000-0000000000b1', '17000000-0000-4000-8000-0000000000a1', 'platform17@example.com', 'employee', 'pending', now(), 'platform');
select pg_temp.expect((select role from public.org_invites where id = '17000000-0000-4000-8000-0000000000b1') = 'global_admin',
  'a Platform invite is always a Global Admin invite');
select pg_temp.expect(private.platform_seats_used('17000000-0000-4000-8000-0000000000a1') = 1, 'the pending invite holds the Platform seat');
select pg_temp.expect(private.field_capture_seats_used('17000000-0000-4000-8000-0000000000a1') = 0, 'a Platform invite is not a Field Capture seat');
select pg_temp.expect(pg_temp.raises($s$
  insert into public.org_invites (org_id, email, role, status, created_at, seat_type)
  values ('17000000-0000-4000-8000-0000000000a1', 'platform17b@example.com', 'global_admin', 'pending', now(), 'platform')
$s$, 'platform_seat_limit'), 'a second Platform invite past the seat count is refused');

-- The invited person accepts (join_org inserts as that user).
select pg_temp.as_user('17000000-0000-4000-8000-000000000003');
insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents)
values ('17000000-0000-4000-8000-0000000000a1', '17000000-0000-4000-8000-000000000003', 'global_admin', 'mitigation', 'active', now(), '{field_work,exploring}');
select pg_temp.as_server();
select pg_temp.expect((select seat_type = 'platform' and role = 'global_admin' from public.org_members
  where user_id = '17000000-0000-4000-8000-000000000003'), 'accepting a Platform invite makes a Platform Global Admin');
update public.org_invites set status = 'joined' where id = '17000000-0000-4000-8000-0000000000b1';
select pg_temp.expect(private.platform_seats_used('17000000-0000-4000-8000-0000000000a1') = 1, 'the member uses the one seat (not two)');
select pg_temp.expect(private.field_capture_seats_used('17000000-0000-4000-8000-0000000000a1') = 0,
  'a Platform member is never a Field Capture seat, even with field_work intents');
select pg_temp.expect(not private.is_field_capture_seat('employee', 'x@field.atmosphere.app', array['field_work'], 'platform'),
  'is_field_capture_seat is false for platform');
select pg_temp.expect(private.is_field_capture_seat('employee', null, null, 'field_capture'), 'an Employee is still a Field Capture seat');

-- The member cannot turn their own seat into a free Global Admin.
select pg_temp.as_user('17000000-0000-4000-8000-000000000003');
select pg_temp.expect(pg_temp.raises($s$
  update public.org_members set seat_type = 'field_capture' where user_id = '17000000-0000-4000-8000-000000000003'
$s$, 'seat_type_locked'), 'a member cannot change their own seat type');

-- Billing is the owner's alone.
select pg_temp.expect(not private.can_manage_billing('17000000-0000-4000-8000-0000000000a1'), 'a Platform seat cannot manage billing');
select pg_temp.expect(public.billing_overview('17000000-0000-4000-8000-0000000000a1') = '{"can_manage": false}'::jsonb,
  'billing_overview tells a Platform seat nothing');
select pg_temp.as_user('17000000-0000-4000-8000-000000000002');
select pg_temp.expect(not private.can_manage_billing('17000000-0000-4000-8000-0000000000a1'), 'a free Global Admin who is not the owner cannot manage billing');
select pg_temp.as_user('17000000-0000-4000-8000-000000000001');
select pg_temp.expect(private.can_manage_billing('17000000-0000-4000-8000-0000000000a1'), 'the owner manages billing');

-- A lapsed workspace has no Platform seats.
select pg_temp.as_server();
update public.org_billing set status = 'canceled' where org_id = '17000000-0000-4000-8000-0000000000a1';
select pg_temp.expect(private.platform_seats_allowed('17000000-0000-4000-8000-0000000000a1') = 0, 'a canceled workspace has no Platform seats');

rollback;
SQL
echo "==> Platform seats OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
