-- Pin search_path on the functions Supabase's security advisor flags as
-- "role mutable search_path" (43 at 2026-10-18, two of them overloads of
-- private.is_field_capture_seat).
--
-- No behavior change: every one of these bodies already schema-qualifies the
-- tables and functions it touches (checked against production), and they only
-- use built-ins otherwise. Pinning the path just stops a caller's search_path
-- from changing what an unqualified name resolves to.
--
-- Written as a loop over pg_proc so it applies to every overload present and
-- skips anything a given database does not have (local replays, staging).
-- A later `create or replace` of one of these without a SET clause drops the
-- setting again, so new versions should carry `set search_path` themselves.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
    'memory.changed_fields',
    'memory.reject_mutation',
    'memory.stamp_job_lifecycle',
    'memory.stamp_task_completion',
    'memory.touch_updated_at',
    'private.crm_account_merges_append_only',
    'private.dataset_versions_protect_released',
    'private.episode_annotations_append_only',
    'private.episode_verifications_append_only',
    'private.estimate_ai_cost_nanos',
    'private.evidence_downloads_settle_once',
    'private.field_capture_seats_allowed',
    'private.field_capture_seats_used',
    'private.freeze_ownership',
    'private.human_review_decisions_append_only',
    'private.is_field_capture_seat',
    'private.job_briefs_append_only',
    'private.job_evidence_access_append_only',
    'private.job_location_no_cycle',
    'private.job_messages_append_only',
    'private.job_proof_questions_append_only',
    'private.job_proofs_forbid_destroy',
    'private.legal_append_only',
    'private.legal_holds_guard',
    'private.legal_vault_guard',
    'private.llm_verification_runs_append_only',
    'private.media_objects_forbid_destroy',
    'private.mirror_append_only',
    'private.platform_seats_allowed',
    'private.platform_seats_used',
    'private.purchase_order_events_append_only',
    'private.purchase_order_lines_frozen',
    'private.purchase_order_transition',
    'private.touch_updated_at',
    'private.usd_to_nanos',
    'private.verification_audit_append_only',
    'public.app_connectors_touch_updated_at',
    'public.audit_install_bridges',
    'public.classify_token_feature',
    'public.is_poolable_address',
    'public.network_block_erased',
    'public.touch_updated_at'
    )
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
  end loop;
end $$;
