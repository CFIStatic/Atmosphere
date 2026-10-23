-- ============================================================================
-- Permission roles, and every teammate gets both products.
--
-- PRODUCTS: every member has Field Capture AND Platform (seat_type
--   'field_capture', billed as one Field Capture seat). New invites can no
--   longer pick Platform only. seat_type stays the billing source of truth.
--
-- PERMISSION ROLE (free, not billed): org_members.permission_role in
--   (owner, admin, member, viewer); org_invites.permission_role in
--   (admin, member, viewer), default member.
--     owner  = orgs.created_by; everything including Billing and Usage
--     admin  = today's Global Admin powers, no billing
--     member = normal work
--     viewer = read-only (enforced by the API)
--   Only the owner or an admin can create an admin invite (enforced here).
--   org_members.role keeps its database meaning (owner and pre-existing
--   admins global_admin, everyone else employee), so a free "admin" can never
--   dodge the Field Capture seat count.
--
-- !! DATA BACKFILL ON PRODUCTION !!  (merging this PR applies it to prod;
--    needs the founder's OK)
--   1. Every org_members row gets permission_role, preserving today's access:
--        orgs.created_by                                   -> owner
--        role global_admin / office_manager (incl. Platform seats) -> admin
--        everyone else                                     -> member
--   2. Every member with seat_type 'platform' becomes 'field_capture' (gains
--      Field Capture). role is NOT changed, so these people (global_admin)
--      only count as a Field Capture seat once they film, as for any admin.
--      Billing impact: the Platform-seat count drops to 0; see the PR.
--   org_invites rows are not rewritten. A pending invite resolves to both
--   products and its permission role (default member) when it is accepted.
-- Safe to re-run.
-- ============================================================================

alter table public.org_members
  add column if not exists permission_role text not null default 'member';
alter table public.org_invites
  add column if not exists permission_role text not null default 'member';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_members_permission_role_check') then
    alter table public.org_members add constraint org_members_permission_role_check
      check (permission_role in ('owner', 'admin', 'member', 'viewer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_invites_permission_role_check') then
    alter table public.org_invites add constraint org_invites_permission_role_check
      check (permission_role in ('admin', 'member', 'viewer'));
  end if;
end $$;

-- ---- backfill (see header) -------------------------------------------------
alter table public.org_members disable trigger user;
update public.org_members m
set permission_role = case
    when o.created_by = m.user_id then 'owner'
    when m.role::text in ('global_admin', 'office_manager') then 'admin'
    else 'member'
  end
from public.orgs o
where o.id = m.org_id
  and m.permission_role = 'member'            -- only rows not yet backfilled
  and (o.created_by = m.user_id or m.role::text in ('global_admin', 'office_manager'));
update public.org_members set seat_type = 'field_capture' where seat_type = 'platform';
alter table public.org_members enable trigger user;

-- ---- helpers ---------------------------------------------------------------
create or replace function private.org_permission_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when exists (select 1 from public.orgs o where o.id = p_org and o.created_by = auth.uid()) then 'owner'
    else (select m.permission_role from public.org_members m
          where m.org_id = p_org and m.user_id = auth.uid() limit 1)
  end;
$$;
grant execute on function private.org_permission_role(uuid) to public;

-- Hidden / invite-only jobs: admins (permission role) see them like before.
CREATE OR REPLACE FUNCTION private.user_can_access_job(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.crm_jobs j
    where j.id = p_job_id
      and private.is_org_member(j.org_id)
      and (
        j.created_by = auth.uid()
        or exists (
          select 1 from public.job_assignments a
          where a.job_id = j.id and a.user_id = auth.uid() and a.released_at is null
        )
        or exists (
          select 1 from public.job_progress_grants g
          where g.job_id = j.id and g.user_id = auth.uid()
        )
        or exists (
          select 1 from public.org_members m
          where m.org_id = j.org_id
            and m.user_id = auth.uid()
            and (m.role::text in ('global_admin', 'owner', 'admin', 'office_manager')
                 or m.permission_role in ('owner', 'admin'))
        )
      )
  );
$function$;

-- ---- invites ---------------------------------------------------------------
-- No new Global Admin invites: admin is a permission role now.
create or replace function private.org_invites_admin_owner_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'pending'
     and new.role::text in ('global_admin', 'office_manager')
     and (
       tg_op = 'INSERT'
       or old.role::text not in ('global_admin', 'office_manager')
       or old.status is distinct from 'pending'
     ) then
    raise exception 'global_admin_owner_only'
      using hint = 'Only the account owner is owner. Invite them with the admin permission role instead.';
  end if;
  return new;
end;
$$;

-- Only the owner or an admin can hand out admin. Members can still write
-- org_invites directly (RLS allows any member), so this is checked here and
-- not only in the API.
create or replace function private.org_invites_permission_role_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_server boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null;
begin
  if not v_is_server
     and new.status = 'pending'
     and new.permission_role = 'admin'
     and (
       tg_op = 'INSERT'
       or old.permission_role is distinct from 'admin'
       or old.status is distinct from 'pending'
     )
     and coalesce(private.org_permission_role(new.org_id), '') not in ('owner', 'admin') then
    raise exception 'permission_role_admin_only'
      using errcode = '42501', hint = 'Only the owner or an admin can invite an admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists org_invites_permission_role_guard on public.org_invites;
create trigger org_invites_permission_role_guard
  before insert or update of permission_role, status on public.org_invites
  for each row execute function private.org_invites_permission_role_guard();

-- Every new invite is both products.
create or replace function private.org_invites_platform_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    new.seat_type := 'field_capture';
  end if;
  return new;
end;
$$;

-- ---- members ---------------------------------------------------------------
-- Role / permission guard (runs first, alphabetical). On INSERT the owner
-- (orgs.created_by, or the first member) is owner; everyone else takes the
-- permission role of their pending invite (default member) and database role
-- employee. Only the server changes permission_role afterwards; the owner
-- stays owner and nobody else becomes one; role can never be raised to admin.
create or replace function private.org_members_guard_product_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_phone text;
  v_is_server boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null;
  v_owner uuid;
  v_invite_role text;
begin
  select o.created_by into v_owner from public.orgs o where o.id = new.org_id;

  if tg_op = 'INSERT' then
    if v_owner = new.user_id
       or not exists (select 1 from public.org_members m where m.org_id = new.org_id) then
      new.permission_role := 'owner';
      return new;
    end if;
    select p.email into v_email from public.profiles p where p.id = new.user_id;
    select nullif('+' || regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '+')
      into v_phone from auth.users u where u.id = new.user_id;
    -- A legacy (pre-permission-role) Global Admin invite that was not a
    -- Platform seat keeps admin powers as permission role admin; a legacy
    -- Platform invite (forced global_admin) joins as a member.
    select case
             when i.permission_role = 'member'
                  and i.role::text in ('global_admin', 'office_manager')
                  and coalesce(i.seat_type, 'field_capture') <> 'platform' then 'admin'
             else i.permission_role
           end into v_invite_role
    from public.org_invites i
    where i.org_id = new.org_id and i.status = 'pending'
      and ((v_email is not null and lower(i.email) = lower(v_email))
           or (v_phone is not null and i.phone = v_phone))
    order by i.created_at desc
    limit 1;
    if not v_is_server or new.permission_role is null
       or new.permission_role = 'owner' or new.permission_role = 'member' then
      new.permission_role := coalesce(v_invite_role, 'member');
    end if;
    new.role := 'employee';
    return new;
  end if;

  -- UPDATE
  if not v_is_server and new.permission_role is distinct from old.permission_role then
    raise exception 'permission_role_locked'
      using errcode = '42501', hint = 'Only the server can change permission roles.';
  end if;
  if new.permission_role = 'owner' and old.permission_role is distinct from 'owner'
     and new.user_id is distinct from v_owner then
    raise exception 'owner_role_reserved'
      using errcode = '42501', hint = 'Only the account owner is owner.';
  end if;
  if old.permission_role = 'owner' and new.permission_role is distinct from 'owner' then
    raise exception 'owner_role_reserved'
      using errcode = '42501', hint = 'The account owner stays owner.';
  end if;
  if new.role::text in ('global_admin', 'office_manager')
     and old.role::text not in ('global_admin', 'office_manager') then
    new.role := 'employee';
  end if;
  return new;
end;
$$;

drop trigger if exists org_members_guard_product_seat on public.org_members;
create trigger org_members_guard_product_seat
  before insert or update of role, permission_role on public.org_members
  for each row execute function private.org_members_guard_product_seat();

-- Every member, including one accepting a pending Platform-only invite, has
-- both products. Nobody but the server changes seat_type.
create or replace function private.org_members_platform_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_is_server boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    new.seat_type := 'field_capture';
  elsif new.seat_type is distinct from old.seat_type and not v_is_server then
    raise exception 'seat_type_locked'
      using errcode = '42501', hint = 'Only the server can change a seat type.';
  end if;
  return new;
end;
$$;
