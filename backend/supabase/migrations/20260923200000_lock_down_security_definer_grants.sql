-- Lock down PostgREST access to SECURITY DEFINER functions and the
-- usage_events compatibility view.
--
-- Supabase grants EXECUTE on new public functions to anon, authenticated, and
-- service_role by default. `revoke ... from public` does not remove the anon
-- or authenticated grants, so several definer RPCs stayed callable from
-- /rest/v1/rpc without a session. This migration is the explicit allowlist.
--
-- Kept callable without a session (anon), on purpose:
--   * device_lookup, device_verify_pin
--       Field Capture device unlock runs before there is a user JWT. The
--       device id plus the device secret hash (and, for verify, the PIN hash)
--       is the credential. See 20260725191548_device_pin_credentials.sql.
--   * open_finance_share
--       Share-link open. The caller presents only the token; the function
--       hashes it and rejects missing, revoked, expired, or exhausted links.
--   * record_unsubscribe
--       Public email unsubscribe (CAN-SPAM). The token is the only input and
--       an unknown token still returns true, so the RPC is not an existence
--       oracle. The BFF route is unauthenticated.
--
-- Service role only (REVOKE from public, anon, and authenticated). This matches
-- the grants already applied on project Atmosphere (ccxatzfsvzetciiwsjlj):
--   * admin_metering_analytics, admin_token_usage_analytics
--   * analytics_account_detail, analytics_accounts, analytics_features,
--     analytics_monthly, analytics_plan_mix, analytics_retention,
--     analytics_summary, analytics_whoami
--   * calculate_metering_period, close_metering_period
--   * platform_admin_whoami
--     These function bodies still consult auth.uid() / analytics_staff. A
--     service_role call has a null uid, so EXECUTE alone does not make Internal
--     Growth Metrics succeed until the BFF is pointed at a path that satisfies
--     that check. The grants here do not put authenticated back.
--   * record_ai_usage_event
--       Old predicate was "not a member AND auth.uid() IS NOT NULL", so anon
--       (null uid) was not rejected. The body now requires org membership or
--       the service role. EXECUTE is service_role only. POST /api/metering/events
--       uses the user JWT and will fail until it uses the service role.
--   * register_billable_job, quote_usage, intake_create_job_file,
--     customer_metering_summary
--       Anon revoked. Authenticated revoked as well so a fresh replay matches
--       production (service_role only). quote_usage has no auth.uid() check.
--       intake_create_job_file and customer_metering_summary do check membership,
--       but production does not grant them to authenticated. Job create falls
--       back to stepwise inserts when the RPC is denied. Settings billing
--       catches a missing metering summary.
--   * network_erase — no authz; deletes a pooled email. service_role only.
--     network_contribute / network_withdraw likewise have no caller check.
--   * sweep_expired_locations, stripe_*, record_payment, claim_*, repair_*,
--     backup_public_tables — backend-only; reaffirmed so earlier GRANTs cannot
--     reopen them.
--
-- Signed-in product RPCs keep `authenticated` (anon still revoked). The BFF
-- calls them with the user JWT and the function checks auth.uid(), membership,
-- or billing-manager: billing_overview, credit_balance, set_billing_plan,
-- set_billing_settings, link_stripe_customer, record_token_usage, record_usage,
-- create_org, join_org, org helpers, enroll_device, feature_heartbeat,
-- record_memory_event, record_crew_location, stop_sharing_location.
-- record_crew_location / stop_sharing_location key off auth.uid(); an anon
-- grant was only the platform default.
--
-- usage_events is a compatibility view over token_usage_events
-- (20260921120000). It was created without security_invoker, so it ran as the
-- owner (postgres) and any role with SELECT saw every org's ledger. It is now
-- security_invoker, and SELECT is limited to service_role. A security-definer
-- function owned by a role that can read token_usage_events still can.

