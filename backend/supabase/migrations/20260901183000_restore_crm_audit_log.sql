-- Job-file delete updates public.crm_jobs. Leftover crm_jobs_audit still
-- inserts into public.crm_audit_log. That table was dropped with the old CRM
-- product, so Delete permanently fails:
--   relation "public.crm_audit_log" does not exist
--
-- Recreate the ledger so store / delete / keep works, and make the writer
-- swallow a missing table so a future drop cannot break the office again.

create table if not exists public.crm_audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid,
  table_name    text not null,
  row_id        uuid,
  op            text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id      uuid,
  changed_at    timestamptz not null default now(),
  row_data      jsonb,
  prev_data     jsonb
);

create index if not exists crm_audit_log_org_time_idx
  on public.crm_audit_log (org_id, changed_at desc);
create index if not exists crm_audit_log_row_idx
  on public.crm_audit_log (table_name, row_id, changed_at desc);
create index if not exists crm_audit_log_time_idx
  on public.crm_audit_log (changed_at);

alter table public.crm_audit_log enable row level security;

drop policy if exists crm_audit_log_select on public.crm_audit_log;
create policy crm_audit_log_select on public.crm_audit_log
  for select to authenticated
  using (org_id is not null and private.is_org_member(org_id));

grant select on public.crm_audit_log to authenticated;
revoke all on public.crm_audit_log from anon;

create or replace function private.crm_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  jsonb;
  v_prev jsonb;
  v_org  uuid;
  v_id   uuid;
begin
  if tg_op = 'DELETE' then
    v_row  := to_jsonb(old);
    v_prev := null;
  elsif tg_op = 'UPDATE' then
    v_row  := to_jsonb(new);
    v_prev := to_jsonb(old);
  else
    v_row  := to_jsonb(new);
    v_prev := null;
  end if;

  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  v_id  := nullif(v_row ->> 'id', '')::uuid;

  begin
    insert into public.crm_audit_log (org_id, table_name, row_id, op, actor_id, row_data, prev_data)
    values (v_org, tg_table_name, v_id, tg_op, auth.uid(), v_row, v_prev);
  exception
    when undefined_table then
      -- Ledger missing must never block hiding a job file.
      null;
    when others then
      raise warning 'crm_audit skipped for %.%: %', tg_table_name, v_id, sqlerrm;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_audit() from public, anon, authenticated;

create or replace function public.ensure_crm_audit_log()
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if to_regclass('public.crm_audit_log') is null then
    execute $sql$
      create table public.crm_audit_log (
        id            bigint generated always as identity primary key,
        org_id        uuid,
        table_name    text not null,
        row_id        uuid,
        op            text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
        actor_id      uuid,
        changed_at    timestamptz not null default now(),
        row_data      jsonb,
        prev_data     jsonb
      )
    $sql$;
    execute 'create index if not exists crm_audit_log_org_time_idx on public.crm_audit_log (org_id, changed_at desc)';
    execute 'alter table public.crm_audit_log enable row level security';
  end if;
  return true;
end;
$$;

comment on function public.ensure_crm_audit_log() is
  'Creates public.crm_audit_log when missing so job-file delete can write.';

revoke all on function public.ensure_crm_audit_log() from public, anon, authenticated;
grant execute on function public.ensure_crm_audit_log() to service_role;

select public.ensure_crm_audit_log();

-- Existing crm_jobs_audit already points at private.crm_audit(). Replacing
-- the function above is enough — do not recreate triggers here.
