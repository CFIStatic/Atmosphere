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
-- Staff / member RPCs stay executable by `authenticated` because the BFF calls
-- them with the caller's JWT and the function itself checks auth.uid():
--   * analytics_* and admin_metering_analytics / admin_token_usage_analytics
--       Internal Growth Metrics. Each function reads analytics_staff for
--       auth.uid() and raises 42501 otherwise. service_role has a null
--       auth.uid(), so revoking authenticated would make the staff check
--       unreachable without rewriting the functions.
--   * customer_metering_summary, intake_create_job_file, billing_*,
--     record_token_usage, quote_usage, record_usage, org helpers, device
--     enroll, feature_heartbeat, record_memory_event, crew location.
--       Same pattern: user JWT plus an in-function membership, billing-manager,
--       or consent check. quote_usage is a price read with no auth.uid() check;
--       it stays authenticated because POST /api/usage/quote uses the user JWT.
--       Anon is still revoked.
--
-- Service role only (anon and authenticated revoked):
--   * calculate_metering_period, close_metering_period
--       Billing mutations / margin snapshot. customer_metering_summary (kept
--       for signed-in members) calls calculate_metering_period as the function
--       owner, so Settings usage does not need the caller to hold EXECUTE.
--       GET /api/metering/period and POST /api/metering/period/close use the
--       user JWT today and will fail until those routes pass the service role.
--       No product UI calls those two routes.
--   * record_ai_usage_event, register_billable_job
--       Ledger writes. record_ai_usage_event skips the membership check when
--       auth.uid() is null, so anon must not hold EXECUTE. No product UI calls
--       POST /api/metering/events or POST /api/metering/jobs.
--   * platform_admin_whoami — no application call site; staff identity for
--       analytics goes through analytics_whoami.
--   * network_*, sweep_expired_locations, stripe_*, record_payment, claim_*,
--     repair_*, backup_public_tables — already backend-only; reaffirmed here
--     so a fresh replay of earlier GRANTs cannot reopen them.
--
-- usage_events is a compatibility view over token_usage_events
-- (20260921120000). It was created without security_invoker, so it ran as the
-- owner (postgres) and PostgREST roles could read every org's ledger. Internal
-- Product & growth reads it from SECURITY DEFINER analytics RPCs, which run as
-- the owner and still see the rows after the view is switched to
-- security_invoker. Direct anon/authenticated grants are removed.

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
  -- User-JWT RPCs. In-function authz; BFF uses createUserClient.
  member_keep text[] := array[
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
    'billing_overview',
    'create_org',
    'credit_balance',
    'customer_metering_summary',
    'enroll_device',
    'feature_heartbeat',
    'intake_create_job_file',
    'join_org',
    'link_stripe_customer',
    'my_org_membership',
    'preview_org_by_join_code',
    'quote_usage',
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
  -- Backend service role only.
  service_only text[] := array[
    'backup_public_tables',
    'calculate_metering_period',
    'claim_job_proof_work',
    'claim_video_processing_job',
    'close_metering_period',
    'ensure_crm_audit_log',
    'network_contribute',
    'network_erase',
    'network_withdraw',
    'platform_admin_whoami',
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

  -- 3. Re-assert the user-JWT allowlist so a fresh replay and a database that
  --    had authenticated stripped still agree. Anon stays revoked.
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
-- view owner's. Analytics RPCs are SECURITY DEFINER and owned by a role that
-- can read token_usage_events, so Internal Product & growth summaries keep
-- working. Direct PostgREST reads by anon/authenticated do not.
alter view public.usage_events set (security_invoker = true);

revoke all on table public.usage_events from public, anon, authenticated;
grant select on table public.usage_events to service_role;

comment on view public.usage_events is
  'Compat alias over token_usage_events for growth analytics RPCs (security_invoker). Direct reads are service_role only; Internal summaries go through analytics_* / admin_* SECURITY DEFINER functions. Prefer token_usage_events for new code.';
