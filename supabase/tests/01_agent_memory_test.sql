\set ON_ERROR_STOP on
\pset pager off

-- Seed: two orgs so isolation can be proven, three people.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','pm@acme.test'),
  ('22222222-2222-2222-2222-222222222222','tech@acme.test'),
  ('33333333-3333-3333-3333-333333333333','rival@other.test');
insert into public.profiles (id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111','pm@acme.test','Dana Reyes'),
  ('22222222-2222-2222-2222-222222222222','tech@acme.test','Sam Okafor'),
  ('33333333-3333-3333-3333-333333333333','rival@other.test','Other Person');
insert into public.orgs (id, name, join_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Acme Restoration','ACME01'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Other Co','OTHR02');
insert into public.org_members (org_id, user_id, role, work_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','project_manager','mitigation'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','field_technician','mitigation'),
  ('bbbbbbbb-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','project_manager','construction');

\echo '=== 1. PM opens two jobs (org_id + job number assigned by trigger) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.jobs (name, work_type, loss_type, customer_name, city)
values ('Burst pipe — 14 Alder St', 'mitigation', 'water', 'H. Whitfield', 'Portland');
insert into public.jobs (name, work_type, customer_name)
values ('Kitchen rebuild — Marlow', 'construction', 'J. Marlow');
select job_number, name, status, org_id from public.jobs order by seq_no;

\echo '=== 2. Move it through its lifecycle; assign crew, tasks, work logs ==='
update public.jobs set status = 'in_progress', priority = 'urgent'
where job_number = 'JOB-0001';

insert into public.job_assignments (job_id, user_id, role_on_job)
select id, '22222222-2222-2222-2222-222222222222', 'crew' from public.jobs where job_number='JOB-0001';

insert into public.job_tasks (job_id, title, assigned_to)
select id, 'Set air movers in basement', '22222222-2222-2222-2222-222222222222'
from public.jobs where job_number='JOB-0001';

reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

update public.job_tasks set status = 'done' where title = 'Set air movers in basement';
insert into public.work_logs (job_id, kind, body, minutes)
select id, 'work', 'Six air movers and one dehu running. Moisture at 18%.', 145
from public.jobs where job_number='JOB-0001';

select public.record_memory_event('auth.signed_in', 'signed in from the field tablet');

\echo '=== 3. The memory: every one of those actions, in order ==='
select seq, actor_email, actor_role, event_type, summary
from public.memory_events order by seq;

\echo '=== 4. started_at / completed_at stamped automatically ==='
select job_number, status, (started_at is not null) as started_stamped from public.jobs where job_number='JOB-0001';
select title, status, (completed_at is not null) as completed_stamped,
       completed_by = '22222222-2222-2222-2222-222222222222' as completed_by_correct
from public.job_tasks;

\echo '=== 5. Field-level before/after is retained ==='
select event_type, jsonb_pretty(changes) from public.memory_events where event_type = 'job.status_changed';

\echo '=== 6. Rollups ==='
select job_number, task_count, tasks_done, crew_size, minutes_logged, event_count, last_event from public.job_memory order by job_number;
select email, role, event_count, jobs_touched, open_tasks, tasks_completed, minutes_logged from public.agent_memory order by email;

\echo '=== 7. A no-op update writes no memory ==='
select count(*) as before_noop from public.memory_events \gset
update public.jobs set name = name where job_number = 'JOB-0002';
select count(*) - :before_noop as events_added_by_noop from public.memory_events;

\echo '=== 8. History cannot be rewritten ==='
\set ON_ERROR_STOP off
update public.memory_events set summary = 'never happened' where seq = 1;
delete from public.memory_events where seq = 1;
\echo '--- and not by service_role either ---'
reset role; set role service_role;
delete from public.memory_events where seq = 1;
truncate public.memory_events;
reset role;

\echo '=== 9. Jobs and tasks cannot be deleted ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
delete from public.jobs where job_number = 'JOB-0002';
delete from public.job_tasks;
delete from public.work_logs;

\echo '=== 10. A client cannot forge a system event ==='
select public.record_memory_event('job.created', 'I definitely opened this job');
select public.record_memory_event('note.added', 'this namespace is allowed');

\echo '=== 11. Another org sees nothing, and cannot reach in ==='
reset role; set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) as jobs_visible_to_other_org from public.jobs;
select count(*) as memory_visible_to_other_org from public.memory_events;
select count(*) as agent_rows_visible from public.agent_memory;
\echo '--- attempting to file a job into a foreign org ---'
insert into public.jobs (org_id, name, work_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','Trojan job','mitigation');
\echo '--- attempting to log work against a foreign job ---'
insert into public.work_logs (org_id, job_id, body)
select 'bbbbbbbb-0000-0000-0000-000000000002', id, 'peeking' from public.jobs limit 1;

\echo '=== 12. Work logs are author-only ==='
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.work_logs set body = 'rewriting my colleague''s account';
select count(*) as pm_edited_tech_log from public.work_logs where body = 'rewriting my colleague''s account';

\echo '=== 13. Per-org numbering is independent ==='
reset role; set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into public.jobs (name, work_type) values ('Other Co first job','construction');
select job_number, name from public.jobs order by job_number;

\echo '=== 14. Not even the table owner can rewrite history ==='
-- Sections 8-9 were refused by the grants, before any trigger ran. The owner
-- bypasses grants and RLS entirely, so this is the case that actually proves
-- the append-only guarantee rather than the privilege model in front of it.
-- TRUNCATE matters separately: it does not fire row-level triggers.
reset role;
select current_user;
update public.memory_events set summary = 'never happened' where seq = 1;
delete from public.memory_events where seq = 1;
truncate public.memory_events;

\echo '=== 15. Final memory count (unchanged by everything above) ==='
select count(*) as total_events from public.memory_events;
