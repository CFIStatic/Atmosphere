-- ============================================================================
-- Recreate memory rollup views (drop + create)
-- ----------------------------------------------------------------------------
-- Postgres cannot CREATE OR REPLACE VIEW when the new definition drops
-- columns (42P16). Supabase Preview failed on job_memory for that reason.
-- This forward migration makes the replace safe on already-seeded databases;
-- 20260727000000_agent_memory.sql was updated the same way for fresh replays.
-- ============================================================================

drop view if exists public.job_memory cascade;
create view public.job_memory
with (security_invoker = true) as
select
  j.id            as job_id,
  j.org_id,
  j.job_number,
  j.title,
  j.status::text  as status,
  j.priority,
  j.work_type::text as work_type,
  j.owner_id,
  j.claim_number,
  j.created_at,
  j.updated_at,
  (select count(*) from public.job_tasks t where t.job_id = j.id)                        as task_count,
  (select count(*) from public.job_tasks t where t.job_id = j.id and t.status = 'done')  as tasks_done,
  (select count(*) from public.job_assignments a
     where a.job_id = j.id and a.released_at is null)                                    as crew_size,
  (select coalesce(sum(w.minutes), 0) from public.work_logs w where w.job_id = j.id)     as minutes_logged,
  (select count(*) from public.memory_events e where e.job_id = j.id)                    as event_count,
  (select max(e.occurred_at) from public.memory_events e where e.job_id = j.id)          as last_event_at,
  (select e.summary from public.memory_events e
     where e.job_id = j.id order by e.seq desc limit 1)                                  as last_event
from public.crm_jobs j;

comment on view public.job_memory is 'A crm_job with its memory rolled up — the state of the record at a glance.';

drop view if exists public.agent_memory cascade;
create view public.agent_memory
with (security_invoker = true) as
select
  m.org_id,
  m.user_id,
  p.email,
  p.full_name,
  m.role::text      as role,
  m.work_type::text as work_type,
  (select count(*) from public.memory_events e
     where e.org_id = m.org_id and e.actor_id = m.user_id)                                as event_count,
  (select count(distinct e.job_id) from public.memory_events e
     where e.org_id = m.org_id and e.actor_id = m.user_id and e.job_id is not null)       as jobs_touched,
  (select count(*) from public.job_tasks t
     where t.org_id = m.org_id and t.assigned_to = m.user_id and t.status <> 'done')      as open_tasks,
  (select count(*) from public.job_tasks t where t.completed_by = m.user_id)              as tasks_completed,
  (select coalesce(sum(w.minutes), 0) from public.work_logs w
     where w.org_id = m.org_id and w.author_id = m.user_id)                               as minutes_logged,
  (select max(e.occurred_at) from public.memory_events e
     where e.org_id = m.org_id and e.actor_id = m.user_id)                                as last_active_at
from public.org_members m
left join public.profiles p on p.id = m.user_id;

comment on view public.agent_memory is 'Everything a member has done, rolled up per person.';

grant select on public.job_memory to authenticated;
grant select on public.agent_memory to authenticated;
