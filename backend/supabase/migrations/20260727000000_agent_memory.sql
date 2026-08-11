-- ============================================================================
-- Agent Memory
-- ============================================================================
-- The operational layer over `crm_jobs` — the tasks under a job, the crew on
-- it, the work people log against it — plus a complete, append-only record of
-- everything that happens to any of it.
--
-- This does NOT introduce a second job table. `crm_jobs` from the CRM schema is
-- the one and only job record; everything here hangs off it. Job CRUD stays
-- with `/api/crm/jobs`.
--
-- Two design decisions carry the "complete" claim:
--
-- 1. Capture happens in DATABASE TRIGGERS, not application code. Application
--    logging is only as complete as the code paths that remember to call it; a
--    trigger fires for the BFF, a SQL console, a background job, and whatever
--    client gets written next year.
--
-- 2. Nothing is destroyed. `memory_events` rejects UPDATE, DELETE and TRUNCATE
--    for every role including the table owner and service_role, and none of the
--    tables here grant DELETE. Crew are released, tasks are cancelled.
--
-- Relationship to `crm_audit_log`: that table is the backup system's restore
-- ledger — raw row images with `prev_data` so a change can be reversed.
-- `memory_events` is the human record: narrative summaries, typed events, and
-- immutability. Different readers, different guarantees, deliberately separate.
--
-- Safe to re-run: every object is created guarded.
-- ============================================================================

create schema if not exists memory;
comment on schema memory is
  'Internals of Agent Memory. Not exposed through PostgREST: reachable from '
  'policies and triggers, not callable as an RPC.';

grant usage on schema memory to authenticated;

-- ============================================================================
-- 1. Helpers
-- ============================================================================
-- Membership is checked with private.is_org_member(uuid) from the CRM schema —
-- the same helper every crm_* policy uses. Only what is genuinely new lives
-- here.

-- The caller's organization, for column defaults.
create or replace function memory.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.org_id
  from public.org_members m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

-- "Is that person on this team?" — asked from the assignment policy.
-- SECURITY DEFINER because a plain subquery would re-enter the org_members
-- policies from inside a policy.
create or replace function memory.is_org_member(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = p_user_id
  );
$$;

-- "Does this job belong to that org?" — asked from the task and work-log
-- policies, for the same reason.
create or replace function memory.job_in_org(p_job_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_jobs j
    where j.id = p_job_id and j.org_id = p_org_id
  );
$$;

-- Rejects any attempt to change history. Attached BEFORE UPDATE OR DELETE, so
-- the append path (a SECURITY DEFINER insert) is unaffected.
create or replace function memory.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'memory_events is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

-- 'status, assigned_to' — renders a readable summary for a generic edit.
create or replace function memory.changed_fields(p_changes jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(k, ', ' order by k), 'no fields')
  from jsonb_object_keys(p_changes) as k;
$$;

-- ============================================================================
-- 2. Tasks
-- ============================================================================
-- `crm_activities` can carry a task-shaped row (kind='task', assigned_to,
-- due_at, completed_at). This table exists alongside it because the field
-- workflow needs what an activity does not model: a status beyond
-- done/not-done (blocked matters on a job site), an explicit ordering, and a
-- priority. Activities remain the record of contact; these are the checklist.

create table if not exists public.job_tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default memory.current_org_id() references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,

  title        text not null check (length(btrim(title)) between 2 and 200),
  details      text,
  status       text not null default 'todo'
                 check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority     text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'urgent')),

  assigned_to  uuid references public.profiles (id) on delete set null,
  due_at       timestamptz,
  position     integer not null default 0,

  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,

  created_by   uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.job_tasks is 'A unit of work under a crm_job, optionally assigned to a member.';

create index if not exists job_tasks_job_idx      on public.job_tasks (job_id, position, created_at);
create index if not exists job_tasks_assignee_idx on public.job_tasks (org_id, assigned_to, status);

