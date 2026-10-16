-- ---------------------------------------------------------------------------
-- Opening a job must not fail because the memory ledger cannot record it.
-- ---------------------------------------------------------------------------
-- `memory_events.job_id` was deliberately left without a foreign key so a
-- record of what happened can outlive the row it describes. Production grew
-- `memory_events_job_id_fkey` anyway (dashboard advisor, or a leftover
-- `jobs` table). The capture trigger on `crm_jobs` then inserts a memory
-- row during the same statement that creates the job:
--
--   insert or update on table "memory_events" violates foreign key
--   constraint "memory_events_job_id_fkey"
--
-- Approve & invite surfaces that as a failed Start a job. Drop the stray
-- constraint, keep capture AFTER the job row exists, and never let a ledger
-- write abort the parent insert.

create or replace function public.repair_memory_job_fk()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  dropped boolean := false;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(con.conkey) as cols(attnum) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = cols.attnum
    where con.contype = 'f'
      and c.relname = 'memory_events'
      and a.attname = 'job_id'
  loop
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      r.sch,
      r.tbl,
      r.conname
    );
    dropped := true;
  end loop;
  return dropped;
end;
$$;

comment on function public.repair_memory_job_fk() is
  'Drops any foreign key on memory_events.job_id. The ledger must not '
  'reference live rows — and must never block creating a job.';

revoke all on function public.repair_memory_job_fk() from public, anon, authenticated;
grant execute on function public.repair_memory_job_fk() to service_role;

select public.repair_memory_job_fk();

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
      if v_key = 'updated_at' then
        continue;
      end if;
      if v_new -> v_key is distinct from v_old -> v_key then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      end if;
    end loop;

    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;

  v_job := case
    when v_entity = 'job' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'job_id', '')::uuid
  end;

  -- BEFORE INSERT on crm_jobs (or a trigger attached to the wrong table with
  -- entity 'job') would set job_id to a row that is not in crm_jobs yet. A
  -- stray FK then aborts the parent write. Leave job_id null rather than fail.
  if v_job is not null and not exists (
    select 1 from public.crm_jobs j where j.id = v_job
  ) then
    v_job := null;
  end if;

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

  begin
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
  exception
    when others then
      raise warning 'memory.capture skipped (%) for %.%: %',
        v_event, v_entity, v_row ->> 'id', sqlerrm;
  end;

  return coalesce(new, old);
end;
$$;

-- Capture must see the new crm_jobs row. BEFORE INSERT is what makes a
-- job_id foreign key fail: the parent is not there yet.
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
