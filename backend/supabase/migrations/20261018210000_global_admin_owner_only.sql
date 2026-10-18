-- One Global Admin per workspace: the account owner who pays (orgs.created_by).
--
-- Nobody else can be invited as Global Admin. A pending admin invite was the
-- only way a member could reach the role (org_members_guard_product_seat
-- promotes a member only when one exists), so refusing new admin invites
-- closes every path, including direct PostgREST writes.
--
-- A Platform seat keeps role global_admin in the database (that is how it gets
-- admin visibility); it is not a Global Admin and is still allowed.
--
-- Additive: existing rows are not touched. Production had no pending admin
-- invites and no admins besides the owners when this shipped.

create or replace function private.org_invites_admin_owner_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'pending'
     and new.role::text in ('global_admin', 'office_manager')
     and coalesce(new.seat_type, 'field_capture') <> 'platform' then
    raise exception 'global_admin_owner_only'
      using hint = 'Only the account owner is Global Admin. Invite them as Field Capture or Platform instead.';
  end if;
  return new;
end;
$$;


-- Fires before org_invites_platform_seat (alphabetical); a Platform invite
-- already carries seat_type = 'platform' from the caller.
drop trigger if exists org_invites_admin_owner_only on public.org_invites;
create trigger org_invites_admin_owner_only
  before insert or update of role, status, seat_type on public.org_invites
  for each row execute function private.org_invites_admin_owner_only();
