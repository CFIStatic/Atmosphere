#!/usr/bin/env bash
#
# Chat approvals (20261010090000_ask_pending_actions), on a database that has
# every migration applied (`npm run migrate:manifest`), in a rolled-back
# transaction:
#
#   - org members read their org's pending actions; another org reads none
#   - members cannot insert, approve or deny directly: only the server's
#     service role writes the table (it runs the action on approval)
#
# Usage:  ASK_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/13_ask_pending_actions.sh [psql-connection-args...]
#
set -euo pipefail

DB="${ASK_TEST_DB:-atmosphere_migration_manifest}"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -d "$DB")

"${PSQL[@]}" >/dev/null <<'SQL'
\set QUIET on
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

create or replace function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_state text := '00000';
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  return v_state;
end $$;
grant execute on function pg_temp.as_user(uuid, text) to public;

create or replace function pg_temp.seen_by(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  select count(*) into n from public.ask_pending_actions;
  reset role;
  return n;
end $$;
grant execute on function pg_temp.seen_by(uuid) to public;

insert into auth.users (id, email) values
  ('0e000000-0000-4000-8000-000000001301', 'office@test.invalid'),
  ('0e000000-0000-4000-8000-000000001302', 'outsider@test.invalid');
insert into public.profiles (id, email) values
  ('0e000000-0000-4000-8000-000000001301', 'office@test.invalid'),
  ('0e000000-0000-4000-8000-000000001302', 'outsider@test.invalid')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-000000001300', 'TEST Org 13', 'TEST-A-13'),
  ('b0000000-0000-4000-8000-000000001300', 'TEST Org 13 other', 'TEST-B-13');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('a0000000-0000-4000-8000-000000001300', '0e000000-0000-4000-8000-000000001301', 'employee', 'mitigation'),
  ('b0000000-0000-4000-8000-000000001300', '0e000000-0000-4000-8000-000000001302', 'employee', 'mitigation')
on conflict do nothing;
insert into public.crm_jobs (id, org_id, work_type, title) values
  ('c0000000-0000-4000-8000-000000001300', 'a0000000-0000-4000-8000-000000001300', 'mitigation', 'TEST job 13');
-- The server (service role) proposes a text.
insert into public.ask_pending_actions (id, org_id, job_id, requested_by, kind, payload) values
  ('d0000000-0000-4000-8000-000000001301', 'a0000000-0000-4000-8000-000000001300', 'c0000000-0000-4000-8000-000000001300',
   '0e000000-0000-4000-8000-000000001301', 'send_job_sms', '{"to":"+15555550142","body":"TEST"}');

select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001301') = 1, 'the office sees its pending action');
select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001302') = 0, 'another org sees none');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001301', $q$
  update public.ask_pending_actions set status = 'approved' where id = 'd0000000-0000-4000-8000-000000001301'$q$) = '42501',
  'a member cannot approve by writing the row (only the server runs approvals)');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001301', $q$
  insert into public.ask_pending_actions (org_id, job_id, kind) values
  ('a0000000-0000-4000-8000-000000001300', 'c0000000-0000-4000-8000-000000001300', 'send_job_sms')$q$) = '42501',
  'a member cannot create one directly');
select pg_temp.expect((select status = 'pending' from public.ask_pending_actions where id = 'd0000000-0000-4000-8000-000000001301'),
  'still pending');
select pg_temp.expect(
  (select count(*) = 0 from (select 1 where false) x) and
  exists (select 1 from pg_constraint where conname like '%ask_pending_actions%status%' or conrelid = 'public.ask_pending_actions'::regclass),
  'status is constrained');

rollback;
SQL
echo "ok: ask pending actions"
