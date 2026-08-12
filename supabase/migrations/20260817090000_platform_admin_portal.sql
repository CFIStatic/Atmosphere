-- ============================================================================
-- Atmosphere Internal Admin Portal
-- ----------------------------------------------------------------------------
-- Company-wide support access, separate from customer org membership and from
-- growth analytics (analytics_staff).
--
--   1. platform_staff     — allow-list of Atmosphere employees + scope
--   2. platform_admin_audit — immutable log of every support action
--   3. platform_admin_whoami() — non-throwing probe for the app shell
--
-- Cross-org reads/writes for support run through the BFF with the service role
-- AFTER requirePlatformStaff. The database allow-list is still the door: without
-- a platform_staff row the middleware 403s and no service-role path is taken.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Access control
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_staff_scope') then
    -- Ordered enum: ops > admin > support, so a single >= comparison works.
    create type public.platform_staff_scope as enum ('support', 'admin', 'ops');
  end if;
end $$;

create table if not exists public.platform_staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  scope        public.platform_staff_scope not null default 'support',
  display_name text,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

alter table public.platform_staff enable row level security;

-- Grantees may confirm their own access (UI needs it). Granting is service-role
-- only — there is no self-service path into global customer support.
drop policy if exists platform_staff_select_self on public.platform_staff;
create policy platform_staff_select_self on public.platform_staff
  for select using (user_id = auth.uid());

create or replace function private.platform_staff_scope()
returns public.platform_staff_scope
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.scope from public.platform_staff s where s.user_id = auth.uid();
$$;

create or replace function private.require_platform_staff(
  p_min public.platform_staff_scope default 'support'
) returns public.platform_staff_scope
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_scope public.platform_staff_scope;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_scope := private.platform_staff_scope();

  if v_scope is null then
    raise exception 'platform_admin_forbidden' using errcode = '42501';
  end if;
  if v_scope < p_min then
    raise exception 'platform_admin_scope_insufficient'
      using errcode = '42501', detail = format('have=%s need=%s', v_scope, p_min);
  end if;

  return v_scope;
end;
$$;

/**
 * Non-throwing probe used by the app shell: returns the caller's scope, or a
 * null scope for everyone else.
 */
create or replace function public.platform_admin_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'scope', (select s.scope from public.platform_staff s where s.user_id = auth.uid()),
    'display_name', (select s.display_name from public.platform_staff s where s.user_id = auth.uid())
  );
$$;

revoke all on function public.platform_admin_whoami() from public, anon;
grant execute on function public.platform_admin_whoami() to authenticated;
grant execute on function public.platform_admin_whoami() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Immutable audit log for support actions
-- ---------------------------------------------------------------------------

create table if not exists public.platform_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  actor_email   text,
  action        text not null,
  target_type   text,
  target_id     text,
  org_id        uuid references public.orgs(id) on delete set null,
  detail        jsonb not null default '{}'::jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists platform_admin_audit_created_at_idx
  on public.platform_admin_audit (created_at desc);

create index if not exists platform_admin_audit_actor_idx
  on public.platform_admin_audit (actor_user_id, created_at desc);

create index if not exists platform_admin_audit_org_idx
  on public.platform_admin_audit (org_id, created_at desc)
  where org_id is not null;

alter table public.platform_admin_audit enable row level security;

-- Staff with any platform scope may read the audit trail. Inserts are
-- service-role only (BFF writes after every support action).
drop policy if exists platform_admin_audit_select_staff on public.platform_admin_audit;
create policy platform_admin_audit_select_staff on public.platform_admin_audit
  for select using (private.platform_staff_scope() is not null);

comment on table public.platform_staff is
  'Atmosphere company staff allow-list for the internal /admin support portal.';
comment on table public.platform_admin_audit is
  'Immutable log of every action taken in the internal admin portal.';
