#!/usr/bin/env bash
#
# Chat feedback, pinned answers and edited questions: what
# 20261009120000_ask_feedback_pins_edits promises, checked on a database that
# already has every migration applied (the one `npm run migrate:manifest`
# builds), inside a transaction that is rolled back:
#
#   - a member rates an answer once (a second rating replaces it), only as
#     themselves, and never in another org
#   - another org cannot read a rating or a pin
#   - a pin is visible to every member of the org, once per answer
#   - an edited question is a new row pointing at the old one; the old row
#     still cannot be deleted (questions stay append-only)
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  ASK_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/12_ask_feedback_pins_edits.sh [psql-connection-args...]
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

-- Run one statement as a signed-in user; return its SQLSTATE ('00000' when it worked).
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

-- Count rows a signed-in user can see.
create or replace function pg_temp.seen_by(p_user uuid, p_table text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  execute format('select count(*) from public.%I', p_table) into n;
  reset role;
  return n;
end $$;
grant execute on function pg_temp.seen_by(uuid, text) to public;

insert into auth.users (id, email) values
  ('0e000000-0000-4000-8000-000000001201', 'asker@test.invalid'),
  ('0e000000-0000-4000-8000-000000001202', 'teammate@test.invalid'),
  ('0e000000-0000-4000-8000-000000001203', 'outsider@test.invalid');
insert into public.profiles (id, email) values
  ('0e000000-0000-4000-8000-000000001201', 'asker@test.invalid'),
  ('0e000000-0000-4000-8000-000000001202', 'teammate@test.invalid'),
  ('0e000000-0000-4000-8000-000000001203', 'outsider@test.invalid')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-000000001200', 'TEST Org 12', 'TEST-A-12'),
  ('b0000000-0000-4000-8000-000000001200', 'TEST Org 12 other', 'TEST-B-12');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('a0000000-0000-4000-8000-000000001200', '0e000000-0000-4000-8000-000000001201', 'employee', 'mitigation'),
  ('a0000000-0000-4000-8000-000000001200', '0e000000-0000-4000-8000-000000001202', 'employee', 'mitigation'),
  ('b0000000-0000-4000-8000-000000001200', '0e000000-0000-4000-8000-000000001203', 'employee', 'mitigation')
on conflict do nothing;
insert into public.crm_jobs (id, org_id, work_type, title) values
  ('c0000000-0000-4000-8000-000000001200', 'a0000000-0000-4000-8000-000000001200', 'mitigation', 'TEST job 12');
insert into public.job_proof_questions (id, org_id, job_id, question, answer, asked_by) values
  ('d0000000-0000-4000-8000-000000001201', 'a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200',
   'TEST what was done on Tuesday?', 'TEST The crew set fans.', '0e000000-0000-4000-8000-000000001201');

-- Ratings
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001201', $q$
  insert into public.ask_answer_feedback (org_id, job_id, question_id, user_id, rating, reason)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201',
          '0e000000-0000-4000-8000-000000001201', -1, 'incomplete')$q$) = '00000', 'a member rates an answer');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001201', $q$
  insert into public.ask_answer_feedback (org_id, job_id, question_id, user_id, rating)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201',
          '0e000000-0000-4000-8000-000000001201', 1)
  on conflict (question_id, user_id) do update set rating = excluded.rating, reason = null$q$) = '00000', 'a second rating replaces the first');
select pg_temp.expect((select rating = 1 and reason is null from public.ask_answer_feedback
  where question_id = 'd0000000-0000-4000-8000-000000001201'), 'one row per person, now thumbs up');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001202', $q$
  insert into public.ask_answer_feedback (org_id, job_id, question_id, user_id, rating)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201',
          '0e000000-0000-4000-8000-000000001201', -1)$q$) = '42501', 'nobody rates in another person''s name');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001203', $q$
  insert into public.ask_answer_feedback (org_id, job_id, question_id, user_id, rating)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201',
          '0e000000-0000-4000-8000-000000001203', -1)$q$) = '42501', 'another org cannot rate this answer');
select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001203', 'ask_answer_feedback') = 0, 'another org reads no ratings');
select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001202', 'ask_answer_feedback') = 0, 'a teammate does not read someone else''s rating');

-- Pins
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001201', $q$
  insert into public.ask_pinned_answers (org_id, job_id, question_id, pinned_by)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201',
          '0e000000-0000-4000-8000-000000001201')$q$) = '00000', 'a member pins an answer');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001202', $q$
  insert into public.ask_pinned_answers (org_id, job_id, question_id)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201')$q$) = '23505',
  'an answer is pinned once');
select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001202', 'ask_pinned_answers') = 1, 'the whole team sees the pin');
select pg_temp.expect(pg_temp.seen_by('0e000000-0000-4000-8000-000000001203', 'ask_pinned_answers') = 0, 'another org does not');
select pg_temp.expect(pg_temp.as_user('0e000000-0000-4000-8000-000000001203', $q$
  insert into public.ask_pinned_answers (org_id, job_id, question_id)
  values ('a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200', 'd0000000-0000-4000-8000-000000001201')$q$) = '42501',
  'another org cannot pin here');

-- Edited questions
insert into public.job_proof_questions (id, org_id, job_id, question, answer, asked_by, supersedes_id) values
  ('d0000000-0000-4000-8000-000000001202', 'a0000000-0000-4000-8000-000000001200', 'c0000000-0000-4000-8000-000000001200',
   'TEST what was done on Wednesday?', 'TEST Drywall came out.', '0e000000-0000-4000-8000-000000001201',
   'd0000000-0000-4000-8000-000000001201');
select pg_temp.expect((select supersedes_id = 'd0000000-0000-4000-8000-000000001201' from public.job_proof_questions
  where id = 'd0000000-0000-4000-8000-000000001202'), 'the edit points at the question it replaces');
do $$ begin
  begin
    delete from public.job_proof_questions where id = 'd0000000-0000-4000-8000-000000001201';
    raise exception 'FAIL: the edited question was deleted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
select pg_temp.expect(exists (select 1 from public.job_proof_questions where id = 'd0000000-0000-4000-8000-000000001201'),
  'the original question stays on the record');

rollback;
SQL
echo "ok: ask feedback, pins and edits"
