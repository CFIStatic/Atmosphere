#!/usr/bin/env bash
#
# Computer › saved sign-ins (20261004200000_computer_login_credentials):
# checked on a database with every migration applied, inside a rolled-back
# transaction:
#
#   - members (anon, authenticated) cannot read or write saved credentials
#   - only sealed values (v1.…) can be stored, never a bare password
#   - one credential per saved site; removing the site removes it
#   - status is ok / needs_attention
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  COMPUTER_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/10_computer_login_credentials.sh [psql-connection-args...]
#
set -euo pipefail

DB="${COMPUTER_TEST_DB:-atmosphere_migration_manifest}"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -d "$DB")

"${PSQL[@]}" >/dev/null <<'SQL'
\set QUIET on
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

create or replace function pg_temp.raises(sql text, want text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return sqlstate = want;
end $$;

insert into public.orgs (id, name, join_code) values
  ('c0000000-0000-4000-8000-0000000000e1', 'TEST Creds Org', 'TEST-C-10');
insert into public.computer_logins (id, org_id, label, url, host)
values ('c0000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e1', 'Portal', 'https://portal.example.test/', 'portal.example.test');

insert into public.computer_login_credentials (login_id, org_id, username_sealed, password_sealed, key_fingerprint)
values ('c0000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e1', 'v1.aa.bb.cc', 'v1.dd.ee.ff', 'abcdef012345');

select pg_temp.expect(
  pg_temp.raises($q$update public.computer_login_credentials set password_sealed = 'hunter2'$q$, '23514'),
  'a bare password cannot be stored');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_login_credentials (login_id, org_id, username_sealed, password_sealed, key_fingerprint)
    values ('c0000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e1', 'v1.a', 'v1.b', 'abcdef012345')$q$, '23505'),
  'one saved credential per site');
select pg_temp.expect(
  pg_temp.raises($q$update public.computer_login_credentials set status = 'broken'$q$, '23514'),
  'status is ok / needs_attention');
select pg_temp.expect(
  pg_temp.raises($q$update public.computer_login_credentials set login_url = 'javascript:alert(1)'$q$, '23514'),
  'login URL is http(s) only');

set local role authenticated;
select pg_temp.expect(pg_temp.raises('select * from public.computer_login_credentials', '42501'), 'authenticated cannot read saved credentials');
select pg_temp.expect(pg_temp.raises($q$delete from public.computer_login_credentials$q$, '42501'), 'authenticated cannot delete saved credentials');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.raises('select * from public.computer_login_credentials', '42501'), 'anon cannot read saved credentials');
reset role;

select pg_temp.expect(
  (select relrowsecurity from pg_class where relname = 'computer_login_credentials' and relnamespace = 'public'::regnamespace),
  'RLS is on for computer_login_credentials');

delete from public.computer_logins where id = 'c0000000-0000-4000-8000-0000000000e2';
select pg_temp.expect((select count(*) from public.computer_login_credentials where org_id = 'c0000000-0000-4000-8000-0000000000e1') = 0, 'removing the site removes its saved credential');

rollback;
SQL
echo "10_computer_login_credentials: all checks passed"
