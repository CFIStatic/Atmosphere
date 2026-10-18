-- Lock down what a signed-in user can do with their own Supabase access token.
--
-- The browser and the iPhone app both hold the user's Supabase access token and
-- the publishable key, so anything granted to `authenticated` can be called
-- straight against PostgREST, skipping the BFF. This closes the holes that let
-- that bypass the app:
--
-- 1. Workspace membership. `org_members_insert_self` let any signed-in user add
--    themselves to ANY workspace (they only needed its id), and the two
--    self-update policies let a member rewrite their own row, including
--    `org_id`. Membership is created by create_org / join_org (SECURITY DEFINER,
--    owned by postgres) and by the server (service role), so neither needs a
--    client policy. The one legitimate self-edit (PATCH /api/org/me: account
--    type, kind of work, usage intents) keeps working through a column-level
--    grant on exactly those three columns. The existing triggers still guard
--    the role (no self-promotion to Global Admin) and the seat limits.
--
-- 2. Billing and usage writers. `set_billing_plan` activated a paid plan with
--    no payment; `set_billing_settings`, `record_usage`, `record_token_usage`
--    and `link_stripe_customer` wrote billing/usage state directly. They are
--    now server-only (service role). The BFF already checks the caller (owner
--    middleware); the *_as wrappers let it call the owner-checked functions
--    on the caller's behalf so the database still enforces "owner only".
--
-- 2b. Joining a workspace. Seats after the owner are invite-only, and the BFF
--    checks for a pending invite before it calls join_org. But join_org was
--    callable with any user token: anyone holding (or guessing: 8 hex chars)
--    a workspace's join code could join it, as a role of their choosing,
--    with no invite. It is now server-only; join_org_as runs it as the
--    invited user. preview_org_by_join_code (unused by the app) was an
--    oracle for guessing codes and goes server-only too.
--
-- 3. Member-writable limits. Any member (an Employee included) could rewrite
--    their workspace's verification AI budget (0 = no cap), the guest evidence
--    download fee, the evidence retention policy and the media quotas. Nothing
--    in the app writes these with a user token; reads stay as they are.
--
-- 4. `open_finance_share` belonged to the removed finance product. Its tables
--    are gone, so it can only error; it was still callable without signing in.
--
-- Additive for the server: the service role keeps every privilege it had.
--
-- Rollout: this file only revokes what the live BFF does not call with a user
-- token in production, so it can be applied before the code that uses the
-- *_as wrappers deploys. 20261018230200_revoke_user_token_rpcs.sql revokes
-- the rest (join_org, set_billing_settings, record_token_usage,
-- link_stripe_customer) and must be applied once that code is live.

-- 1. org_members -------------------------------------------------------------
drop policy if exists org_members_insert_self on public.org_members;
drop policy if exists org_members_update_self on public.org_members;
drop policy if exists org_members_self_update on public.org_members;

