#!/usr/bin/env bash
#
# Reproduces the Supabase Preview failure:
#   ERROR: relation "public.crm_accounts" does not exist (SQLSTATE 42P01)
#   drop trigger if exists crm_accounts_audit on public.crm_accounts
#
# Preview clones production after drop_old_product_tables removed crm_accounts.
# The Sept 1 trigger-drop migration must still apply.
#
# Usage:  supabase/tests/03_crm_audit_trigger_drop.sh [psql-connection-args...]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DROP_SQL="$HERE/../migrations/20260901010000_drop_crm_audit_triggers.sql"
INTAKE_SQL="$HERE/../migrations/20260901140000_intake_create_job_without_invitees.sql"
DB="${CRM_AUDIT_DROP_TEST_DB:-crm_audit_drop_test}"
PSQL=(psql "$@")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in roles (anon / authenticated / service_role)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema if not exists private;
SQL

echo "==> Apply drop_crm_audit_triggers with no CRM tables"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DROP_SQL"

echo "==> Recreate kept tables + leftover audit triggers"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists private;
create table public.crm_jobs (id uuid primary key);
create table public.crm_properties (id uuid primary key);
create function private.crm_audit()
returns trigger
language plpgsql
as $$
begin
  return coalesce(new, old);
end;
$$;
create trigger crm_jobs_audit
  after update on public.crm_jobs
  for each row execute function private.crm_audit();
create trigger crm_properties_audit
  after update on public.crm_properties
  for each row execute function private.crm_audit();
SQL

echo "==> Re-apply drop_crm_audit_triggers (tables present, crm_accounts absent)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DROP_SQL"

echo "==> Assert leftover writer is gone"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
do $$
begin
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname in ('crm_jobs', 'crm_properties')
       and t.tgname in ('crm_jobs_audit', 'crm_properties_audit')
       and not t.tgisinternal
  ) then
    raise exception 'audit triggers still present';
  end if;
  if to_regprocedure('private.crm_audit()') is not null then
    raise exception 'private.crm_audit() still present';
  end if;
end
$$;
SQL

echo "==> Recreate leftover triggers and call repair_crm_audit_triggers() (no crm_accounts)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create function private.crm_audit()
returns trigger
language plpgsql
as $$
begin
  return coalesce(new, old);
end;
$$;
create trigger crm_jobs_audit
  after update on public.crm_jobs
  for each row execute function private.crm_audit();
create trigger crm_properties_audit
  after update on public.crm_properties
  for each row execute function private.crm_audit();
SQL

awk '
  /^create or replace function public.intake_create_job_file\(/ { exit }
  { print }
' "$INTAKE_SQL" | "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB"

echo "==> Assert repair RPC dropped leftover triggers without crm_accounts"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
do $$
begin
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname in ('crm_jobs', 'crm_properties')
       and t.tgname in ('crm_jobs_audit', 'crm_properties_audit')
       and not t.tgisinternal
  ) then
    raise exception 'audit triggers still present after repair RPC';
  end if;
  if to_regprocedure('private.crm_audit()') is not null then
    raise exception 'private.crm_audit() still present after repair RPC';
  end if;
end
$$;
SQL

echo "==> Done. Trigger-drop migrations apply when crm_accounts is missing."
