#!/usr/bin/env bash
#
# 20261023150000_permission_roles_everyone_both_products.sql backfills
# org_members.permission_role on production. This builds the schema up to the
# migration before it, seeds today's shapes of member, applies the migration,
# and checks nobody's effective access changed:
#   owner -> owner; global_admin (free or Platform seat) -> admin; employee -> member
#   role, seat_type and seat counts unchanged; pending invites untouched.
#
# Usage:  supabase/tests/22_permission_roles_backfill.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${PERMISSION_BACKFILL_TEST_DB:-permission_backfill_test}"
TARGET="20261023150000_permission_roles_everyone_both_products.sql"
PSQL=(psql "$@")

if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Permission backfill test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED permission backfill test: pgvector is not installed on this Postgres server."
  exit 0
fi

"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_supabase_bootstrap_stub.sql" >/dev/null
for f in "$HERE"/../migrations/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1 || {
    echo "FAIL: $(basename "$f") did not apply" >&2; exit 1; }
done

# Today's data, written without triggers (as it already exists in production).
"${PSQL[@]}" -q -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
set session_replication_role = replica;
insert into auth.users (id, email) values
  ('22000000-0000-4000-8000-000000000001', 'owner22@example.com'),
  ('22000000-0000-4000-8000-000000000002', 'platform22@example.com'),
  ('22000000-0000-4000-8000-000000000003', 'crew22@example.com'),
  ('22000000-0000-4000-8000-000000000004', 'extra22@example.com');
insert into public.profiles (id, email) select id, email from auth.users where email like '%22@example.com';
insert into public.orgs (id, name, join_code, created_by) values
  ('22000000-0000-4000-8000-0000000000a1', 'TEST Backfill', 'TEST-BF-22', '22000000-0000-4000-8000-000000000001');
insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents, seat_type) values
  ('22000000-0000-4000-8000-0000000000a1', '22000000-0000-4000-8000-000000000001', 'global_admin', 'mitigation', 'active', now(), '{}', 'field_capture'),
  ('22000000-0000-4000-8000-0000000000a1', '22000000-0000-4000-8000-000000000002', 'global_admin', 'mitigation', 'active', now(), '{}', 'platform'),
  ('22000000-0000-4000-8000-0000000000a1', '22000000-0000-4000-8000-000000000003', 'employee', 'mitigation', 'active', now(), '{}', 'field_capture'),
  ('22000000-0000-4000-8000-0000000000a1', '22000000-0000-4000-8000-000000000004', 'global_admin', 'mitigation', 'active', now(), '{}', 'field_capture');
insert into public.org_invites (org_id, email, role, status, created_at, seat_type) values
  ('22000000-0000-4000-8000-0000000000a1', 'pendingfc22@example.com', 'employee', 'pending', now(), 'field_capture'),
  ('22000000-0000-4000-8000-0000000000a1', 'pendingpl22@example.com', 'global_admin', 'pending', now(), 'platform');
create table public._before22 as
  select user_id, role::text as role, seat_type,
         private.field_capture_seats_used(org_id) as fc, private.platform_seats_used(org_id) as pl
  from public.org_members where org_id = '22000000-0000-4000-8000-0000000000a1';
SQL

"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/../migrations/$TARGET" >/dev/null
# Re-running is safe.
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/../migrations/$TARGET" >/dev/null

"${PSQL[@]}" -q -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET on
\o /dev/null
create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;
create or replace function pg_temp.pr(p uuid) returns text language sql as $$
  select permission_role from public.org_members where user_id = p $$;
select pg_temp.expect(pg_temp.pr('22000000-0000-4000-8000-000000000001') = 'owner', 'the creator becomes owner');
select pg_temp.expect(pg_temp.pr('22000000-0000-4000-8000-000000000002') = 'admin', 'a Platform seat (global_admin) becomes admin: no lost access');
select pg_temp.expect(pg_temp.pr('22000000-0000-4000-8000-000000000003') = 'member', 'an employee becomes member');
select pg_temp.expect(pg_temp.pr('22000000-0000-4000-8000-000000000004') = 'admin', 'a legacy extra Global Admin becomes admin');
select pg_temp.expect(not exists (
  select 1 from public.org_members m join public._before22 b using (user_id)
  where m.role::text <> b.role), 'database role is unchanged (no one gains or loses admin)');
select pg_temp.expect(not exists (select 1 from public.org_members where seat_type <> 'field_capture'),
  'every member now has both products (Platform-only members gain Field Capture)');
select pg_temp.expect(not exists (
  select 1 from public.org_members m join public._before22 b using (user_id)
  where b.seat_type = 'field_capture' and m.seat_type <> b.seat_type), 'Field Capture + Platform members are untouched');
select pg_temp.expect((select bool_and(private.field_capture_seats_used('22000000-0000-4000-8000-0000000000a1') = fc) from public._before22),
  'the Field Capture seat count is unchanged (ex-Platform admins only count once they film)');
select pg_temp.expect(private.platform_seats_used('22000000-0000-4000-8000-0000000000a1') = 1,
  'only the pending legacy Platform invite still holds a Platform seat until it is accepted');
select pg_temp.expect((select count(*) from public.org_invites where org_id = '22000000-0000-4000-8000-0000000000a1'
  and permission_role = 'member' and status = 'pending') = 2, 'pending invites get the default member role, nothing else changes');
select pg_temp.expect((select role::text from public.org_invites where email = 'pendingpl22@example.com') = 'global_admin',
  'pending invite rows are not rewritten');
SQL
echo "==> Permission role backfill OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
