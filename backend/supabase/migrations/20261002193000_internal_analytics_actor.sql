-- Internal Growth Metrics calls reporting RPCs with the service role.
--
-- 20260923200000 revoked EXECUTE on analytics_* from authenticated and left
-- it with service_role only. Those functions still authorize with auth.uid(),
-- which is null for the service role, and the BFF was still calling them with
-- the staff user's JWT. PostgREST then returned SQLSTATE 42501 (permission
-- denied for function) before the body ran. The access probe mapped every
-- 42501 to "You do not have access to this report.", so an allowlisted owner
-- who already has an analytics_staff row was rejected on the sign-in page.
--
-- Do not grant these functions back to authenticated. A signed-in Platform
-- user must not be able to call the cross-org reports through the Data API.
-- The BFF sends the already-authenticated user id in the x-analytics-user-id
-- header on its service-role request. This helper trusts that header only
-- when the JWT role is service_role. A real user JWT keeps auth.uid() and
-- the header cannot impersonate someone else.
--
-- analytics_staff is still the allowlist. No row, no report.

create or replace function private.analytics_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers json;
  v_header text;
  v_role text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;

  v_role := coalesce(auth.jwt() ->> 'role', '');
  if v_role <> 'service_role' then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception
    when invalid_text_representation or data_exception then
      return null;
  end;

  if v_headers is null then
    return null;
  end if;

  v_header := nullif(btrim(coalesce(v_headers ->> 'x-analytics-user-id', '')), '');
  if v_header is null then
    return null;
  end if;

  begin
    return v_header::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke all on function private.analytics_actor() from public, anon, authenticated;

create or replace function private.analytics_scope()
returns public.analytics_scope
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.scope
  from public.analytics_staff s
  where s.user_id = private.analytics_actor();
$$;

create or replace function private.require_analytics(
  p_min public.analytics_scope default 'investor'
) returns public.analytics_scope
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope public.analytics_scope;
begin
  if private.analytics_actor() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_scope := private.analytics_scope();

  if v_scope is null then
    raise exception 'analytics_forbidden' using errcode = '42501';
  end if;
  if v_scope < p_min then
    raise exception 'analytics_scope_insufficient'
      using errcode = '42501', detail = format('have=%s need=%s', v_scope, p_min);
  end if;

  return v_scope;
end;
$$;

revoke all on function private.analytics_scope() from public, anon, authenticated;
revoke all on function private.require_analytics(public.analytics_scope) from public, anon, authenticated;

create or replace function public.analytics_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'scope', (
      select s.scope
      from public.analytics_staff s
      where s.user_id = private.analytics_actor()
    ),
    'display_name', (
      select s.display_name
      from public.analytics_staff s
      where s.user_id = private.analytics_actor()
    )
  );
$$;

-- Metering and token-usage reports check the staff row inline. Point those
-- checks at the same actor. Other analytics_* reports already call
-- private.require_analytics().
do $rewrite$
declare
  sig regprocedure;
  def text;
  old_check constant text := 'where user_id = auth.uid()';
  new_check constant text := 'where user_id = private.analytics_actor()';
begin
  foreach sig in array array[
    'public.admin_metering_analytics(timestamptz, timestamptz)'::regprocedure,
    'public.admin_token_usage_analytics(timestamptz, timestamptz)'::regprocedure
  ]
  loop
    def := pg_get_functiondef(sig);
    if position(old_check in def) = 0 then
      raise exception 'expected analytics_staff auth.uid() check in %', sig;
    end if;
    execute replace(def, old_check, new_check);
  end loop;
end
$rewrite$;

-- Stay service_role only. Authenticated Platform users are not granted
-- EXECUTE; invite-only access remains the analytics_staff row.
do $grants$
declare
  sig regprocedure;
begin
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_metering_analytics',
        'admin_token_usage_analytics',
        'analytics_account_detail',
        'analytics_accounts',
        'analytics_features',
        'analytics_monthly',
        'analytics_plan_mix',
        'analytics_retention',
        'analytics_summary',
        'analytics_whoami'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end
$grants$;
