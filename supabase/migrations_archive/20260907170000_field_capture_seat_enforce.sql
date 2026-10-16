-- Atomically enforce Field Capture seat allowance (3 + extra_fc_seats)
-- on org_members and org_invites inserts. Concurrent join-code / invite
-- races cannot mint unpaid seats.
-- Railway does not run migrations on boot; apply via
-- backend/scripts/applyFieldCaptureSeatEnforce.mjs on deploy.

create or replace function private.is_field_capture_seat(
  p_role text,
  p_email text,
  p_usage_intents text[]
) returns boolean
language sql
immutable
as $$
  select
    coalesce(lower(p_email), '') like '%@field.atmosphere.app'
    or coalesce(p_role, '') in (
      'employee', 'field_technician', 'project_manager', 'accountant', 'sales'
    )
    or coalesce(p_usage_intents, '{}'::text[]) @> array['field_work']::text[];
$$;

create or replace function private.field_capture_seats_allowed(p_org uuid)
returns integer
language plpgsql
stable
as $$
declare
  v_status text;
  v_extra integer := 0;
begin
  begin
    select b.status::text, coalesce(b.extra_fc_seats, 0)
      into v_status, v_extra
    from public.org_billing b
    where b.org_id = p_org;
  exception
    when undefined_column then
      select b.status::text into v_status
      from public.org_billing b
      where b.org_id = p_org;
      v_extra := 0;
  end;
  if not found then
    return 3;
  end if;
  if v_status is null or v_status in ('active', 'trialing', 'past_due', 'comped') then
    return 3 + greatest(v_extra, 0);
  end if;
  return 0;
end;
$$;

create or replace function private.field_capture_seats_used(
  p_org uuid,
  p_exclude_user uuid default null,
  p_exclude_invite uuid default null
) returns integer
language sql
stable
as $$
  with counted_members as (
    select
      m.user_id,
      lower(trim(p.email)) as email,
      private.is_field_capture_seat(m.role::text, p.email, m.usage_intents) as is_seat
    from public.org_members m
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org
      and (p_exclude_user is null or m.user_id <> p_exclude_user)
  )
  select
    (
      select count(*)::int from counted_members where is_seat
    )
    +
    (
      select count(*)::int
      from public.org_invites i
      where i.org_id = p_org
        and i.status = 'pending'
        and (p_exclude_invite is null or i.id <> p_exclude_invite)
        and private.is_field_capture_seat(i.role::text, i.email, null)
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
    v_is_seat := private.is_field_capture_seat(new.role::text, v_email, new.usage_intents);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      select email into v_email from public.profiles where id = old.user_id;
      v_was_seat := private.is_field_capture_seat(old.role::text, v_email, old.usage_intents);
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
    v_is_seat := private.is_field_capture_seat(new.role::text, new.email, null);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'pending'
       and private.is_field_capture_seat(old.role::text, old.email, null) then
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

-- Name sorts after org_members_guard_product_seat so remapped roles are checked.
drop trigger if exists org_members_seat_allowance on public.org_members;
create trigger org_members_seat_allowance
  before insert or update of role, usage_intents on public.org_members
  for each row execute function private.enforce_field_capture_seat_limit();

drop trigger if exists org_invites_seat_allowance on public.org_invites;
create trigger org_invites_seat_allowance
  before insert or update of role, status on public.org_invites
  for each row execute function private.enforce_field_capture_seat_limit();
