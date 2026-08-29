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

update public.org_invites
set role = 'employee'
where role in (
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
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
