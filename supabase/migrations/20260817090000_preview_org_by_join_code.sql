-- Field Capture (and the website join step) need to confirm a join code
-- before attaching a login to an office. Return only the organization name —
-- the code is already the secret, and the name is what the crew reads back.

create or replace function public.preview_org_by_join_code(p_code text)
returns table (name text, join_code text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select o.name, o.join_code
  from public.orgs o
  where o.join_code = upper(trim(p_code))
  limit 1;
$$;

revoke all on function public.preview_org_by_join_code(text) from public, anon;
grant execute on function public.preview_org_by_join_code(text) to authenticated;
grant execute on function public.preview_org_by_join_code(text) to service_role;
