-- Restore the sold-path onboarding schema for fresh / preview / DR databases.
--
-- Production already applied 20260725171936 as a no-op checksum placeholder
-- (the live statements lived only on the hosted project). Changing that
-- version would fail the Supabase GitHub history check. This later, fully
-- idempotent migration creates the missing objects when they are absent and
-- is a no-op on production where orgs / org_members / create_org already exist.
--
-- Reconstructed from:
--   supabase/tests/00_local_stub.sql
--   later ALTERs (contractor_type, usage_intents, location_retention_hours)
--   BFF RPC contracts in backend/src/routes/org.ts and backend/src/field/officeLink.ts
--     create_org(p_name, p_role, p_work_type) → public.orgs
--     join_org(p_code, p_role, p_work_type) → public.orgs
--
-- Safe to re-run. Do not drop existing objects.

create extension if not exists pgcrypto;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.member_role as enum (
    'global_admin',
    'employee',
    'project_manager',
    'field_technician',
    'accountant',
    'office_manager',
    'sales'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_type as enum ('mitigation', 'construction');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text
);

create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.member_role not null,
  work_type  public.work_type not null,
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- No unique(user_id): later product work may allow two memberships. create_org
-- / join_org still refuse a second seat so a fresh env matches today's BFF.

-- ---------------------------------------------------------------------------
-- Membership helper + RPCs — created only when missing so production's live
-- function bodies (which this file reconstructs, not dumps) are left alone.
-- ---------------------------------------------------------------------------

create or replace function private.is_org_member(p_org uuid) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.org_members
    where org_id = p_org
      and user_id = auth.uid()
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_member(uuid) to service_role;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_org'
  ) then
    return;
  end if;

  execute $fn$
    create function public.create_org(
      p_name text,
      p_role public.member_role,
      p_work_type public.work_type
    ) returns public.orgs
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      v_uid uuid := auth.uid();
      v_org public.orgs;
      v_code text;
      v_tries int := 0;
    begin
      if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
      end if;

      if p_name is null or length(trim(p_name)) < 1 then
        raise exception 'organization name is required' using errcode = '22023';
      end if;

      if exists (select 1 from public.org_members where user_id = v_uid) then
        raise exception 'already a member of an organization' using errcode = '23505';
      end if;

      loop
        v_tries := v_tries + 1;
        v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        begin
          insert into public.orgs (name, join_code, created_by)
          values (trim(p_name), v_code, v_uid)
          returning * into v_org;
          exit;
        exception when unique_violation then
          if v_tries >= 8 then
            raise exception 'could not allocate a join code' using errcode = '23505';
          end if;
        end;
      end loop;

      insert into public.org_members (org_id, user_id, role, work_type, status)
      values (v_org.id, v_uid, p_role, p_work_type, 'active');

      insert into public.profiles (id)
      values (v_uid)
      on conflict (id) do nothing;

      return v_org;
    end;
    $body$;
  $fn$;

  revoke all on function public.create_org(text, public.member_role, public.work_type) from public, anon;
  grant execute on function public.create_org(text, public.member_role, public.work_type) to authenticated;
end $$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'join_org'
  ) then
    return;
  end if;

  execute $fn$
    create function public.join_org(
      p_code text,
      p_role public.member_role,
      p_work_type public.work_type
    ) returns public.orgs
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      v_uid uuid := auth.uid();
      v_org public.orgs;
    begin
      if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
      end if;

      select * into v_org
      from public.orgs
      where join_code = upper(trim(p_code));

      if not found then
        raise exception 'invalid join code' using errcode = 'P0002';
      end if;

      if exists (select 1 from public.org_members where user_id = v_uid) then
        raise exception 'already a member of an organization' using errcode = '23505';
      end if;

      insert into public.org_members (org_id, user_id, role, work_type, status)
      values (v_org.id, v_uid, p_role, p_work_type, 'active');

      insert into public.profiles (id)
      values (v_uid)
      on conflict (id) do nothing;

      return v_org;
    end;
    $body$;
  $fn$;

  revoke all on function public.join_org(text, public.member_role, public.work_type) from public, anon;
  grant execute on function public.join_org(text, public.member_role, public.work_type) to authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self'
  ) then
    create policy profiles_self on public.profiles
      for select to authenticated
      using (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'orgs' and policyname = 'orgs_member_select'
  ) then
    create policy orgs_member_select on public.orgs
      for select to authenticated
      using (private.is_org_member(id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_members' and policyname = 'org_members_member_select'
  ) then
    create policy org_members_member_select on public.org_members
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_members' and policyname = 'org_members_self_update'
  ) then
    create policy org_members_self_update on public.org_members
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

grant select on public.profiles, public.orgs, public.org_members to authenticated;
grant update (full_name, avatar_url, email) on public.profiles to authenticated;
grant update (role, work_type, status) on public.org_members to authenticated;

comment on table public.orgs is
  'Work Verification companies. Created by create_org during signup.';
comment on table public.org_members is
  'Office seats. Invited field workers use job_parties tokens, not this table.';
