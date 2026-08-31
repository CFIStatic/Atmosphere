-- Soft-delete job files from the office library.
-- The row stays so legal hold and the vault can still answer for the job.
-- Nothing that happened stops having happened.

alter table public.crm_jobs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

comment on column public.crm_jobs.deleted_at is
  'When the office hid this job file from the product. Null means it still lists. '
  'Proofs, messages, and the vault stay; the dashboard does not.';

create index if not exists crm_jobs_deleted_idx
  on public.crm_jobs (org_id, deleted_at)
  where deleted_at is not null;

-- Job Files and Overview read this view. Hide deleted files there too.
create or replace view public.job_memory
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
from public.crm_jobs j
where j.deleted_at is null;

grant select on public.job_memory to authenticated;
