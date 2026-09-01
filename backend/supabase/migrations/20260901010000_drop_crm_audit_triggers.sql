-- Soft-delete of a job file updates public.crm_jobs. That still fires leftover
-- crm_jobs_audit → private.crm_audit() → insert into public.crm_audit_log.
-- The audit table was removed with the old CRM product, so delete fails with:
--   relation "public.crm_audit_log" does not exist
-- Drop the orphaned triggers and the writer. Job-file delete must succeed.

drop trigger if exists crm_jobs_audit on public.crm_jobs;
drop trigger if exists crm_properties_audit on public.crm_properties;
drop trigger if exists crm_accounts_audit on public.crm_accounts;
drop trigger if exists crm_contacts_audit on public.crm_contacts;
drop trigger if exists crm_leads_audit on public.crm_leads;
drop trigger if exists crm_activities_audit on public.crm_activities;

drop function if exists private.crm_audit();
