-- Restore EXECUTE on private.is_org_member for authenticated callers.
--
-- 20260727190000_mitigation_estimator.sql revoked ALL from public/anon/
-- authenticated and never re-granted. RLS policies and RPCs call this helper
-- as the signed-in user, so create_org / membership checks failed with:
--   permission denied for function is_org_member
--
-- Pattern matches private.estimator_is_org_member: revoke from public, then
-- grant only to authenticated (security definer still runs as owner).

revoke all on function private.is_org_member(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_member(uuid) to service_role;

-- Also expose a SECURITY DEFINER membership reader so the BFF can load the
-- caller's org without depending on RLS evaluating private.is_org_member
-- (belt-and-suspenders if grants drift again).

create or replace function public.my_org_membership()
returns table (
  role public.member_role,
  work_type public.work_type,
  usage_intents text[],
  status text,
  org_id uuid,
  org_name text,
  org_join_code text,
  org_contractor_type text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    m.role,
    m.work_type,
    coalesce(m.usage_intents, '{}'::text[]),
    m.status::text,
    o.id,
    o.name,
    o.join_code,
    o.contractor_type::text
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

revoke all on function public.my_org_membership() from public, anon;
grant execute on function public.my_org_membership() to authenticated;
grant execute on function public.my_org_membership() to service_role;
