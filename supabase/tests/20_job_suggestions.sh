#!/usr/bin/env bash
#
# Suggested work (20261021190000_job_suggestions.sql), on a database built
# from supabase/migrations, inside a rolled-back transaction. Checks run as
# the real `authenticated` role, so RLS and grants apply:
#
#   - a workspace member reads their workspace's suggestions and event log
#   - another workspace (and anyone who is not a member, such as a homeowner
#     or sub on a job grant) reads none
#   - nobody writes them with a user token; the server (service role) can
#   - the same kind is never stored twice for one job state, and at most one
#     of a kind is open per job
#
# Fixture rows are synthetic TEST DATA (example.com). Nothing is committed.
#
# Usage:  supabase/tests/20_job_suggestions.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${JOB_SUGGESTIONS_TEST_DB:-job_suggestions_test}"
PSQL=(psql "$@")

if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Job suggestions test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED job suggestions test: pgvector is not installed on this Postgres server."
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

-- SQLSTATE of one statement run as a signed-in user ('00000' when it worked).
create or replace function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_state text := '00000';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create or replace function pg_temp.seen_by(p_user uuid, p_table text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  execute format('select count(*) from public.%I', p_table) into n;
  reset role;
  return n;
end $$;
grant execute on function pg_temp.as_user(uuid, text), pg_temp.seen_by(uuid, text), pg_temp.expect(boolean, text) to public;

insert into auth.users (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'office20@example.com'),
  ('20000000-0000-4000-8000-000000000002', 'outsider20@example.com'),
  ('20000000-0000-4000-8000-000000000003', 'homeowner20@example.com');
insert into public.profiles (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'office20@example.com'),
  ('20000000-0000-4000-8000-000000000002', 'outsider20@example.com'),
  ('20000000-0000-4000-8000-000000000003', 'homeowner20@example.com')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('20000000-0000-4000-8000-0000000000a1', 'TEST Org 20', 'TEST-A-20'),
  ('20000000-0000-4000-8000-0000000000b1', 'TEST Org 20 other', 'TEST-B-20');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'employee', 'mitigation'),
  ('20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-000000000002', 'employee', 'mitigation')
on conflict do nothing;
insert into public.crm_jobs (id, org_id, work_type, title) values
  ('20000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000a1', 'mitigation', 'TEST job 20');

-- The server writes (this session is the migration owner, standing in for service role).
insert into public.job_suggestions (id, org_id, job_id, kind, title, prompt, state_fingerprint) values
  ('20000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
   'build_estimate', 'Build the estimate in Xactimate', 'TEST prompt', 'fp-1');
insert into public.job_suggestion_events (org_id, job_id, suggestion_id, kind, action) values
  ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
   '20000000-0000-4000-8000-0000000000d1', 'build_estimate', 'created');

select pg_temp.expect(pg_temp.seen_by('20000000-0000-4000-8000-000000000001', 'job_suggestions') = 1, 'a member reads the suggestion');
select pg_temp.expect(pg_temp.seen_by('20000000-0000-4000-8000-000000000001', 'job_suggestion_events') = 1, 'a member reads the event log');
select pg_temp.expect(pg_temp.seen_by('20000000-0000-4000-8000-000000000002', 'job_suggestions') = 0, 'another org reads none');
select pg_temp.expect(pg_temp.seen_by('20000000-0000-4000-8000-000000000003', 'job_suggestions') = 0, 'a non-member (homeowner) reads none');
select pg_temp.expect(pg_temp.seen_by('20000000-0000-4000-8000-000000000003', 'job_suggestion_events') = 0, 'a non-member reads no events');

select pg_temp.expect(pg_temp.as_user('20000000-0000-4000-8000-000000000001', $q$
  insert into public.job_suggestions (org_id, job_id, kind, title, prompt, state_fingerprint)
  values ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1', 'crm_update', 'x', 'x', 'fp-2')$q$) = '42501',
  'a member cannot insert a suggestion with a user token');
select pg_temp.expect(pg_temp.as_user('20000000-0000-4000-8000-000000000001', $q$
  update public.job_suggestions set status = 'approved'$q$) = '42501',
  'a member cannot approve by writing the row directly');
select pg_temp.expect(pg_temp.as_user('20000000-0000-4000-8000-000000000001', $q$
  insert into public.job_suggestion_events (org_id, job_id, suggestion_id, kind, action)
  values ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
          '20000000-0000-4000-8000-0000000000d1', 'build_estimate', 'approved')$q$) = '42501',
  'a member cannot write the event log');
select pg_temp.expect(has_table_privilege('service_role', 'public.job_suggestions', 'INSERT')
  and has_table_privilege('service_role', 'public.job_suggestions', 'UPDATE')
  and has_table_privilege('service_role', 'public.job_suggestion_events', 'INSERT'),
  'the server can write suggestions and events');

-- Dedupe in the schema.
do $$ begin
  begin
    insert into public.job_suggestions (org_id, job_id, kind, title, prompt, state_fingerprint, status) values
      ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1', 'build_estimate', 'x', 'x', 'fp-1', 'dismissed');
    raise exception 'FAIL: same kind stored twice for one state';
  exception when unique_violation then null;
  end;
  begin
    insert into public.job_suggestions (org_id, job_id, kind, title, prompt, state_fingerprint) values
      ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1', 'build_estimate', 'x', 'x', 'fp-3');
    raise exception 'FAIL: two open suggestions of one kind';
  exception when unique_violation then null;
  end;
end $$;
select pg_temp.expect(true, 'one suggestion per kind per state, and one open per kind');

rollback;
SQL
echo "==> Job suggestions OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
