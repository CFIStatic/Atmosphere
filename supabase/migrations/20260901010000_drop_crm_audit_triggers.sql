-- Soft-delete of a job file updates public.crm_jobs. That still fires leftover
-- crm_jobs_audit → private.crm_audit() → insert into public.crm_audit_log.
-- The audit table was removed with the old CRM product, so delete fails with:
--   relation "public.crm_audit_log" does not exist
-- Drop the orphaned triggers and the writer. Job-file delete must succeed.
--
-- DROP TRIGGER IF EXISTS still requires the table. crm_accounts / contacts /
-- leads / activities were removed by drop_old_product_tables, so unguarded
-- drops fail preview with:
--   relation "public.crm_accounts" does not exist (SQLSTATE 42P01)

do $$
begin
  if to_regclass('public.crm_jobs') is not null then
    execute 'drop trigger if exists crm_jobs_audit on public.crm_jobs';
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
end
$$;

drop function if exists private.crm_audit();
