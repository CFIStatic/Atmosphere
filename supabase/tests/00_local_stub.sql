-- Local stand-in for the parts of a Supabase project the migration builds on.
-- Test scaffolding only; never applied to a real project.
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase reads the subject out of the request JWT claims.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Existing Atmosphere schema (abridged to what the migration references).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  email text,
  full_name text
);

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null,
  created_at timestamptz not null default now()
);

do $$ begin
  create type public.member_role as enum
    ('project_manager','field_technician','accountant','office_manager','sales');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_type as enum ('mitigation','construction');
exception when duplicate_object then null; end $$;

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  user_id uuid not null references auth.users(id),
  role public.member_role not null,
  work_type public.work_type not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- The real project keeps its membership check in a private schema so the
-- org_members policy is not self-referential. Mirrored here so the test exercises
-- the same shape.
create schema if not exists private;
create or replace function private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create policy p_self on public.profiles for select to authenticated using (true);
create policy o_mine on public.orgs for select to authenticated using (private.is_member(orgs.id));
create policy m_mine on public.org_members for select to authenticated using (private.is_member(org_members.org_id));

grant select on public.profiles, public.orgs, public.org_members to authenticated;
