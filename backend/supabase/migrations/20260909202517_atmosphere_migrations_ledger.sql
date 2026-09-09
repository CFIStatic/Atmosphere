-- Deploy ledger used by Atmosphere migrate.mjs / baseline flows.
-- Applied live earlier via Management API; this file aligns git with remote.

create table if not exists public.atmosphere_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user,
  baselined boolean not null default false
);

comment on table public.atmosphere_migrations is
  'Atmosphere deploy ledger: which migration versions were applied or baselined.';
