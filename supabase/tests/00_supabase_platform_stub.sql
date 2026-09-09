-- Local stand-in for the Supabase-managed schemas that migrations build on but
-- do not create: `storage`, and the CLI's own `schema_migrations` table.
--
-- Applied after 00_local_stub.sql (which covers auth, orgs, profiles) by
-- backend/scripts/migration-manifest.mjs, so the whole migration set can be
-- replayed against a throwaway Postgres.
--
-- Test scaffolding only. Never applied to a real Supabase project — Supabase
-- owns these objects and its versions differ.

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Storage path helpers. Policies in the migrations call these to scope an
-- object to an org or job folder.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

create or replace function storage.filename(name text) returns text
language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
$$;

create or replace function storage.extension(name text) returns text
language sql immutable as $$
  select split_part(storage.filename(name), '.', 2);
$$;

-- The Supabase CLI's ledger. One migration hardens RLS on it, so it has to
-- exist before that migration runs.
create table if not exists public.schema_migrations (
  version     text primary key,
  inserted_at timestamptz not null default now()
);
