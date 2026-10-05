#!/usr/bin/env bash
#
# Computer › Logins (20261004180000_computer_logins): checked on a database
# with every migration applied, inside a rolled-back transaction:
#
#   - members (anon, authenticated) cannot read or write computer_logins
#   - one entry per site (host) per org, case-insensitive
#   - only http(s) URLs
#   - a sign-in session counts toward the one-live-session-per-org rule
#   - deleting the org removes its saved sites
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  COMPUTER_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/09_computer_logins.sh [psql-connection-args...]
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
  ('c0000000-0000-4000-8000-0000000000d1', 'TEST Logins Org', 'TEST-L-09');

insert into public.computer_logins (org_id, label, url, host, cookie_domains)
values ('c0000000-0000-4000-8000-0000000000d1', 'Outlook', 'https://outlook.office.com/', 'outlook.office.com', '{.login.microsoftonline.com}');

select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_logins (org_id, label, url, host)
    values ('c0000000-0000-4000-8000-0000000000d1', 'Outlook again', 'https://OUTLOOK.office.com/', 'OUTLOOK.office.com')$q$, '23505'),
  'one entry per host per org');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_logins (org_id, label, url, host)
    values ('c0000000-0000-4000-8000-0000000000d1', 'Bad', 'javascript:alert(1)', 'x')$q$, '23514'),
  'only http(s) URLs');

insert into public.computer_sessions (org_id, provider, status, purpose, target_url, target_label)
values ('c0000000-0000-4000-8000-0000000000d1', 'mock', 'active', 'login', 'https://gmail.com/', 'Gmail');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_sessions (org_id, provider, status, purpose)
    values ('c0000000-0000-4000-8000-0000000000d1', 'mock', 'starting', 'task')$q$, '23505'),
  'a live sign-in session blocks a second live session');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_sessions (org_id, provider, status, purpose)
    values ('c0000000-0000-4000-8000-0000000000d1', 'mock', 'ended', 'other')$q$, '23514'),
  'purpose is task / login / logout');

set local role authenticated;
select pg_temp.expect(pg_temp.raises('select * from public.computer_logins', '42501'), 'authenticated cannot read computer_logins');
select pg_temp.expect(pg_temp.raises($q$insert into public.computer_logins (org_id, label, url, host) values ('c0000000-0000-4000-8000-0000000000d1','x','https://x.test','x.test')$q$, '42501'), 'authenticated cannot write computer_logins');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.raises('select * from public.computer_logins', '42501'), 'anon cannot read computer_logins');
reset role;

select pg_temp.expect(
  (select relrowsecurity from pg_class where relname = 'computer_logins' and relnamespace = 'public'::regnamespace),
  'RLS is on for computer_logins');

delete from public.orgs where id = 'c0000000-0000-4000-8000-0000000000d1';
select pg_temp.expect((select count(*) from public.computer_logins where org_id = 'c0000000-0000-4000-8000-0000000000d1') = 0, 'org delete removes its saved sites');

rollback;
SQL
echo "09_computer_logins: all checks passed"