create or replace function memory.stamp_task_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := now();
      new.completed_by := auth.uid();
    elsif new.status <> 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists job_tasks_stamp_completion on public.job_tasks;
create trigger job_tasks_stamp_completion
  before update on public.job_tasks
  for each row execute function memory.stamp_task_completion();

drop trigger if exists job_tasks_touch on public.job_tasks;
create trigger job_tasks_touch
  before update on public.job_tasks
  for each row execute function private.touch_updated_at();

-- ============================================================================
-- 3. Crew assignments — which people were on which job, and when
-- ============================================================================
-- `crm_jobs.owner_id` names the one person accountable for a job. This is the
-- crew: everyone who worked it, with the history of when they joined and left.

create table if not exists public.job_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default memory.current_org_id() references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role_on_job  text not null default 'crew'
                 check (role_on_job in ('lead', 'crew', 'estimator', 'supervisor', 'observer')),

  assigned_by  uuid references public.profiles (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  -- Set instead of deleting the row, so who was on the job during any past
  -- window survives the person leaving it.
  released_at  timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.job_assignments is 'Crew-to-job assignment history. Released, never deleted.';

-- One live assignment per person per job; released rows are unconstrained so
-- the same person can come back onto the job later.
create unique index if not exists job_assignments_active_unique
  on public.job_assignments (job_id, user_id)
  where released_at is null;

create index if not exists job_assignments_user_idx
  on public.job_assignments (org_id, user_id, assigned_at desc);

drop trigger if exists job_assignments_touch on public.job_assignments;
create trigger job_assignments_touch
  before update on public.job_assignments
  for each row execute function private.touch_updated_at();

-- ============================================================================
-- 4. Work logs — what someone says they did, and how long it took
-- ============================================================================
-- Distinct from crm_activities (which records contact — calls, emails,
-- meetings) by carrying `minutes`. Nothing in the CRM captures time on the job,
-- and time is what payroll, job costing and a disputed invoice all turn on.

create table if not exists public.work_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default memory.current_org_id() references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  task_id     uuid references public.job_tasks (id) on delete set null,

  kind        text not null default 'work'
                check (kind in ('work', 'note', 'call', 'site_visit', 'photo', 'material', 'issue')),
  body        text not null check (length(btrim(body)) between 1 and 8000),
  minutes     integer check (minutes >= 0 and minutes <= 24 * 60),
  occurred_at timestamptz not null default now(),

  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.work_logs is
  'Someone''s own account of work done on a job, with time spent. Editable by '
  'its author — every edit is captured in memory_events with the before and after.';

create index if not exists work_logs_job_idx    on public.work_logs (job_id, occurred_at desc);
create index if not exists work_logs_author_idx on public.work_logs (org_id, author_id, occurred_at desc);

drop trigger if exists work_logs_touch on public.work_logs;
create trigger work_logs_touch
  before update on public.work_logs
  for each row execute function private.touch_updated_at();

-- ============================================================================
-- 5. The memory itself
-- ============================================================================

create table if not exists public.memory_events (
  id          uuid primary key default gen_random_uuid(),
  -- Total ordering within the database. `occurred_at` can tie; seq gives the
  -- feed a stable sort and an exact pagination cursor.
  seq         bigint generated always as identity,

  org_id      uuid not null,

  -- The actor's email and role are copied in at write time on purpose. A memory
  -- row must still read true years later, after the person has changed role or
  -- left — resolving it by join would silently rewrite history.
  actor_id    uuid,
  actor_email text,
  actor_role  text,

  event_type  text not null,   -- 'job.created', 'task.status_changed', 'auth.signed_in', …
  entity_type text not null,   -- 'job' | 'task' | 'assignment' | 'work_log' | 'session'
  entity_id   uuid,
  job_id      uuid,

  summary     text not null,   -- one human-readable sentence
  changes     jsonb not null default '{}'::jsonb,  -- {field: {from, to}}
  snapshot    jsonb,           -- the full row as it stood after the change
  source      text not null default 'trigger' check (source in ('trigger', 'app')),

  occurred_at timestamptz not null default now()
);

-- Deliberately no foreign keys on org_id, actor_id, entity_id or job_id. A
-- record of what happened has to outlive the row it describes: an FK would
-- either block the delete or rewrite the event, and rewriting is exactly what
-- this table exists to prevent. `on delete set null` is not available to us —
-- the immutability trigger below would reject the cascade.
comment on table public.memory_events is
  'Append-only record of everything that happens in an organization. UPDATE, '
  'DELETE and TRUNCATE are rejected for every role, including service_role.';

create index if not exists memory_events_feed_idx   on public.memory_events (org_id, seq desc);
create index if not exists memory_events_job_idx    on public.memory_events (org_id, job_id, seq desc);
create index if not exists memory_events_actor_idx  on public.memory_events (org_id, actor_id, seq desc);
create index if not exists memory_events_type_idx   on public.memory_events (org_id, event_type, seq desc);
create index if not exists memory_events_entity_idx on public.memory_events (entity_type, entity_id, seq desc);
create index if not exists memory_events_time_idx   on public.memory_events (org_id, occurred_at desc);

drop trigger if exists memory_events_immutable on public.memory_events;
create trigger memory_events_immutable
  before update or delete on public.memory_events
  for each row execute function memory.reject_mutation();

-- TRUNCATE does not fire row-level triggers, so the guard above would not see
-- it. Without this, one statement empties the record.
drop trigger if exists memory_events_no_truncate on public.memory_events;
create trigger memory_events_no_truncate
  before truncate on public.memory_events
  for each statement execute function memory.reject_mutation();

-- ----------------------------------------------------------------------------
-- The universal capture trigger
-- ----------------------------------------------------------------------------
-- Attached to crm_jobs and to every table above, with the entity label as its
-- argument. Diffs the row, names the event, writes a sentence a human can read,
-- and keeps the full before/after for anyone who needs the detail.

create or replace function memory.capture()
returns trigger
language plpgsql
security definer
set search_path = public, memory, pg_temp
as $$
declare
  v_entity  text  := tg_argv[0];
  v_new     jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old     jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_actor   uuid  := auth.uid();
  v_org     uuid;
  v_job     uuid;
  v_label   text;
  v_event   text;
  v_summary text;
  v_key     text;
begin
  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  if v_org is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      -- updated_at moves on every write and would make every diff non-empty.
      if v_key = 'updated_at' then
        continue;
      end if;
      if v_new -> v_key is distinct from v_old -> v_key then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      end if;
    end loop;

    -- A touch that changed nothing is not a memory.
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;

  v_job := case
    when v_entity = 'job' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'job_id', '')::uuid
  end;

  v_event := v_entity || '.' || case tg_op
    when 'INSERT' then 'created'
    when 'DELETE' then 'deleted'
    else case
      when v_changes ? 'status'      then 'status_changed'
      when v_changes ? 'assigned_to' then 'reassigned'
      when v_changes ? 'released_at' then 'released'
      else 'updated'
    end
  end;

  -- crm_jobs names its job 'title'; everything else here uses 'title' too.
  v_label := coalesce(v_row ->> 'title', v_row ->> 'name', '');

  v_summary := case
    when v_entity = 'job' and tg_op = 'INSERT' then
      format('opened job #%s — %s', v_row ->> 'job_number', v_label)
    when v_entity = 'job' and tg_op = 'DELETE' then
      format('deleted job #%s — %s', v_row ->> 'job_number', v_label)
    when v_entity = 'job' and v_changes ? 'status' then
      format('moved job #%s from %s to %s', v_row ->> 'job_number',
             v_changes #>> '{status,from}', v_changes #>> '{status,to}')
    when v_entity = 'job' then
      format('updated job #%s (%s)', v_row ->> 'job_number', memory.changed_fields(v_changes))

    when v_entity = 'task' and tg_op = 'INSERT' then
      format('added task "%s"', v_label)
    when v_entity = 'task' and v_changes ? 'status' then
      format('marked task "%s" as %s', v_label, v_changes #>> '{status,to}')
    when v_entity = 'task' and v_changes ? 'assigned_to' then
      format('reassigned task "%s"', v_label)
    when v_entity = 'task' then
      format('updated task "%s" (%s)', v_label, memory.changed_fields(v_changes))

    when v_entity = 'assignment' and tg_op = 'INSERT' then
      format('put a %s on the job', v_row ->> 'role_on_job')
    when v_entity = 'assignment' and v_changes ? 'released_at' then
      'released someone from the job'
    when v_entity = 'assignment' then
      format('changed an assignment (%s)', memory.changed_fields(v_changes))

    when v_entity = 'work_log' and tg_op = 'INSERT' then
      format('logged %s%s', v_row ->> 'kind',
             case when v_row ->> 'minutes' is null then ''
                  else format(' (%s min)', v_row ->> 'minutes') end)
    when v_entity = 'work_log' then
      format('edited a %s entry (%s)', v_row ->> 'kind', memory.changed_fields(v_changes))

    else format('%s a %s', lower(tg_op), v_entity)
  end;

  insert into public.memory_events (
    org_id, actor_id, actor_email, actor_role,
    event_type, entity_type, entity_id, job_id,
    summary, changes, snapshot, source
  )
  values (
    v_org,
    v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    (select m.role::text from public.org_members m
      where m.user_id = v_actor and m.org_id = v_org limit 1),
    v_event, v_entity, (v_row ->> 'id')::uuid, v_job,
    v_summary, v_changes, v_new, 'trigger'
  );

  return coalesce(new, old);
end;
$$;

-- crm_jobs already carries the CRM's own audit trigger for the restore ledger;
-- this adds the narrative record on top. Two triggers, two purposes.
drop trigger if exists crm_jobs_memory_capture on public.crm_jobs;
create trigger crm_jobs_memory_capture
  after insert or update or delete on public.crm_jobs
  for each row execute function memory.capture('job');

drop trigger if exists job_tasks_capture on public.job_tasks;
create trigger job_tasks_capture
  after insert or update or delete on public.job_tasks
  for each row execute function memory.capture('task');

drop trigger if exists job_assignments_capture on public.job_assignments;
create trigger job_assignments_capture
  after insert or update or delete on public.job_assignments
  for each row execute function memory.capture('assignment');

drop trigger if exists work_logs_capture on public.work_logs;
create trigger work_logs_capture
  after insert or update or delete on public.work_logs
  for each row execute function memory.capture('work_log');

-- ----------------------------------------------------------------------------
-- Events that are not table writes
-- ----------------------------------------------------------------------------
-- Signing in, signing out, unlocking with a PIN, exporting the record: real
-- events with no row behind them. The backend records these through this RPC.
--
-- It is deliberately narrow. The actor comes from auth.uid() and the org from
-- the caller's membership — neither can be supplied — and the event type must
-- sit in a client-recordable namespace. Everything under `job.`, `task.`,
-- `assignment.` and `work_log.` is reachable only by actually changing the row,
-- so a caller cannot fabricate an action or attribute one to somebody else.

create or replace function public.record_memory_event(
  p_event_type  text,
  p_summary     text,
  p_entity_type text default 'session',
  p_entity_id   uuid default null,
  p_job_id      uuid default null,
  p_details     jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, memory, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org   uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_event_type !~ '^(auth|session|view|export|note)\.[a-z_]+$' then
    raise exception 'event type "%" cannot be recorded by a client', p_event_type
      using errcode = '22023';
  end if;

  v_org := memory.current_org_id();
  -- Signing in before onboarding is legitimate and has no org to file under.
  if v_org is null then
    return null;
  end if;

  if p_job_id is not null and not memory.job_in_org(p_job_id, v_org) then
    raise exception 'job does not belong to your organization' using errcode = '42501';
  end if;

  insert into public.memory_events (
    org_id, actor_id, actor_email, actor_role,
    event_type, entity_type, entity_id, job_id,
    summary, changes, snapshot, source
  )
  values (
    v_org, v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    (select m.role::text from public.org_members m
      where m.user_id = v_actor and m.org_id = v_org limit 1),
    p_event_type, p_entity_type, p_entity_id, p_job_id,
    left(p_summary, 500), '{}'::jsonb, coalesce(p_details, '{}'::jsonb), 'app'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================================
-- 6. Rollups
-- ============================================================================
-- security_invoker so the underlying RLS policies still decide what is visible.
--
-- DROP + CREATE (not CREATE OR REPLACE): Postgres refuses CREATE OR REPLACE
-- VIEW when the new shape drops columns (42P16). Preview branches that already
-- carry a wider job_memory from an earlier apply hit that error; drop first.

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

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================
-- Same rule as every crm_* table: your organization, and only your
-- organization. There is no DELETE policy anywhere in this migration — that is
-- the retention guarantee, expressed where it cannot be forgotten.

alter table public.job_tasks       enable row level security;
alter table public.job_assignments enable row level security;
alter table public.work_logs       enable row level security;
alter table public.memory_events   enable row level security;

-- Tasks ----------------------------------------------------------------------
drop policy if exists job_tasks_select on public.job_tasks;
create policy job_tasks_select on public.job_tasks
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists job_tasks_insert on public.job_tasks;
create policy job_tasks_insert on public.job_tasks
  for insert to authenticated
  with check (private.is_org_member(org_id) and memory.job_in_org(job_id, org_id));

drop policy if exists job_tasks_update on public.job_tasks;
create policy job_tasks_update on public.job_tasks
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Assignments ----------------------------------------------------------------
drop policy if exists job_assignments_select on public.job_assignments;
create policy job_assignments_select on public.job_assignments
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists job_assignments_insert on public.job_assignments;
create policy job_assignments_insert on public.job_assignments
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and memory.job_in_org(job_id, org_id)
    -- You can only put someone on a job who is actually in the organization.
    and memory.is_org_member(org_id, user_id)
  );

drop policy if exists job_assignments_update on public.job_assignments;
create policy job_assignments_update on public.job_assignments
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Work logs ------------------------------------------------------------------
drop policy if exists work_logs_select on public.work_logs;
create policy work_logs_select on public.work_logs
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists work_logs_insert on public.work_logs;
create policy work_logs_insert on public.work_logs
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and memory.job_in_org(job_id, org_id)
    and author_id = auth.uid()
  );

-- Only the author may revise their own account of the work, and they may not
-- hand authorship to someone else.
drop policy if exists work_logs_update on public.work_logs;
create policy work_logs_update on public.work_logs
  for update to authenticated
  using (private.is_org_member(org_id) and author_id = auth.uid())
  with check (author_id = auth.uid());

-- Memory ---------------------------------------------------------------------
-- Read only. Writes arrive exclusively through the SECURITY DEFINER code above,
-- which is why there is no insert policy here.
drop policy if exists memory_events_select on public.memory_events;
create policy memory_events_select on public.memory_events
  for select to authenticated
  using (private.is_org_member(org_id));

-- ============================================================================
-- 8. Grants
-- ============================================================================
-- Belt and braces alongside the policies: DELETE is never granted, so retention
-- does not rest on a policy staying absent.

grant select, insert, update on public.job_tasks       to authenticated;
grant select, insert, update on public.job_assignments to authenticated;
grant select, insert, update on public.work_logs       to authenticated;
grant select                 on public.memory_events   to authenticated;
grant select                 on public.job_memory      to authenticated;
grant select                 on public.agent_memory    to authenticated;

revoke insert, update, delete, truncate on public.memory_events from authenticated, anon;

grant execute on function public.record_memory_event(text, text, text, uuid, uuid, jsonb) to authenticated;
revoke execute on function public.record_memory_event(text, text, text, uuid, uuid, jsonb) from anon, public;
