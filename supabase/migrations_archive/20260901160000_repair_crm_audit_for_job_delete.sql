-- Soft-delete of a job file updates public.crm_jobs. Leftover CRM product
-- triggers still call private.crm_audit() → insert into public.crm_audit_log.
-- That table was removed with the old CRM product, so Delete permanently fails:
--   relation "public.crm_audit_log" does not exist
--
-- Drop the orphans and expose a service-role repair RPC the BFF can call
-- before soft-delete (same pattern as repair_memory_job_fk).

create or replace function public.repair_crm_audit_triggers()
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  dropped boolean := false;
begin
  if to_regclass('public.crm_jobs') is not null then
    if exists (
      select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'crm_jobs'
         and t.tgname = 'crm_jobs_audit'
         and not t.tgisinternal
    ) then
      execute 'drop trigger if exists crm_jobs_audit on public.crm_jobs';
      dropped := true;
    end if;
  end if;

  if to_regclass('public.crm_properties') is not null then
    execute 'drop trigger if exists crm_properties_audit on public.crm_properties';
  end if;
  if to_regclass('public.crm_accounts') is not null then
    execute 'drop trigger if exists crm_accounts_audit on public.crm_accounts';
  end if;
  if to_regclass('public.crm_contacts') is not null then
    execute 'drop trigger if exists crm_contacts_audit on public.crm_contacts';
  end if;
  if to_regclass('public.crm_leads') is not null then
    execute 'drop trigger if exists crm_leads_audit on public.crm_leads';
  end if;
  if to_regclass('public.crm_activities') is not null then
    execute 'drop trigger if exists crm_activities_audit on public.crm_activities';
  end if;

  drop function if exists private.crm_audit();
  return dropped;
end;
$$;

comment on function public.repair_crm_audit_triggers() is
  'Drops leftover CRM audit triggers that write to the removed crm_audit_log. '
  'Job-file soft-delete must not require that table.';

revoke all on function public.repair_crm_audit_triggers() from public, anon, authenticated;
grant execute on function public.repair_crm_audit_triggers() to service_role;

select public.repair_crm_audit_triggers();
