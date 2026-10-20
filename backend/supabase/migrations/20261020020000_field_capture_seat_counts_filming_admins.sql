-- ============================================================================
-- An owner or admin who films with Field Capture uses a Field Capture seat.
--
-- Until now a member only counted as a Field Capture seat by role (Employee /
-- field technician), a crew login (@field.atmosphere.app), or the "field_work"
-- intent picked at signup. A Global Admin who signed up as "exploring" and then
-- filmed jobs in Field Capture counted as 0 seats ("0 of 3 used").
--
-- Now a member also counts when they have filmed at least one clip in this
-- workspace through Field Capture: a job_proofs row (not hidden) on one of the
-- workspace's "Field Capture" job parties (trade = 'field_capture') carrying
-- the member's email. That is the party Field Capture opens for a signed-in member on a job
-- (routes/fieldApp.ts ensureFieldParty).
--
-- Platform seats still never count. Filming is never blocked by the seat limit;
-- an admin who starts filming on a full workspace shows as over the limit.
-- Mirrored in backend/src/lib/fieldCaptureSeats.ts (countFieldCaptureSeats).
-- Safe to re-run.
-- ============================================================================

create or replace function private.has_filmed_in_field_capture(p_org uuid, p_email text)
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(trim(p_email), '') <> ''
     and exists (
       select 1
       from public.job_parties pa
       join public.job_proofs jp on jp.party_id = pa.id
       where pa.org_id = p_org
         and pa.trade = 'field_capture'
         and lower(trim(pa.email)) = lower(trim(p_email))
         and jp.deleted_at is null
     );
$$;

revoke all on function private.has_filmed_in_field_capture(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.has_filmed_in_field_capture(uuid, text) to public;

create or replace function private.field_capture_seats_used(
  p_org uuid, p_exclude_user uuid default null, p_exclude_invite uuid default null
)
returns integer
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with counted_members as (
    select
      m.user_id,
      lower(trim(p.email)) as email,
      (
        private.is_field_capture_seat(m.role::text, p.email, m.usage_intents, m.seat_type)
        or (
          coalesce(m.seat_type, 'field_capture') <> 'platform'
          and private.has_filmed_in_field_capture(m.org_id, p.email)
        )
      ) as is_seat
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

-- When an admin who already films becomes a Field Capture seat by role or
-- intent too, they already hold their seat: don't refuse the change as if a
-- new seat were being added.
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
      v_was_seat := private.is_field_capture_seat(old.role::text, v_email, old.usage_intents, old.seat_type)
        or (
          coalesce(old.seat_type, 'field_capture') <> 'platform'
          and old.org_id = new.org_id
          and private.has_filmed_in_field_capture(old.org_id, v_email)
        );
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
