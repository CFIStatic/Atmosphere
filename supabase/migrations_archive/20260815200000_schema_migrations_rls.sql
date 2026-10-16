-- Advisor: "RLS Disabled in Public" on public.schema_migrations.
-- This is not a product table; lock it so anon/authenticated cannot touch it.

alter table public.schema_migrations enable row level security;
alter table public.schema_migrations force row level security;

revoke all on table public.schema_migrations from anon, authenticated;
grant all on table public.schema_migrations to service_role;
grant all on table public.schema_migrations to postgres;

comment on table public.schema_migrations is
  'Internal migration ledger (if used). RLS on; no client policies — service_role only.';
