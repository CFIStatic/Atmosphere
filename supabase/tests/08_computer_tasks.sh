#!/usr/bin/env bash
#
# Computer (Chat's browser agent) tables: what 20261004150100_computer_tasks
# promises, checked on a database that already has every migration applied
# (the one `npm run migrate:manifest` builds), inside a transaction that is
# rolled back:
#
#   - classify_token_feature puts computer / computer_agent / computer_session
#     on the 'computer' billing line (before the video regex)
#   - members (anon, authenticated) cannot read or write any computer_* table
#   - one active task per org (the org's browser profile is single-use)
#   - computer_audit_events is append-only: no UPDATE, DELETE or TRUNCATE,
#     except the cascade when the whole org is deleted
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  COMPUTER_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/08_computer_tasks.sh [psql-connection-args...]
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

select pg_temp.expect(public.classify_token_feature('computer') = 'computer', 'computer → computer');
select pg_temp.expect(public.classify_token_feature('computer_agent') = 'computer', 'computer_agent → computer');
select pg_temp.expect(public.classify_token_feature('computer_session') = 'computer', 'computer_session → computer');
select pg_temp.expect(public.classify_token_feature('proof_ask') = 'ask', 'proof_ask still → ask');
select pg_temp.expect(public.classify_token_feature('video_analysis') = 'video_analysis', 'video still → video_analysis');

insert into public.orgs (id, name, join_code) values
  ('c0000000-0000-4000-8000-0000000000c1', 'TEST Computer Org', 'TEST-C-08');

insert into public.computer_tasks (id, org_id, instructions, status, model_id, max_steps, budget_nanos)
values ('c0000000-0000-4000-8000-00000000a001', 'c0000000-0000-4000-8000-0000000000c1', 'TEST fill the form', 'running', 'claude-sonnet-5', 60, 2000000000);

select pg_temp.expect(
  pg_temp.raises($q$insert into public.computer_tasks (org_id, instructions, status, model_id, max_steps, budget_nanos)
    values ('c0000000-0000-4000-8000-0000000000c1', 'TEST second', 'needs_you', 'claude-sonnet-5', 60, 1)$q$, '23505'),
  'a second active task in the same org is refused');

insert into public.computer_tasks (org_id, instructions, status, model_id, max_steps, budget_nanos)
values ('c0000000-0000-4000-8000-0000000000c1', 'TEST queued', 'queued', 'claude-sonnet-5', 60, 1);
select pg_temp.expect(true, 'a queued task can wait behind the active one');

insert into public.computer_approvals (org_id, task_id, action_kind, button_label, summary, expires_at)
values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000a001', 'submit', 'Submit claim', 'TEST', now() + interval '10 minutes');

insert into public.computer_audit_events (org_id, task_id, actor_kind, event)
values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000a001', 'agent', 'action');

select pg_temp.expect(pg_temp.raises('update public.computer_audit_events set event = ''x''', '42501'), 'audit UPDATE refused');
select pg_temp.expect(pg_temp.raises('delete from public.computer_audit_events', '42501'), 'audit DELETE refused');
select pg_temp.expect(pg_temp.raises('truncate public.computer_audit_events', '42501'), 'audit TRUNCATE refused');

-- Members never touch these tables.
set local role authenticated;
select pg_temp.expect(pg_temp.raises('select * from public.computer_tasks', '42501'), 'authenticated cannot read computer_tasks');
select pg_temp.expect(pg_temp.raises('select * from public.computer_approvals', '42501'), 'authenticated cannot read computer_approvals');
select pg_temp.expect(pg_temp.raises('select * from public.computer_sessions', '42501'), 'authenticated cannot read computer_sessions');
select pg_temp.expect(pg_temp.raises('select * from public.computer_audit_events', '42501'), 'authenticated cannot read computer_audit_events');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.raises('select * from public.computer_tasks', '42501'), 'anon cannot read computer_tasks');
reset role;

select pg_temp.expect(
  (select bool_and(relrowsecurity) from pg_class where relname in ('computer_tasks','computer_approvals','computer_sessions','computer_audit_events') and relnamespace = 'public'::regnamespace),
  'RLS is on for all four tables');

-- Deleting the org cascades through every table, audit included.
delete from public.orgs where id = 'c0000000-0000-4000-8000-0000000000c1';
select pg_temp.expect((select count(*) from public.computer_audit_events where org_id = 'c0000000-0000-4000-8000-0000000000c1') = 0, 'org delete removes its audit rows');
select pg_temp.expect((select count(*) from public.computer_tasks where org_id = 'c0000000-0000-4000-8000-0000000000c1') = 0, 'org delete removes its tasks');

rollback;
SQL
echo "08_computer_tasks: all checks passed"