-- record_ai_usage_event: reject anon. The previous guard skipped the check
-- whenever auth.uid() was null, which is exactly the anon and unauthenticated
-- case. Membership or the service role is required. Privileges are tightened
-- in the grant block below (service_role only).
create or replace function public.record_ai_usage_event(
  p_org uuid,
  p_idempotency_key text,
  p_action_type text,
  p_provider text default null,
  p_model text default null,
  p_user_id uuid default null,
  p_job_id uuid default null,
  p_workflow_id text default null,
  p_agent_run_id text default null,
  p_agent_type text default null,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_cached_input_tokens bigint default 0,
  p_reasoning_tokens bigint default 0,
  p_image_count integer default 0,
  p_video_seconds numeric default 0,
  p_audio_seconds numeric default 0,
  p_ocr_pages integer default 0,
  p_embedding_tokens bigint default 0,
  p_third_party_cost_nanos bigint default 0,
  p_other_variable_cost_nanos bigint default 0,
  p_billable boolean default true,
  p_metadata jsonb default '{}'::jsonb,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_existing private.ai_usage_events%rowtype;
  v_pricing private.ai_model_pricing;
  v_cost_nanos bigint;
  v_cu_rate numeric;
  v_compute_units numeric;
  v_row private.ai_usage_events%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_existing
  from private.ai_usage_events
  where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'eventId', v_existing.id,
      'duplicate', true,
      'estimatedProviderCostNanos', v_existing.estimated_provider_cost_nanos,
      'computeUnits', v_existing.compute_units
    );
  end if;

  if p_provider is not null and p_model is not null then
    select * into v_pricing from private.resolve_ai_model_pricing(p_provider, p_model, p_at);
  end if;

  v_cost_nanos := private.estimate_ai_cost_nanos(
    v_pricing, p_input_tokens, p_output_tokens, p_cached_input_tokens,
    p_reasoning_tokens, p_image_count, p_video_seconds, p_audio_seconds,
    p_ocr_pages, p_embedding_tokens, p_third_party_cost_nanos, p_other_variable_cost_nanos
  );

  v_cu_rate := coalesce(private.resolve_compute_unit_rate(p_at), 0.01);
  v_compute_units := round((v_cost_nanos::numeric / 1000000000.0) / v_cu_rate, 6);

  insert into private.ai_usage_events (
    org_id, user_id, job_id, workflow_id, agent_run_id, agent_type, action_type,
    provider, model,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
    image_count, video_seconds, audio_seconds, ocr_pages, embedding_tokens,
    third_party_cost_nanos, other_variable_cost_nanos,
    estimated_provider_cost_nanos, compute_units, compute_unit_rate_usd,
    billable, idempotency_key, metadata, created_at
  ) values (
    p_org, p_user_id, p_job_id, p_workflow_id, p_agent_run_id, p_agent_type, p_action_type,
    p_provider, p_model,
    p_input_tokens, p_output_tokens, p_cached_input_tokens, p_reasoning_tokens,
    p_image_count, p_video_seconds, p_audio_seconds, p_ocr_pages, p_embedding_tokens,
    p_third_party_cost_nanos, p_other_variable_cost_nanos,
    v_cost_nanos, v_compute_units, v_cu_rate,
    p_billable, p_idempotency_key, p_metadata, coalesce(p_at, now())
  )
  returning * into v_row;

  return jsonb_build_object(
    'eventId', v_row.id,
    'duplicate', false,
    'estimatedProviderCostNanos', v_row.estimated_provider_cost_nanos,
    'computeUnits', v_row.compute_units
  );
end;
$$;

do $lock$
declare
  sig regprocedure;
  -- Intentional unauthenticated RPCs. See header.
  anon_keep text[] := array[
    'device_lookup',
    'device_verify_pin',
    'open_finance_share',
    'record_unsubscribe'
  ];
  -- User-JWT RPCs that production still grants to authenticated.
  -- Anon is revoked. Do not add staff/admin analytics here.
  member_keep text[] := array[
    'billing_overview',
    'create_org',
    'credit_balance',
    'enroll_device',
    'feature_heartbeat',
    'join_org',
    'link_stripe_customer',
    'my_org_membership',
    'preview_org_by_join_code',
    'record_crew_location',
    'record_memory_event',
    'record_token_usage',
    'record_usage',
    'revoke_my_devices',
    'set_billing_plan',
    'set_billing_settings',
    'set_org_contractor_type',
    'stop_sharing_location'
  ];
  -- Backend service role only. Includes the revokes already applied live.
  service_only text[] := array[
    'admin_metering_analytics',
    'admin_token_usage_analytics',
    'analytics_account_detail',
    'analytics_accounts',
    'analytics_experiments',
    'analytics_features',
    'analytics_monthly',
    'analytics_plan_mix',
    'analytics_retention',
    'analytics_summary',
    'analytics_whoami',
    'backup_public_tables',
    'calculate_metering_period',
    'claim_job_proof_work',
    'claim_video_processing_job',
    'close_metering_period',
    'customer_metering_summary',
    'ensure_crm_audit_log',
    'intake_create_job_file',
    'network_contribute',
    'network_erase',
    'network_withdraw',
    'platform_admin_whoami',
    'quote_usage',
    'record_ai_usage_event',
    'record_payment',
    'register_billable_job',
    'repair_crm_audit_triggers',
    'repair_memory_job_fk',
    'stripe_cancel_subscription',
    'stripe_event_forget',
    'stripe_event_seen',
    'stripe_sync_subscription',
    'sweep_expired_locations'
  ];
begin
  -- 1. Drop anon (and the PUBLIC pseudo-role) from every public SECURITY
  --    DEFINER function that is not an intentional unauthenticated RPC.
  --    record_crew_location / stop_sharing_location key off auth.uid(); an
  --    anon grant was only the platform default, not a product path.
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname <> all (anon_keep)
  loop
    execute format('revoke all on function %s from public, anon', sig);
  end loop;

  -- 2. Service-role-only functions: signed-in users must not call them via
  --    PostgREST either. Missing names (dropped or never created) are skipped.
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any (service_only)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;

  -- 3. Re-assert authenticated only for product RPCs that production still
  --    exposes to signed-in users. Anon stays revoked. Staff analytics and
  --    metering-close are not in this list.
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any (member_keep)
  loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;

  -- 4. Intentional public RPCs. PUBLIC is revoked so only the named roles hold
  --    EXECUTE; anon is required for the pre-login / token flows above.
  for sig in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any (anon_keep)
  loop
    execute format('revoke all on function %s from public', sig);
    execute format(
      'grant execute on function %s to anon, authenticated, service_role',
      sig
    );
  end loop;
end
$lock$;

-- Compat view: enforce the querying role's privileges and RLS instead of the
-- view owner's. Direct PostgREST reads by anon/authenticated are removed.
-- Security-definer functions that already can read token_usage_events still can.
alter view public.usage_events set (security_invoker = true);

revoke all on table public.usage_events from public, anon, authenticated;
grant select on table public.usage_events to service_role;

comment on view public.usage_events is
  'Compat alias over token_usage_events (security_invoker). SELECT is service_role only, so PostgREST anon/authenticated cannot read every org ledger. Prefer token_usage_events for new code.';