drop policy if exists org_members_update_own_settings on public.org_members;
create policy org_members_update_own_settings on public.org_members
  as permissive for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Table-wide write privileges go; SELECT stays (RLS still scopes it, and other
-- tables' policies read org_members in subqueries, also as anon).
revoke insert, update, delete, truncate, references, trigger on public.org_members from anon, authenticated;
grant update (role, work_type, usage_intents) on public.org_members to authenticated;

-- 2. Billing and usage writers -----------------------------------------------
revoke execute on function public.set_billing_plan(uuid, text, public.billing_interval, integer) from public, anon, authenticated;
grant execute on function public.set_billing_plan(uuid, text, public.billing_interval, integer) to service_role;


revoke execute on function public.record_usage(uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) to service_role;



-- Run owner/member-checked functions as the signed-in user the BFF has
-- already authenticated. Service role only: the server is trusted to pass the
-- session user id (never a request-body value). The claims are restored after
-- the call so nothing else in the request runs as that user.
create or replace function private.act_as_begin(p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev jsonb := jsonb_build_object(
    'claims', current_setting('request.jwt.claims', true),
    'sub', current_setting('request.jwt.claim.sub', true),
    'role', current_setting('request.jwt.claim.role', true));
begin
  if p_actor is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  -- Legacy per-claim settings win over request.jwt.claims in auth.uid() /
  -- auth.role(); override them only when the request actually set them.
  if coalesce(v_prev ->> 'sub', '') <> '' then
    perform set_config('request.jwt.claim.sub', p_actor::text, true);
  end if;
  if coalesce(v_prev ->> 'role', '') <> '' then
    perform set_config('request.jwt.claim.role', 'authenticated', true);
  end if;
  return v_prev;
end $$;

create or replace function private.act_as_end(p_prev jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_prev ->> 'claims', ''), true);
  if coalesce(p_prev ->> 'sub', '') <> '' then
    perform set_config('request.jwt.claim.sub', p_prev ->> 'sub', true);
  end if;
  if coalesce(p_prev ->> 'role', '') <> '' then
    perform set_config('request.jwt.claim.role', p_prev ->> 'role', true);
  end if;
end $$;

revoke all on function private.act_as_begin(uuid) from public, anon, authenticated;
revoke all on function private.act_as_end(jsonb) from public, anon, authenticated;

create or replace function public.set_billing_plan_as(
  p_actor uuid, p_org uuid, p_plan text,
  p_interval public.billing_interval default 'monthly'::public.billing_interval,
  p_seats integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_prev jsonb; v_out jsonb;
begin
  v_prev := private.act_as_begin(p_actor);
  v_out := public.set_billing_plan(p_org, p_plan, p_interval, p_seats);
  perform private.act_as_end(v_prev);
  return v_out;
end $$;

create or replace function public.set_billing_settings_as(
  p_actor uuid, p_org uuid,
  p_auto_reload_enabled boolean default null,
  p_auto_reload_threshold bigint default null,
  p_auto_reload_amount bigint default null,
  p_monthly_spend_limit bigint default null,
  p_clear_spend_limit boolean default false)
returns public.org_billing
language plpgsql
security definer
set search_path = ''
as $$
declare v_prev jsonb; v_out public.org_billing;
begin
  v_prev := private.act_as_begin(p_actor);
  v_out := public.set_billing_settings(p_org, p_auto_reload_enabled, p_auto_reload_threshold,
    p_auto_reload_amount, p_monthly_spend_limit, p_clear_spend_limit);
  perform private.act_as_end(v_prev);
  return v_out;
end $$;

create or replace function public.record_usage_as(
  p_actor uuid, p_org uuid, p_model_id text, p_request_id text,
  p_input_tokens bigint default 0, p_output_tokens bigint default 0,
  p_cache_write_5m_tokens bigint default 0, p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens bigint default 0, p_is_batch boolean default false,
  p_feature text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_prev jsonb; v_out jsonb;
begin
  v_prev := private.act_as_begin(p_actor);
  v_out := public.record_usage(p_org, p_model_id, p_request_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch, p_feature);
  perform private.act_as_end(v_prev);
  return v_out;
end $$;

revoke all on function public.set_billing_plan_as(uuid, uuid, text, public.billing_interval, integer) from public, anon, authenticated;
grant execute on function public.set_billing_plan_as(uuid, uuid, text, public.billing_interval, integer) to service_role;
revoke all on function public.set_billing_settings_as(uuid, uuid, boolean, bigint, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_billing_settings_as(uuid, uuid, boolean, bigint, bigint, bigint, boolean) to service_role;
revoke all on function public.record_usage_as(uuid, uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.record_usage_as(uuid, uuid, text, text, bigint, bigint, bigint, bigint, bigint, boolean, text) to service_role;

-- 2b. Joining a workspace ----------------------------------------------------
revoke execute on function public.preview_org_by_join_code(text) from public, anon, authenticated;
grant execute on function public.preview_org_by_join_code(text) to service_role;

create or replace function public.join_org_as(
  p_actor uuid, p_code text, p_role public.member_role, p_work_type public.work_type)
returns public.orgs
language plpgsql
security definer
set search_path = ''
as $$
declare v_prev jsonb; v_out public.orgs;
begin
  v_prev := private.act_as_begin(p_actor);
  v_out := public.join_org(p_code, p_role, p_work_type);
  perform private.act_as_end(v_prev);
  return v_out;
end $$;

revoke all on function public.join_org_as(uuid, text, public.member_role, public.work_type) from public, anon, authenticated;
grant execute on function public.join_org_as(uuid, text, public.member_role, public.work_type) to service_role;

-- 3. Member-writable limits (reads unchanged) ---------------------------------
drop policy if exists verification_usage_limits_insert on public.verification_usage_limits;
drop policy if exists verification_usage_limits_update on public.verification_usage_limits;
drop policy if exists evidence_download_policy_write on public.evidence_download_policy;
drop policy if exists job_evidence_policy_write on public.job_evidence_policy;
drop policy if exists org_media_quotas_write_member on public.org_media_quotas;
revoke insert, update, delete, truncate on public.verification_usage_limits, public.evidence_download_policy,
  public.job_evidence_policy, public.org_media_quotas from anon, authenticated;

-- 4. Removed finance product --------------------------------------------------
drop function if exists public.open_finance_share(text);
