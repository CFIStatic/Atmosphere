#!/usr/bin/env bash
#
# Video evidence is write-once for a user token
# (20261019150000_video_records_server_only.sql), on a database built from
# supabase/migrations, inside a rolled-back transaction. Every check runs as
# the real `authenticated` role, so RLS and grants apply:
#
#   - a member cannot overwrite a video file in their workspace's folder, but
#     can still create a new one there (iPhone offline fallback)
#   - a member cannot update job_proofs, video_clips or verification_videos
#     rows (hide, repoint, clear a hold, rewrite transcripts); inserts stay
#   - the server (service role) can still update them
#
# Usage:  supabase/tests/19_video_write_once.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${VIDEO_WRITE_ONCE_TEST_DB:-video_write_once_test}"
PSQL=(psql "$@")

if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Video write-once test cannot run: pgvector is not installed."
    exit 1
  fi
  echo "::warning::SKIPPED video write-once test: pgvector is not installed on this Postgres server."
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

-- Supabase grants the API roles table rights on storage.objects; RLS decides.
grant select, insert, update, delete on storage.objects to authenticated;
insert into storage.buckets (id, name) values ('job-proofs', 'job-proofs') on conflict do nothing;

-- Owner A and employee E in org A.
insert into auth.users (id, email) values
  ('19000000-0000-4000-8000-00000000000a', 'owner19a@example.com'),
  ('19000000-0000-4000-8000-00000000000e', 'employee19@example.com');
insert into public.profiles (id, email) values
  ('19000000-0000-4000-8000-00000000000a', 'owner19a@example.com'),
  ('19000000-0000-4000-8000-00000000000e', 'employee19@example.com');
insert into public.orgs (id, name, join_code, created_by) values
  ('19000000-0000-4000-8000-0000000000a1', 'TEST Write once A', 'TESTWOA1', '19000000-0000-4000-8000-00000000000a');
insert into public.billing_plans (code, name, monthly_price_cents, included_credits_nanos, per_seat, min_seats,
  rate_multiplier, features, is_contact_sales, is_active, sort_order)
values ('test19', 'Test 19', 0, 0, false, 1, 1, '{}'::jsonb, false, true, 99) on conflict do nothing;
insert into public.org_billing (org_id, plan_code, billing_interval, seats, status, period_start, period_end,
  cancel_at_period_end, auto_reload_enabled, auto_reload_threshold_nanos, auto_reload_amount_nanos,
  created_at, updated_at, extra_fc_seats, atmosphere_plan_code, included_fc_seats, stripe_subscription_id)
values ('19000000-0000-4000-8000-0000000000a1', 'test19', 'monthly', 1, 'active', now(), now() + interval '30 days',
  false, false, 0, 0, now(), now(), 0, 'work_verification', 3, 'comp_test19_a1')
on conflict (org_id) do nothing;
insert into public.org_members (org_id, user_id, role, work_type, status, created_at, usage_intents) values
  ('19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-00000000000a', 'global_admin', 'mitigation', 'active', now(), '{}'),
  ('19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-00000000000e', 'employee', 'mitigation', 'active', now(), '{}');
insert into storage.objects (bucket_id, name) values
  ('job-proofs', '19000000-0000-4000-8000-0000000000a1/job/party/2026-10-19-after-clip.mp4');

------------------------------------------------------------------- video files
select pg_temp.as_user('19000000-0000-4000-8000-00000000000e');
select pg_temp.expect(pg_temp.touched($s$
  update storage.objects set metadata = '{"replaced": true}'::jsonb
  where bucket_id = 'job-proofs' and name = '19000000-0000-4000-8000-0000000000a1/job/party/2026-10-19-after-clip.mp4'
$s$) = 0, 'a member cannot overwrite a video file in their workspace');
select pg_temp.expect(pg_temp.touched($s$
  delete from storage.objects where bucket_id = 'job-proofs'
$s$) = 0, 'a member cannot delete video files');
select pg_temp.expect(pg_temp.touched($s$
  insert into storage.objects (bucket_id, name)
  values ('job-proofs', '19000000-0000-4000-8000-0000000000a1/job/party/2026-10-19-after-new.mp4')
$s$) = 1, 'a member can still create a new video file in their workspace');

----------------------------------------------------------------- video records
select pg_temp.expect(pg_temp.raises($s$
  update public.job_proofs set deleted_at = now() where org_id = '19000000-0000-4000-8000-0000000000a1'
$s$, 'permission denied'), 'a member cannot hide a clip directly');
select pg_temp.expect(pg_temp.raises($s$
  update public.job_proofs set storage_path = 'elsewhere.mp4', legal_hold = false
$s$, 'permission denied'), 'a member cannot repoint a clip or clear a legal hold');
select pg_temp.expect(pg_temp.raises($s$
  update public.job_proofs set transcript_text = '', ai_summary = null
$s$, 'permission denied'), 'a member cannot rewrite a transcript or AI summary');
select pg_temp.expect(pg_temp.raises($s$
  update public.video_clips set org_id = org_id
$s$, 'permission denied'), 'a member cannot update video_clips');
select pg_temp.expect(pg_temp.raises($s$
  update public.verification_videos set org_id = org_id
$s$, 'permission denied'), 'a member cannot update verification_videos');
select pg_temp.expect(pg_temp.raises($s$
  delete from public.job_proofs
$s$, 'permission denied'), 'a member cannot delete clip rows');

reset role;
select pg_temp.expect(has_table_privilege('authenticated', 'public.job_proofs', 'INSERT'),
  'members can still file a new clip row (iPhone offline fallback)');
select pg_temp.expect(has_table_privilege('service_role', 'public.job_proofs', 'UPDATE')
  and has_table_privilege('service_role', 'public.video_clips', 'UPDATE')
  and has_table_privilege('service_role', 'public.verification_videos', 'UPDATE'),
  'the server can still update video records');

rollback;
SQL
echo "==> Video write-once OK"
[ "${KEEP_DB:-0}" = 1 ] || "${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
