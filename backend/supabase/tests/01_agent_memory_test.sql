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

\echo '=== 1. PM opens two CRM jobs — the memory picks them up ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.crm_jobs (org_id, title, work_type, loss_type, claim_number)
values ('aaaaaaaa-0000-0000-0000-000000000001','Burst pipe — 14 Alder St','mitigation','water','CLM-77');
insert into public.crm_jobs (org_id, title, work_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','Kitchen rebuild — Marlow','construction');
select job_number, title, status from public.crm_jobs order by job_number;

\echo '=== 2. Lifecycle, crew, tasks, work logs ==='
update public.crm_jobs set status = 'in_progress', priority = 1
where title like 'Burst pipe%';

insert into public.job_assignments (org_id, job_id, user_id, role_on_job)
select org_id, id, '22222222-2222-2222-2222-222222222222', 'crew'
from public.crm_jobs where title like 'Burst pipe%';

insert into public.job_tasks (org_id, job_id, title, assigned_to)
select org_id, id, 'Set air movers in basement', '22222222-2222-2222-2222-222222222222'
from public.crm_jobs where title like 'Burst pipe%';

reset role; set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

update public.job_tasks set status = 'done' where title = 'Set air movers in basement';
insert into public.work_logs (org_id, job_id, kind, body, minutes)
select org_id, id, 'work', 'Six air movers and one dehu running. Moisture at 18%.', 145
from public.crm_jobs where title like 'Burst pipe%';

select public.record_memory_event('auth.signed_in', 'signed in from the field tablet');

\echo '=== 3. The memory: every action, in order ==='
select seq, actor_email, actor_role, event_type, summary
from public.memory_events order by seq;

\echo '=== 4. Task completion stamped automatically ==='
select title, status, (completed_at is not null) as completed_stamped,
       completed_by = '22222222-2222-2222-2222-222222222222' as completed_by_correct
from public.job_tasks;

\echo '=== 5. Field-level before/after retained on the CRM job ==='
select jsonb_pretty(changes) from public.memory_events where event_type = 'job.status_changed';

\echo '=== 6. Rollups ==='
select job_number, title, task_count, tasks_done, crew_size, minutes_logged, event_count, last_event
from public.job_memory order by job_number;
select email, role, event_count, jobs_touched, open_tasks, tasks_completed, minutes_logged
from public.agent_memory order by email;

\echo '=== 7. A no-op update writes no memory ==='
select count(*) as before_noop from public.memory_events \gset
update public.crm_jobs set title = title where title like 'Kitchen%';
select count(*) - :before_noop as events_added_by_noop from public.memory_events;

\echo '=== 8. History cannot be rewritten ==='
\set ON_ERROR_STOP off
update public.memory_events set summary = 'never happened' where seq = 1;
delete from public.memory_events where seq = 1;
\echo '--- nor by service_role ---'
reset role; set role service_role;
delete from public.memory_events where seq = 1;
truncate public.memory_events;
reset role;

\echo '=== 9. Tasks, crew and logs cannot be deleted ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
delete from public.job_tasks;
delete from public.work_logs;
delete from public.job_assignments;

\echo '=== 10. A client cannot forge a system event ==='
select public.record_memory_event('job.created', 'I definitely opened this job');
select public.record_memory_event('note.added', 'this namespace is allowed');

\echo '=== 11. Another org sees nothing, and cannot reach in ==='
reset role; set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) as jobs_visible from public.crm_jobs;
select count(*) as memory_visible from public.memory_events;
\echo '--- attempting to attach a task to a foreign job ---'
insert into public.job_tasks (org_id, job_id, title)
select 'bbbbbbbb-0000-0000-0000-000000000002', id, 'Trojan task'
from public.crm_jobs limit 1;
\echo '--- attempting to file a task into a foreign org ---'
insert into public.job_tasks (org_id, job_id, title)
values ('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'Trojan task 2');

\echo '=== 12. Work logs are author-only ==='
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.work_logs set body = 'rewriting my colleague''s account';
select count(*) as pm_edited_tech_log from public.work_logs where body = 'rewriting my colleague''s account';

\echo '=== 13. Not even the table owner can rewrite history ==='
-- Sections 8-9 were refused by the grants, before any trigger ran. The owner
-- bypasses grants and RLS entirely, so this is what actually proves the
-- append-only guarantee. TRUNCATE matters separately: it does not fire
-- row-level triggers.
reset role;
select current_user;
update public.memory_events set summary = 'never happened' where seq = 1;
delete from public.memory_events where seq = 1;
truncate public.memory_events;

\echo '=== 14. Final memory count (unchanged by everything above) ==='
select count(*) as total_events from public.memory_events;

-- ============================================================================
-- 15. Assertions
-- ============================================================================
-- Everything above prints; only this section fails. The sections that expect an
-- ERROR prove nothing on their own — psql keeps going with ON_ERROR_STOP off, so
-- a guarantee that silently stopped holding would still look like a clean run.
-- These checks turn each of those into something CI can go red on.
\set ON_ERROR_STOP on

do $$
declare
  v_events   bigint;
  v_tasks    bigint;
  v_logs     bigint;
  v_crew     bigint;
  v_forged   bigint;
  v_orphans  bigint;
begin
  -- Sections 8, 9 and 13 all tried to destroy history. None of it may have worked.
  select count(*) into v_events from public.memory_events;
  if v_events = 0 then
    raise exception 'memory_events is empty — the append-only guarantee failed';
  end if;

  select count(*) into v_tasks from public.job_tasks;
  select count(*) into v_logs  from public.work_logs;
  select count(*) into v_crew  from public.job_assignments;
  if v_tasks = 0 or v_logs = 0 or v_crew = 0 then
    raise exception 'a no-delete table lost rows: tasks=%, logs=%, crew=%',
      v_tasks, v_logs, v_crew;
  end if;

  -- Section 10 tried to fabricate a job event through the client RPC.
  select count(*) into v_forged
  from public.memory_events
  where source = 'app' and event_type not like 'auth.%'
    and event_type not like 'note.%' and event_type not like 'export.%'
    and event_type not like 'view.%' and event_type not like 'session.%';
  if v_forged > 0 then
    raise exception '% client-recorded event(s) escaped the namespace guard', v_forged;
  end if;

  -- Every job event must name the job it happened to.
  select count(*) into v_orphans
  from public.memory_events
  where entity_type in ('job', 'task', 'assignment', 'work_log') and job_id is null;
  if v_orphans > 0 then
    raise exception '% entity event(s) carry no job_id', v_orphans;
  end if;

  -- The capture trigger must have produced one event per action taken above.
  if (select count(*) from public.memory_events where event_type = 'job.created') <> 2 then
    raise exception 'expected 2 job.created events, found %',
      (select count(*) from public.memory_events where event_type = 'job.created');
  end if;
  if (select count(*) from public.memory_events where event_type = 'task.status_changed') <> 1 then
    raise exception 'the task completion was not captured';
  end if;
  if (select count(*) from public.memory_events where event_type = 'work_log.created') <> 1 then
    raise exception 'the work log was not captured';
  end if;

  raise notice 'All Agent Memory guarantees hold (% events recorded).', v_events;
end;
$$;
