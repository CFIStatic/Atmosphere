#!/usr/bin/env bash
#
# Homeowner permissions (20261022150000_job_homeowner_permissions.sql), on a
# database built from supabase/migrations, inside a rolled-back transaction.
# Checks run as the real `authenticated` role, so RLS and grants apply:
#
#   - a workspace member reads their jobs' permission rows; another
#     workspace and the homeowner read none
#   - nobody writes them with a user token; the server (service role) can
#   - with no row (the default), the invited homeowner still reads the job's
#     clip rows directly, exactly as before
#   - once the contractor turns off videos, transcripts or AI summaries, the
#     homeowner's direct clip reads return nothing for that job only
#
# Fixture rows are synthetic TEST DATA (example.com). Nothing is committed.
#
# Usage:  supabase/tests/21_homeowner_permissions.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${HOMEOWNER_PERMS_TEST_DB:-homeowner_perms_test}"
PSQL=(psql "$@")
if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Homeowner permissions test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED homeowner permissions test: pgvector is not installed on this Postgres server."
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
grant select on public.crm_jobs, public.job_proofs to authenticated;

insert into auth.users (id, email) values
  ('21000000-0000-4000-8000-000000000001', 'office21@example.com'),
  ('21000000-0000-4000-8000-000000000002', 'outsider21@example.com'),
  ('21000000-0000-4000-8000-000000000003', 'homeowner21@example.com');
insert into public.profiles (id, email) values
  ('21000000-0000-4000-8000-000000000001', 'office21@example.com'),
  ('21000000-0000-4000-8000-000000000002', 'outsider21@example.com'),
  ('21000000-0000-4000-8000-000000000003', 'homeowner21@example.com')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('21000000-0000-4000-8000-0000000000a1', 'TEST Org 21', 'TEST-A-21'),
  ('21000000-0000-4000-8000-0000000000b1', 'TEST Org 21 other', 'TEST-B-21');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-000000000001', 'employee', 'mitigation'),
  ('21000000-0000-4000-8000-0000000000b1', '21000000-0000-4000-8000-000000000002', 'employee', 'mitigation')
on conflict do nothing;
insert into public.crm_jobs (id, org_id, work_type, title) values
  ('21000000-0000-4000-8000-0000000000c1', '21000000-0000-4000-8000-0000000000a1', 'mitigation', 'TEST job 21 locked'),
  ('21000000-0000-4000-8000-0000000000c2', '21000000-0000-4000-8000-0000000000a1', 'mitigation', 'TEST job 21 default');
insert into public.verifier_shares (id, org_id, job_id, label, share_kind, recipient_email) values
  ('21000000-0000-4000-8000-0000000000e1', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c1', 'Homeowner', 'progress', 'homeowner21@example.com'),
  ('21000000-0000-4000-8000-0000000000e2', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c2', 'Homeowner', 'progress', 'homeowner21@example.com');
insert into public.job_progress_grants (org_id, job_id, user_id, share_id, recipient_email) values
  ('21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c1', '21000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-0000000000e1', 'homeowner21@example.com'),
  ('21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c2', '21000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-0000000000e2', 'homeowner21@example.com');
insert into public.job_parties (id, org_id, job_id, company, role) values
  ('21000000-0000-4000-8000-0000000000f1', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c1', 'Crew', 'subcontractor'),
  ('21000000-0000-4000-8000-0000000000f2', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c2', 'Crew', 'subcontractor');
insert into public.job_proofs (id, org_id, job_id, party_id, work_date, phase, storage_path) values
  ('21000000-0000-4000-8000-0000000000d1', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c1', '21000000-0000-4000-8000-0000000000f1', '2026-10-01', 'before', 'o/j/a21.mp4'),
  ('21000000-0000-4000-8000-0000000000d2', '21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-0000000000c2', '21000000-0000-4000-8000-0000000000f2', '2026-10-01', 'before', 'o/j/b21.mp4');

-- Default: no permission rows, the homeowner reads both jobs' clips as today.
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000003', 'job_proofs') = 2,
  'with no settings row the homeowner reads clip rows as before');

-- The server (migration owner standing in for service role) saves settings on job c1.
insert into public.job_homeowner_permissions (job_id, org_id, see_transcripts, updated_by) values
  ('21000000-0000-4000-8000-0000000000c1', '21000000-0000-4000-8000-0000000000a1', false, '21000000-0000-4000-8000-000000000001');

select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000001', 'job_homeowner_permissions') = 1, 'a member reads the job''s permissions');
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000002', 'job_homeowner_permissions') = 0, 'another org reads none');
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000003', 'job_homeowner_permissions') = 0, 'the homeowner reads none directly');
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000003', 'job_proofs') = 1,
  'transcripts off: the homeowner no longer reads that job''s clip rows directly; the other job is unchanged');

update public.job_homeowner_permissions set see_transcripts = true, see_videos = false
  where job_id = '21000000-0000-4000-8000-0000000000c1';
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000003', 'job_proofs') = 1, 'videos off: same');
update public.job_homeowner_permissions set see_videos = true, use_chat = false
  where job_id = '21000000-0000-4000-8000-0000000000c1';
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000003', 'job_proofs') = 2,
  'only Chat off: clip rows readable again');
select pg_temp.expect(pg_temp.seen_by('21000000-0000-4000-8000-000000000001', 'job_proofs') = 2,
  'the office always reads its clips');

select pg_temp.expect(pg_temp.as_user('21000000-0000-4000-8000-000000000001', $q$
  update public.job_homeowner_permissions set use_chat = true$q$) = '42501',
  'a member cannot write permissions with a user token');
select pg_temp.expect(pg_temp.as_user('21000000-0000-4000-8000-000000000003', $q$
  insert into public.job_homeowner_permissions (job_id, org_id)
  values ('21000000-0000-4000-8000-0000000000c2', '21000000-0000-4000-8000-0000000000a1')$q$) = '42501',
  'the homeowner cannot write permissions');
select pg_temp.expect(has_table_privilege('service_role', 'public.job_homeowner_permissions', 'INSERT')
  and has_table_privilege('service_role', 'public.job_homeowner_permissions', 'UPDATE'),
  'the server can write permissions');

rollback;
SQL
echo "==> Homeowner permissions OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
