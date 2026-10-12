-- ============================================================================
-- Phone-number invites for crew without email.
--
-- org_invites gains an E.164 phone column; an invite carries an email, a
-- phone, or both. One live invite per phone per org, like email. The seat
-- guard also honors a pending admin invite matched by the joiner's verified
-- auth phone. Seat counting is unchanged: a pending crew invite still holds a
-- Field Capture seat, and the API marks it joined when the person joins.
-- Safe to re-run.
-- ============================================================================

alter table public.org_invites
  add column if not exists phone text;

alter table public.org_invites
  alter column email drop not null;

alter table public.org_invites
  drop constraint if exists org_invites_phone_e164;
alter table public.org_invites
  add constraint org_invites_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

alter table public.org_invites
  drop constraint if exists org_invites_email_or_phone;
alter table public.org_invites
  add constraint org_invites_email_or_phone
  check (email is not null or phone is not null);

create unique index if not exists org_invites_live_phone_unique
  on public.org_invites (org_id, phone)
  where status = 'pending' and phone is not null;

create or replace function private.org_members_guard_product_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_phone text;
  v_has_admin_invite boolean;
begin
  if TG_OP = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;

  if TG_OP = 'INSERT' and not exists (
    select 1 from public.org_members m where m.org_id = new.org_id
  ) then
    return new;
  end if;

  select p.email into v_email from public.profiles p where p.id = new.user_id;
  select nullif('+' || regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '+')
    into v_phone from auth.users u where u.id = new.user_id;
  select exists (
    select 1 from public.org_invites i
    where i.org_id = new.org_id
      and i.status = 'pending'
      and (
        (v_email is not null and lower(i.email) = lower(v_email))
        or (v_phone is not null and i.phone = v_phone)
      )
      and i.role in ('global_admin', 'office_manager')
  ) into v_has_admin_invite;

  if TG_OP = 'INSERT' then
    if v_has_admin_invite then
      new.role := 'global_admin';
    else
      new.role := 'employee';
    end if;
    return new;
  end if;

  if new.role::text in ('global_admin', 'office_manager')
     and old.role::text not in ('global_admin', 'office_manager') then
    new.role := 'employee';
  end if;
  return new;
end;
$$;

