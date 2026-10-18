-- ============================================================================
-- Platform-only seats ($75/mo each, unlimited quantity).
--
-- A Platform seat is a member who works in platform.atmosphereteam.com with
-- Global Admin access (every job, file and setting) but:
--   - is never a Field Capture seat (and never counts toward chest mounts),
--   - is refused by the Field Capture app (app.atmosphereteam.com),
--   - does not see Billing and Usage (those are the owner's alone; see
--     20261018190000_billing_owner_only.sql).
--
-- seat_type defaults to 'field_capture', which keeps every existing row's
-- behavior exactly as it was (free Global Admins stay free and unlimited).
-- org_billing.platform_seats is how many Platform seats the workspace has
-- (paid on the Stripe subscription, or granted free on a comped workspace).
-- Safe to re-run.
-- ============================================================================

alter table public.org_members
  add column if not exists seat_type text not null default 'field_capture';
alter table public.org_invites
  add column if not exists seat_type text not null default 'field_capture';
alter table public.org_billing
  add column if not exists platform_seats integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_members_seat_type_check') then
    alter table public.org_members
      add constraint org_members_seat_type_check check (seat_type in ('field_capture', 'platform'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_invites_seat_type_check') then
    alter table public.org_invites
      add constraint org_invites_seat_type_check check (seat_type in ('field_capture', 'platform'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_billing_platform_seats_check') then
    alter table public.org_billing
      add constraint org_billing_platform_seats_check check (platform_seats >= 0);
  end if;
end $$;

-- A Platform seat is never a Field Capture seat, whatever its role, email or
-- signup intents say. The 3-argument form stays for anything that still calls it.
create or replace function private.is_field_capture_seat(
  p_role text, p_email text, p_usage_intents text[], p_seat_type text
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_seat_type, 'field_capture') <> 'platform'
     and private.is_field_capture_seat(p_role, p_email, p_usage_intents);
$$;

create or replace function private.field_capture_seats_used(
  p_org uuid, p_exclude_user uuid default null, p_exclude_invite uuid default null
)
returns integer
language sql
stable
as $$
  with counted_members as (
    select
      m.user_id,
      lower(trim(p.email)) as email,
      private.is_field_capture_seat(m.role::text, p.email, m.usage_intents, m.seat_type) as is_seat
    from public.org_members m
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org
      and (p_exclude_user is null or m.user_id <> p_exclude_user)
  )
  select
    (select count(*)::int from counted_members where is_seat)
    +
    (
      select count(*)::int
      from public.org_invites i
      where i.org_id = p_org
        and i.status = 'pending'
        and (p_exclude_invite is null or i.id <> p_exclude_invite)
        and private.is_field_capture_seat(i.role::text, i.email, null, i.seat_type)
        and not exists (
          select 1 from counted_members m
          where m.email is not null and m.email = lower(trim(i.email))
        )
    );
$$;

create or replace function private.enforce_field_capture_seat_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org uuid;
  v_used integer;
  v_allowed integer;
  v_is_seat boolean;
  v_was_seat boolean := false;
  v_email text;
begin
  if tg_table_name = 'org_members' then
    v_org := new.org_id;
    select email into v_email from public.profiles where id = new.user_id;
    v_is_seat := private.is_field_capture_seat(new.role::text, v_email, new.usage_intents, new.seat_type);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      select email into v_email from public.profiles where id = old.user_id;
      v_was_seat := private.is_field_capture_seat(old.role::text, v_email, old.usage_intents, old.seat_type);
      if v_was_seat then
        return new;
      end if;
    end if;
    perform pg_advisory_xact_lock(84215, hashtext(v_org::text));
    v_used := private.field_capture_seats_used(v_org, new.user_id, null);
  elsif tg_table_name = 'org_invites' then
    if new.status is distinct from 'pending' then
      return new;
    end if;
    v_org := new.org_id;
    v_is_seat := private.is_field_capture_seat(new.role::text, new.email, null, new.seat_type);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'pending'
       and private.is_field_capture_seat(old.role::text, old.email, null, old.seat_type) then
      return new;
    end if;
    perform pg_advisory_xact_lock(84215, hashtext(v_org::text));
    v_used := private.field_capture_seats_used(v_org, null, new.id);
  else
    return new;
  end if;

  v_allowed := private.field_capture_seats_allowed(v_org);
  if v_used >= v_allowed then
    raise exception 'fc_seat_limit'
      using errcode = 'P0001',
            hint = 'fc_seat_limit',
            detail = format('used=%s allowed=%s', v_used, v_allowed);
  end if;
  return new;
end;
$$;

-- Platform seats the workspace has. Comped and live subscriptions count; a
-- lapsed workspace has none (same rule as Field Capture seats).
create or replace function private.platform_seats_allowed(p_org uuid)
returns integer
language sql
stable
as $$
  select coalesce((
    select case
      when b.status::text in ('active', 'trialing', 'past_due', 'comped')
        then greatest(b.platform_seats, 0)
      else 0
    end
    from public.org_billing b
    where b.org_id = p_org
  ), 0);
$$;

create or replace function private.platform_seats_used(
  p_org uuid, p_exclude_user uuid default null, p_exclude_invite uuid default null
)
returns integer
language sql
stable
as $$
  with members as (
    select m.user_id, lower(trim(p.email)) as email, m.seat_type
    from public.org_members m
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org
      and (p_exclude_user is null or m.user_id <> p_exclude_user)
  )
  select
    (select count(*)::int from members where seat_type = 'platform')
    +
    (
      select count(*)::int
      from public.org_invites i
      where i.org_id = p_org
        and i.status = 'pending'
        and i.seat_type = 'platform'
        and (p_exclude_invite is null or i.id <> p_exclude_invite)
        and not exists (
          select 1 from members m
          where m.email is not null and m.email = lower(trim(i.email))
        )
    );
$$;

-- Invites: a Platform invite is always a Global Admin invite, and needs a free
-- Platform seat.
create or replace function private.org_invites_platform_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_used integer;
  v_allowed integer;
begin
  if new.seat_type is distinct from 'platform' then
    return new;
  end if;
  new.role := 'global_admin';
  if new.status is distinct from 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending' and old.seat_type = 'platform' then
    return new;
  end if;
  perform pg_advisory_xact_lock(84216, hashtext(new.org_id::text));
  v_used := private.platform_seats_used(new.org_id, null, new.id);
  v_allowed := private.platform_seats_allowed(new.org_id);
  if v_used >= v_allowed then
    raise exception 'platform_seat_limit'
      using errcode = 'P0001',
            hint = 'platform_seat_limit',
            detail = format('used=%s allowed=%s', v_used, v_allowed);
  end if;
  return new;
end;
$$;

-- Members: the seat type comes from the invite the person accepted, and only
-- the server (service role) may change it afterwards. A member cannot turn
-- their own Platform seat into a free Global Admin (or the reverse).
create or replace function private.org_members_platform_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text;
  v_phone text;
  v_is_server boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null;
  v_used integer;
  v_allowed integer;
begin
  if tg_op = 'INSERT' then
    if not v_is_server or new.seat_type is distinct from 'platform' then
      select p.email into v_email from public.profiles p where p.id = new.user_id;
      select nullif('+' || regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '+')
        into v_phone from auth.users u where u.id = new.user_id;
      new.seat_type := case when exists (
        select 1 from public.org_invites i
        where i.org_id = new.org_id
          and i.status = 'pending'
          and i.seat_type = 'platform'
          and (
            (v_email is not null and lower(i.email) = lower(v_email))
            or (v_phone is not null and i.phone = v_phone)
          )
      ) then 'platform' else 'field_capture' end;
    end if;
  elsif new.seat_type is distinct from old.seat_type and not v_is_server then
    raise exception 'seat_type_locked'
      using errcode = '42501', hint = 'Only the server can change a seat type.';
  end if;

  if new.seat_type = 'platform' then
    -- Platform seats see everything a Global Admin does.
    new.role := 'global_admin';
    if tg_op = 'INSERT' or old.seat_type is distinct from 'platform' then
      perform pg_advisory_xact_lock(84216, hashtext(new.org_id::text));
      -- The pending invite this member came from already holds the seat.
      v_used := private.platform_seats_used(new.org_id, new.user_id, null);
      if exists (
        select 1 from public.org_invites i
        where i.org_id = new.org_id and i.status = 'pending' and i.seat_type = 'platform'
          and (
            (v_email is not null and lower(i.email) = lower(v_email))
            or (v_phone is not null and i.phone = v_phone)
          )
      ) then
        v_used := v_used - 1;
      end if;
      v_allowed := private.platform_seats_allowed(new.org_id);
      if v_used >= v_allowed then
        raise exception 'platform_seat_limit'
          using errcode = 'P0001',
                hint = 'platform_seat_limit',
                detail = format('used=%s allowed=%s', v_used, v_allowed);
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists org_invites_platform_seat on public.org_invites;
create trigger org_invites_platform_seat
  before insert or update of seat_type, status, role on public.org_invites
  for each row execute function private.org_invites_platform_seat();

-- Fires after org_members_guard_product_seat (alphabetical) so the guard's
-- role decision is in place, and before org_members_seat_allowance.
drop trigger if exists org_members_platform_seat on public.org_members;
create trigger org_members_platform_seat
  before insert or update of seat_type, role on public.org_members
  for each row execute function private.org_members_platform_seat();

-- The Field Capture seat trigger must also re-check when seat_type changes.
drop trigger if exists org_members_seat_allowance on public.org_members;
create trigger org_members_seat_allowance
  before insert or update of role, usage_intents, seat_type on public.org_members
  for each row execute function private.enforce_field_capture_seat_limit();
drop trigger if exists org_invites_seat_allowance on public.org_invites;
create trigger org_invites_seat_allowance
  before insert or update of role, status, seat_type on public.org_invites
  for each row execute function private.enforce_field_capture_seat_limit();
