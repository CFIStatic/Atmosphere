-- Remap live memberships onto Global Admin / Employee and lock billing to admin.

update public.org_members m
set role = 'global_admin'
where m.role::text = 'office_manager'
   or exists (
        select 1 from public.orgs o
        where o.id = m.org_id and o.created_by = m.user_id
      );

update public.org_members
set role = 'employee'
where role::text in (
  'project_manager',
  'field_technician',
  'accountant',
  'sales'
);

-- Pending office_manager invites keep the Global Admin seat that live members
-- of that role already received. Crew / books / sales invites become Employee.
update public.org_invites
set role = 'global_admin'
where role in ('office_manager', 'global_admin');

update public.org_invites
set role = 'employee'
where role in (
  'project_manager',
  'field_technician',
  'accountant',
  'sales'
);

alter table public.org_invites
  alter column role set default 'employee';

create or replace function private.can_manage_billing(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role::text in ('global_admin', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

comment on function private.can_manage_billing(uuid) is
  'True when the caller is the Global Admin (bill payer) for the org, or created it.';

-- Leftover product gates still compared raw member_role to the old enum.
-- After remap those values are gone; both product seats may manage org
-- credentials and books (billing stays admin-only above).
create or replace function private.estimator_can_manage_credentials(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role::text in (
        'global_admin',
        'employee',
        'office_manager',
        'project_manager',
        'field_technician',
        'accountant',
        'sales'
      )
  );
$$;

create or replace function private.can_manage_finance(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role::text in (
        'global_admin',
        'employee',
        'office_manager',
        'project_manager',
        'field_technician',
        'accountant',
        'sales'
      )
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

-- join_org / PATCH must not let a client mint the bill-payer seat. The first
-- member (create_org) keeps whatever they asked for. Later inserts become
-- Global Admin only when a pending admin invite matches their profile email.
create or replace function private.org_members_guard_product_seat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
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
  select exists (
    select 1 from public.org_invites i
    where i.org_id = new.org_id
      and i.status = 'pending'
      and v_email is not null
      and lower(i.email) = lower(v_email)
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

drop trigger if exists org_members_guard_product_seat on public.org_members;
create trigger org_members_guard_product_seat
  before insert or update of role on public.org_members
  for each row
  execute function private.org_members_guard_product_seat();
