-- atmosphere:squashed-baseline
-- Squashed history: the whole production schema as of 2026-10-15, replacing the
-- 220 hand-applied migrations now kept in supabase/migrations_archive/ (they
-- could not replay from scratch). A fresh database is built from this file plus
-- every migration after it. backend/scripts/migrate.mjs records this file as
-- already applied (without running it) on a database that already has a ledger.
-- Atmosphere schema baseline, introspected from production 2026-10-15 (schema only, no data).

set check_function_bodies = off;

create schema if not exists private;

create schema if not exists memory;

create extension if not exists "uuid-ossp" with schema extensions;

create extension if not exists pgcrypto with schema extensions;

create extension if not exists vector with schema public;

create extension if not exists pg_stat_statements with schema extensions;

-- supabase_vault ships with every Supabase project; guarded so the same file
-- also replays on a plain Postgres in CI (where the extension is not installed).
do $ext$ begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault with schema vault;
  end if;
end $ext$;

do $t$ begin create type public.member_role as enum ('project_manager','field_technician','accountant','office_manager','sales','global_admin','employee'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_type as enum ('mitigation','construction'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.billing_interval as enum ('monthly','annual'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.subscription_status as enum ('active','trialing','past_due','canceled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.credit_bucket as enum ('plan','purchased','promotional'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.ledger_entry_type as enum ('plan_grant','purchase','usage','refund','expiration','adjustment'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.purchase_status as enum ('pending','completed','failed','refunded'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.analytics_scope as enum ('investor','internal'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.job_proof_phase as enum ('before','after'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.job_proof_state as enum ('uploaded','checked','analysed','accepted','rejected'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.media_kind as enum ('proof_video','proof_frame','field_day_video','twin_mesh','scope_doc','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.media_tier as enum ('hot','warm','cold'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.media_state as enum ('pending_upload','ready','failed','deleted'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.media_backend as enum ('supabase','s3','memory'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_account_type as enum ('insurance_carrier','property_management','general_contractor','referral_partner','vendor','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_contact_type as enum ('homeowner','tenant','adjuster','agent','property_manager','vendor','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_lead_source as enum ('referral','insurance_carrier','web','phone','repeat_customer','marketing','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_lead_status as enum ('new','contacted','qualified','estimate_sent','won','lost'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_job_status as enum ('draft','scheduled','in_progress','on_hold','completed','invoiced','paid','cancelled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_loss_type as enum ('water','fire','mold','storm','biohazard','contents','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_activity_kind as enum ('note','call','email','sms','meeting','site_visit','task','status_change','system'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.job_scope_state as enum ('included','excluded','proposed','approved','declined'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.job_evidence_category as enum ('before','after','condition','issue','completion','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.job_evidence_action as enum ('uploaded','viewed','downloaded','analysed','accepted','rejected','held','released','shared','deleted','duplicated'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.billing_period_status as enum ('open','closed','invoiced'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.metering_alert_kind as enum ('expensive_job','expensive_run','runaway_loop','rapid_tokens','unexpected_video','usage_threshold','margin_below'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_location_kind as enum ('site','building','floor','zone','room','surface','assembly'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.verification_video_status as enum ('uploaded','queued','processing','completed','failed','needs_review','cancelled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.verification_processing_stage as enum ('validate_video','extract_metadata','extract_frames','score_frame_quality','deduplicate_frames','classify_scenes','analyze_frames','compare_timeline','generate_verifications','calculate_confidence','finalize_report','transcode_video','llm_verify_evidence','generate_verified_events','update_project_graph','privacy_scan','evaluate_dataset_eligibility','create_dataset_examples'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.verification_step_status as enum ('pending','running','completed','failed','skipped','cancelled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.verification_result_status as enum ('verified','likely_verified','uncertain','contradicted','rejected','human_verified','needs_review','partially_verified'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.human_review_status as enum ('open','in_progress','approved','rejected','edited','cancelled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.rights_category as enum ('operational_only','internal_improvement','evaluation_allowed','training_allowed','restricted','pending_review','revoked'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.privacy_status as enum ('unknown','pending','clear','findings_present','redacted','export_safe','blocked','review_required'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.dataset_version_status as enum ('draft','validating','ready','released','deprecated','revoked'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.dataset_split as enum ('train','validation','test','benchmark','holdout','private_evaluation'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_source_kind as enum ('rest','csv','webhook','manual'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_sync_status as enum ('running','succeeded','failed','partial'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.backup_scope as enum ('org','platform'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.backup_kind as enum ('scheduled','manual','pre_migration'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.backup_status as enum ('running','completed','failed','expired'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.prospect_status as enum ('new','saved','contacted','converted','discarded'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.suppression_kind as enum ('email','phone','domain'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_campaign_status as enum ('draft','active','paused','finished'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_campaign_channel as enum ('email','call','mixed'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_campaign_trigger as enum ('manual','weather','seasonal'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_send_state as enum ('queued','sent','failed','blocked','bounced','complained'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.crm_account_link_kind as enum ('insures','manages','owns','subcontracts_to','refers','vendor_to','related'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_episode_status as enum ('planned','in_progress','complete','partial','complete_with_exception','failed','unverifiable','needs_human_review'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_data_rights as enum ('job_only','org_analytics','licensable'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_consent_state as enum ('granted','declined','not_asked'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.work_observation_phase as enum ('existing_condition','in_progress','pre_conceal','complete','verification','failure','rework'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.platform_staff_scope as enum ('support','admin','ops'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.legal_hold_kind as enum ('subpoena','lawsuit','preservation','investigation','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.legal_hold_status as enum ('open','released'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.legal_subject_type as enum ('org','user','job','proof','media'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.legal_vault_source as enum ('job_proof','media_object'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.token_usage_feature as enum ('video_analysis','chat','ask','web_search','computer','other'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.safety_incident_category as enum ('fall_person_down','physical_violence','verbal_threat','medical_distress','other_emergency','silent_panic_wellness'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.safety_incident_severity as enum ('watch','critical'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.safety_incident_status as enum ('open','acknowledged','dismissed'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.safety_recommended_action as enum ('monitor','dispatch_help','contact_authorities'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.safety_incident_source as enum ('live_sample','upload_chunk','post_upload','transcript','wellness_heartbeat','live_stream'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.daily_job_report_status as enum ('pending','sent','skipped','failed'); exception when duplicate_object then null; end $t$;

create sequence if not exists public.org_billing_events_id_seq;

create table if not exists public.profiles (id uuid not null, email text, full_name text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, avatar_url text, service_role text, service_role_custom text, handle text);

create table if not exists public.orgs (id uuid not null, name text not null, join_code text not null, created_by uuid, created_at timestamp with time zone not null, contractor_type text, location_retention_hours integer not null, safety_auto_escalate_to_authorities boolean not null, safety_alert_webhook_url text, safety_alert_emails text[] not null, wellness_check_enabled boolean not null, wellness_no_motion_seconds integer not null, wellness_critical_after_seconds integer not null, wellness_require_alone boolean not null, daily_job_report_enabled boolean not null, daily_job_report_timezone text not null, daily_job_report_channel text not null, daily_job_report_send_hour integer not null, daily_job_report_extra_emails text[] not null, child_blur_enabled boolean not null, safety_live_enabled boolean not null, exclude_from_analytics boolean not null, analytics_exclusion_reason text);

create table if not exists public.org_members (id uuid not null, org_id uuid not null, user_id uuid not null, role member_role not null, work_type work_type not null, status text not null, created_at timestamp with time zone not null, usage_intents text[] not null);

create table if not exists public.device_credentials (id uuid not null, user_id uuid not null, secret_hash text not null, pin_hash text not null, pin_salt text not null, failed_attempts integer not null, lockouts integer not null, locked_until timestamp with time zone, label text, created_at timestamp with time zone not null, last_used_at timestamp with time zone);

create table if not exists private.model_costs (model_id text not null, display_name text not null, family text not null, provider text not null, input_cost_per_mtok numeric(12,6) not null, output_cost_per_mtok numeric(12,6) not null, cache_write_5m_multiplier numeric(6,4) not null, cache_write_1h_multiplier numeric(6,4) not null, cache_read_multiplier numeric(6,4) not null, batch_multiplier numeric(6,4) not null, markup numeric(6,4) not null, context_window integer, max_output_tokens integer, is_active boolean not null, sort_order integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, price_source_url text, price_verified_at date);

create table if not exists public.billing_plans (code text not null, name text not null, tagline text, monthly_price_cents integer not null, annual_price_cents integer, included_credits_nanos bigint not null, per_seat boolean not null, min_seats integer not null, rate_multiplier numeric(6,2) not null, features jsonb not null, is_contact_sales boolean not null, is_active boolean not null, sort_order integer not null, stripe_price_id_monthly text, stripe_price_id_annual text);

create table if not exists public.org_billing (org_id uuid not null, plan_code text not null, billing_interval billing_interval not null, seats integer not null, status subscription_status not null, period_start timestamp with time zone not null, period_end timestamp with time zone not null, cancel_at_period_end boolean not null, auto_reload_enabled boolean not null, auto_reload_threshold_nanos bigint not null, auto_reload_amount_nanos bigint not null, monthly_spend_limit_nanos bigint, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, stripe_customer_id text, stripe_subscription_id text, extra_fc_seats integer not null, atmosphere_plan_code text not null, included_fc_seats integer not null, stripe_mrr_cents integer, stripe_interval text, stripe_livemode boolean, stripe_amount_synced_at timestamp with time zone);

create table if not exists public.payments (id uuid not null, org_id uuid not null, kind text not null, status text not null, amount_cents integer not null, currency text not null, description text, stripe_payment_intent_id text, stripe_invoice_id text, stripe_charge_id text, receipt_url text, hosted_invoice_url text, invoice_pdf_url text, receipt_email text, card_brand text, card_last4 text, purchase_id uuid, period_start timestamp with time zone, period_end timestamp with time zone, failure_reason text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, tax_cents integer, livemode boolean);

create table if not exists private.stripe_events (id text not null, type text not null, received_at timestamp with time zone not null);

create table if not exists public.analytics_staff (user_id uuid not null, scope analytics_scope not null, display_name text, note text, created_at timestamp with time zone not null, created_by uuid);

create table if not exists public.feature_catalog (key text not null, label text not null, area text not null, description text, is_active boolean not null, sort_order integer not null);

create table if not exists public.feature_usage_sessions (id uuid not null, org_id uuid not null, user_id uuid not null, feature_key text not null, client text not null, started_at timestamp with time zone not null, last_seen_at timestamp with time zone not null, active_ms bigint not null, interactions integer not null);

create table if not exists public.feature_usage_daily (day date not null, org_id uuid not null, feature_key text not null, sessions integer not null, active_ms bigint not null, interactions bigint not null);

create table if not exists public.org_billing_events (id bigint not null, org_id uuid not null, effective_at timestamp with time zone not null, plan_code text not null, billing_interval billing_interval not null, seats integer not null, status subscription_status not null, mrr_cents integer not null, source text not null, atmosphere_plan_code text, fc_seats integer);

create table if not exists public.jobs (id uuid not null, org_id uuid not null, seq_no integer not null, job_number text not null, name text not null, description text, work_type text not null, loss_type text, status text not null, priority text not null, customer_name text, customer_phone text, customer_email text, address_line1 text, city text, state text, postal_code text, claim_number text, lead_id uuid, scheduled_for timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, created_by uuid not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.job_tasks (id uuid not null, org_id uuid not null, job_id uuid not null, title text not null, details text, status text not null, priority text not null, assigned_to uuid, due_at timestamp with time zone, "position" integer not null, completed_at timestamp with time zone, completed_by uuid, created_by uuid not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.job_assignments (id uuid not null, org_id uuid not null, job_id uuid not null, user_id uuid not null, role_on_job text not null, assigned_by uuid not null, assigned_at timestamp with time zone not null, released_at timestamp with time zone, updated_at timestamp with time zone not null);

create table if not exists public.work_logs (id uuid not null, org_id uuid not null, job_id uuid not null, task_id uuid, kind text not null, body text not null, minutes integer, occurred_at timestamp with time zone not null, author_id uuid not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.memory_events (id uuid not null, seq bigint generated always as identity not null, org_id uuid not null, actor_id uuid, actor_email text, actor_role text, event_type text not null, entity_type text not null, entity_id uuid, job_id uuid, summary text not null, changes jsonb not null, snapshot jsonb, source text not null, occurred_at timestamp with time zone not null);

create table if not exists public.schema_migrations (name text not null, applied_at bigint);

create table if not exists public.media_objects (id uuid not null, org_id uuid not null, kind media_kind not null, duration_seconds numeric(10,2), byte_size bigint, content_hash text, content_type text, has_audio boolean, backend media_backend not null, bucket text not null, object_key text not null, tier media_tier not null, state media_state not null, ref_type text, ref_id text, retention_until timestamp with time zone, legal_hold boolean not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, deleted_at timestamp with time zone, deleted_by uuid);

create table if not exists public.org_media_quotas (org_id uuid not null, max_hot_bytes bigint, max_total_bytes bigint, max_ingest_seconds_per_day bigint, max_object_bytes bigint, updated_at timestamp with time zone not null);

create table if not exists public.media_upload_sessions (id uuid not null, org_id uuid not null, media_id uuid not null, expected_byte_size bigint, expected_duration_seconds numeric(10,2), content_type text not null, upload_url text, multipart jsonb, expires_at timestamp with time zone not null, created_at timestamp with time zone not null);

create table if not exists public.crm_counters (id uuid not null, org_id uuid not null, name text not null, value bigint not null);

create table if not exists public.crm_properties (id uuid not null, org_id uuid not null, account_id uuid, primary_contact_id uuid, label text, address_line1 text not null, address_line2 text, city text, region text, postal_code text, country text not null, latitude numeric(9,6), longitude numeric(9,6), property_type text, year_built integer, square_feet integer, access_notes text, is_archived boolean not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.crm_jobs (id uuid not null, org_id uuid not null, job_number bigint, lead_id uuid, contact_id uuid, account_id uuid, property_id uuid, owner_id uuid, work_type work_type not null, loss_type crm_loss_type, status crm_job_status not null, priority smallint not null, title text not null, description text, carrier_account_id uuid, adjuster_contact_id uuid, claim_number text, policy_number text, deductible numeric(12,2), loss_date date, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, actual_start timestamp with time zone, actual_end timestamp with time zone, contract_amount numeric(12,2), invoiced_amount numeric(12,2) not null, paid_amount numeric(12,2) not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, deleted_at timestamp with time zone, deleted_by uuid);

create table if not exists public.job_parties (id uuid not null, org_id uuid not null, job_id uuid not null, company text not null, trade text, contact_name text, email text, phone text, role text not null, access_token text not null, invited_at timestamp with time zone, last_seen_at timestamp with time zone, revoked_at timestamp with time zone, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, service_role text, service_role_custom text);

create table if not exists public.job_briefs (id uuid not null, org_id uuid not null, job_id uuid not null, revision integer not null, facts jsonb not null, note text, created_by uuid, created_at timestamp with time zone not null);

create table if not exists public.job_scope_items (id uuid not null, org_id uuid not null, job_id uuid not null, party_id uuid, state job_scope_state not null, title text not null, detail text, amount numeric(12,2), reason text, revision integer not null, decided_by uuid, decided_at timestamp with time zone, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, source_document_id uuid);

create table if not exists public.job_acknowledgements (id uuid not null, org_id uuid not null, job_id uuid not null, party_id uuid not null, revision integer not null, acknowledged_name text, acknowledged_at timestamp with time zone not null);

create table if not exists public.job_messages (id uuid not null, org_id uuid not null, job_id uuid not null, author_id uuid, party_id uuid, author_label text not null, body text not null, scope_item_id uuid, is_decision boolean not null, created_at timestamp with time zone not null);

create table if not exists public.job_proofs (id uuid not null, org_id uuid not null, job_id uuid not null, party_id uuid not null, work_date date not null, phase job_proof_phase not null, storage_path text not null, byte_size bigint, duration_seconds numeric(8,2), content_hash text, captured_at timestamp with time zone, received_at timestamp with time zone not null, lat double precision, lon double precision, accuracy_m double precision, state job_proof_state not null, checks jsonb not null, ai_summary text, ai_findings jsonb, ai_model text, decided_by uuid, decided_at timestamp with time zone, decided_note text, created_at timestamp with time zone not null, category job_evidence_category, title text, tags text[] not null, retention_until date, legal_hold boolean not null, hold_reason text, analysis_status text, analysis_error text, analysis_attempts integer not null, analysed_at timestamp with time zone, ai_material_change text, narration jsonb, narration_text text, narration_status text, narration_error text, narrated_at timestamp with time zone, labels text[] not null, actions jsonb not null, deleted_at timestamp with time zone, deleted_by uuid, transcript_status text, transcript_text text, transcript_error text, transcribed_at timestamp with time zone, narration_lease_owner text, narration_lease_until timestamp with time zone, transcript_lease_owner text, transcript_lease_until timestamp with time zone, analysis_lease_owner text, analysis_lease_until timestamp with time zone, device_metadata jsonb not null, clip_id text, scheduled_purge_at timestamp with time zone, custom_title text, transcript_segments jsonb, transcript_words jsonb, summary_status text, summary_transcript_sha256 text, summary_generated_at timestamp with time zone, summary_error text, summary_lease_until timestamp with time zone, ai_budget_hold boolean not null, ai_budget_hold_reason text, first_analysed_at timestamp with time zone);

create table if not exists public.job_proof_frames (id uuid not null, org_id uuid not null, proof_id uuid not null, at_seconds numeric(8,2) not null, storage_path text not null, created_at timestamp with time zone not null);

create table if not exists public.job_proof_questions (id uuid not null, org_id uuid not null, job_id uuid not null, question text not null, answer text, model text, grounded_on jsonb not null, asked_by uuid, created_at timestamp with time zone not null, thread_id uuid, web_sources jsonb not null, research_trace jsonb, office_only boolean not null, document_ids uuid[] not null, supersedes_id uuid);

create table if not exists public.job_evidence_access (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid, action job_evidence_action not null, actor_id uuid, party_id uuid, actor_label text not null, actor_role text, detail text, occurred_at timestamp with time zone not null);

create table if not exists public.job_evidence_policy (org_id uuid not null, keep_years jsonb not null, auto_purge boolean not null, updated_at timestamp with time zone not null);

create table if not exists public.verifier_shares (id uuid not null, org_id uuid not null, job_id uuid not null, label text not null, access_token text not null, created_by uuid, created_at timestamp with time zone not null, expires_at timestamp with time zone, revoked_at timestamp with time zone, last_opened_at timestamp with time zone, open_count integer not null, recipient_email text, share_kind text not null);

create table if not exists public.field_identities (id uuid not null, channel text not null, address text not null, display_name text, verified_at timestamp with time zone not null, last_seen_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.field_identity_codes (id uuid not null, channel text not null, address text not null, code_hash text not null, party_id uuid not null, attempts smallint not null, expires_at timestamp with time zone not null, consumed_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.job_party_claims (id uuid not null, org_id uuid not null, party_id uuid not null, identity_id uuid not null, claimed_at timestamp with time zone not null);

create table if not exists public.field_sessions (id uuid not null, identity_id uuid not null, token_hash text not null, created_at timestamp with time zone not null, last_used_at timestamp with time zone, expires_at timestamp with time zone not null, revoked_at timestamp with time zone);

create table if not exists public.job_intake (job_id uuid not null, org_id uuid not null, source text not null, source_detail jsonb not null, entered_by uuid, entered_at timestamp with time zone not null);

create table if not exists public.scope_documents (id uuid not null, org_id uuid not null, job_id uuid not null, filename text not null, media_type text not null, byte_size bigint, content_hash text, storage_path text not null, status text not null, extracted jsonb, extraction_error text, model text, uploaded_by uuid, confirmed_by uuid, confirmed_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.job_proof_segments (id uuid not null, org_id uuid not null, proof_id uuid not null, idx integer not null, start_seconds numeric(10,2) not null, end_seconds numeric(10,2) not null, frame_count integer not null, reading jsonb, model text, created_at timestamp with time zone not null);

create table if not exists public.evidence_download_policy (org_id uuid not null, download_fee_cents integer not null, updated_at timestamp with time zone not null);

create table if not exists public.evidence_downloads (id uuid not null, org_id uuid not null, proof_id uuid not null, share_id uuid, requested_by uuid not null, requester_email text not null, fee_cents integer not null, status text not null, paid_via text, paid_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.org_invites (id uuid not null, org_id uuid not null, email text, role text not null, note text, status text not null, invited_by uuid, created_at timestamp with time zone not null, joined_at timestamp with time zone, revoked_at timestamp with time zone, service_role text, service_role_custom text, phone text);

create table if not exists private.ai_model_pricing (id uuid not null, provider text not null, model text not null, input_token_price_usd numeric(18,12) not null, output_token_price_usd numeric(18,12) not null, cached_input_token_price_usd numeric(18,12), image_price_usd numeric(18,12), video_second_price_usd numeric(18,12), audio_second_price_usd numeric(18,12), ocr_page_price_usd numeric(18,12), embedding_token_price_usd numeric(18,12), effective_from timestamp with time zone not null, effective_to timestamp with time zone, is_active boolean not null, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists private.compute_unit_config (id uuid not null, usd_per_compute_unit numeric(18,12) not null, effective_from timestamp with time zone not null, effective_to timestamp with time zone, is_active boolean not null, note text, created_at timestamp with time zone not null);

create table if not exists private.ai_usage_events (id uuid not null, org_id uuid not null, user_id uuid, job_id uuid, workflow_id text, agent_run_id text, agent_type text, action_type text not null, provider text, model text, input_tokens bigint not null, output_tokens bigint not null, cached_input_tokens bigint not null, reasoning_tokens bigint not null, image_count integer not null, video_seconds numeric(18,6) not null, audio_seconds numeric(18,6) not null, ocr_pages integer not null, embedding_tokens bigint not null, third_party_cost_nanos bigint not null, other_variable_cost_nanos bigint not null, estimated_provider_cost_nanos bigint not null, compute_units numeric(18,6) not null, compute_unit_rate_usd numeric(18,12) not null, billable boolean not null, idempotency_key text not null, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.qualifying_workflow_types (code text not null, name text not null, description text, is_active boolean not null, sort_order integer not null, created_at timestamp with time zone not null);

create table if not exists public.metering_plans (id uuid not null, code text not null, name text not null, description text, is_active boolean not null, sort_order integer not null, created_at timestamp with time zone not null);

create table if not exists public.metering_plan_versions (id uuid not null, plan_id uuid not null, version integer not null, base_monthly_fee_cents integer not null, included_jobs integer not null, additional_job_price_cents integer not null, included_compute_units numeric(18,6) not null, compute_unit_overage_nanos bigint not null, video_hour_price_cents integer, billing_period_days integer not null, effective_from timestamp with time zone not null, effective_to timestamp with time zone, stripe_price_id text, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.org_metering (org_id uuid not null, plan_version_id uuid not null, override_base_monthly_fee_cents integer, override_included_jobs integer, override_additional_job_price_cents integer, override_included_compute_units numeric(18,6), override_compute_unit_overage_nanos bigint, override_video_hour_price_cents integer, period_anchor_day smallint not null, usage_limit_jobs integer, usage_limit_compute_units numeric(18,6), alert_threshold_pct numeric(5,2) not null, margin_alert_pct numeric(5,2), hard_stop_at_limit boolean not null, metadata jsonb not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.billing_period_jobs (org_id uuid not null, period_start date not null, period_end date not null, job_id uuid not null, workflow_type text not null, first_event_at timestamp with time zone not null, idempotency_key text not null);

create table if not exists public.billing_period_statements (id uuid not null, org_id uuid not null, period_start date not null, period_end date not null, status billing_period_status not null, plan_snapshot jsonb not null, pricing_snapshot jsonb not null, summary jsonb not null, closed_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.metering_alerts (id uuid not null, org_id uuid not null, kind metering_alert_kind not null, severity text not null, title text not null, detail jsonb not null, acknowledged boolean not null, created_at timestamp with time zone not null);

create table if not exists public.job_locations (id uuid not null, org_id uuid not null, job_id uuid not null, parent_id uuid, kind work_location_kind not null, name text not null, detail text, model_element_id text, model_source text, created_at timestamp with time zone not null, room_key text, match_traits text[] not null);

create table if not exists public.verification_videos (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid, party_id uuid, uploader_id uuid, file_name text not null, file_size bigint, mime_type text not null, duration_seconds numeric(10,3), capture_date timestamp with time zone, upload_date timestamp with time zone not null, device_metadata jsonb not null, latitude double precision, longitude double precision, storage_path text not null, content_hash text, thumbnail_path text, status verification_video_status not null, status_detail text, processing_error text, retain_until timestamp with time zone, deleted_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, property_id uuid, room_label text, work_stage_label text, data_owner text not null, training_consent text not null, anonymized_insights_allowed boolean not null, privacy_status privacy_status not null, rights_manifest_id uuid, quarantine_reason text);

create table if not exists public.video_processing_jobs (id uuid not null, org_id uuid not null, video_id uuid not null, job_id uuid not null, idempotency_key text not null, pipeline_version text not null, status verification_step_status not null, current_stage verification_processing_stage, attempt_count integer not null, max_attempts integer not null, started_at timestamp with time zone, completed_at timestamp with time zone, last_error text, cancelled_at timestamp with time zone, cancel_reason text, config jsonb not null, result_summary jsonb, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, lease_owner text, lease_until timestamp with time zone);

create table if not exists public.video_processing_steps (id uuid not null, org_id uuid not null, processing_job_id uuid not null, video_id uuid not null, stage verification_processing_stage not null, status verification_step_status not null, attempt_count integer not null, started_at timestamp with time zone, completed_at timestamp with time zone, last_error text, output_digest text, output jsonb not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.verification_scenes (id uuid not null, org_id uuid not null, video_id uuid not null, job_id uuid not null, location_id uuid, sequence_index integer not null, room_type text not null, label text, start_seconds numeric(10,3) not null, end_seconds numeric(10,3) not null, confidence numeric(5,4), source text not null, user_corrected boolean not null, metadata jsonb not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.verification_frames (id uuid not null, org_id uuid not null, video_id uuid not null, scene_id uuid, proof_frame_id uuid, timestamp_seconds numeric(10,3) not null, sequence_number integer not null, storage_path text not null, width integer, height integer, quality_score numeric(5,4), blur_score numeric(5,4), brightness_score numeric(5,4), motion_score numeric(5,4), is_duplicate boolean not null, duplicate_of uuid, selected_for_analysis boolean not null, rejection_reason text, perceptual_hash text, content_hash text, created_at timestamp with time zone not null);

create table if not exists public.ai_analysis_runs (id uuid not null, org_id uuid not null, video_id uuid not null, processing_job_id uuid, purpose text not null, provider text not null, model_name text not null, model_version text, prompt_version text not null, input_frame_ids uuid[] not null, input_digest text, raw_response text, parsed_response jsonb, schema_valid boolean, validation_error text, input_tokens integer, output_tokens integer, estimated_cost_usd numeric(12,6), latency_ms integer, provider_request_id text, error text, created_at timestamp with time zone not null);

create table if not exists public.frame_observations (id uuid not null, org_id uuid not null, video_id uuid not null, frame_id uuid not null, analysis_run_id uuid not null, scene_id uuid, room_type text, observed_conditions text[] not null, damage_types text[] not null, work_activities text[] not null, materials_present text[] not null, equipment_present text[] not null, completion_indicators text[] not null, safety_issues text[] not null, visible_text text[] not null, uncertainty_reasons text[] not null, evidence_regions jsonb not null, model_confidence numeric(5,4), model_name text not null, model_version text, prompt_version text not null, parsed jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.temporal_change_events (id uuid not null, org_id uuid not null, job_id uuid not null, scene_id uuid, location_id uuid, room_or_area text not null, before_frame_ids uuid[] not null, after_frame_ids uuid[] not null, before_video_id uuid, after_video_id uuid, before_state text not null, after_state text not null, inferred_activity text not null, first_observed_at timestamp with time zone, last_observed_at timestamp with time zone, confidence numeric(5,4), evidence jsonb not null, conflicting_evidence jsonb not null, verification_status verification_result_status not null, created_at timestamp with time zone not null, activity_ontology_id text, during_frame_ids uuid[] not null, scene_match_confidence numeric(5,4), evidence_quality_score numeric(5,4), candidate_status text not null);

create table if not exists public.verification_rules (id uuid not null, org_id uuid, activity_type text not null, version text not null, name text not null, description text, required_observations text[] not null, required_before_states text[] not null, required_after_states text[] not null, min_supporting_frames integer not null, min_confidence numeric(5,4) not null, contradictory_observations text[] not null, allowed_room_types text[] not null, project_requirements jsonb not null, human_review_triggers text[] not null, is_active boolean not null, created_at timestamp with time zone not null, activity_ontology_id text);

create table if not exists public.verification_results (id uuid not null, org_id uuid not null, job_id uuid not null, video_id uuid, change_event_id uuid, rule_id uuid, rule_version text, activity_type text not null, room_or_area text, title text not null, summary text, status verification_result_status not null, model_confidence numeric(5,4), system_confidence numeric(5,4), confidence_breakdown jsonb not null, observed_at timestamp with time zone, first_evidence_at timestamp with time zone, last_evidence_at timestamp with time zone, ai_observation jsonb, rules_result jsonb not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, llm_run_id uuid, activity_ontology_id text, completion_state text, training_consent text not null, privacy_status privacy_status not null, rights_manifest_id uuid, dataset_eligible boolean, eligibility_reason text);

create table if not exists public.verification_evidence (id uuid not null, org_id uuid not null, result_id uuid not null, frame_id uuid, video_id uuid, analysis_run_id uuid, role text not null, video_timestamp_seconds numeric(10,3), image_hash text, note text, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.human_review_tasks (id uuid not null, org_id uuid not null, job_id uuid not null, result_id uuid, video_id uuid, change_event_id uuid, reason text not null, priority text not null, status human_review_status not null, assigned_to uuid, context jsonb not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.human_review_decisions (id uuid not null, org_id uuid not null, task_id uuid not null, result_id uuid, reviewer_id uuid not null, decision text not null, edited_activity text, adjusted_room text, additional_frame_ids uuid[] not null, comment text, reason text, final_status verification_result_status, created_at timestamp with time zone not null);

create table if not exists public.verification_audit_events (id uuid not null, org_id uuid not null, job_id uuid, video_id uuid, result_id uuid, actor_id uuid, event_type text not null, entity_type text not null, entity_id uuid, payload jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.verification_ai_costs (id uuid not null, org_id uuid not null, video_id uuid, job_id uuid, analysis_run_id uuid, provider text not null, model_name text not null, input_tokens integer not null, output_tokens integer not null, estimated_cost_usd numeric(12,6) not null, period_month date not null, created_at timestamp with time zone not null, user_id uuid);

create table if not exists public.verification_usage_limits (org_id uuid not null, monthly_budget_usd numeric(12,2), monthly_video_limit integer, max_frames_per_video integer not null, updated_at timestamp with time zone not null);

create table if not exists public.video_clips (id uuid not null, org_id uuid not null, video_id uuid not null, job_id uuid not null, scene_id uuid, change_event_id uuid, start_seconds numeric(10,3) not null, end_seconds numeric(10,3) not null, frame_ids uuid[] not null, reason text not null, storage_path text, created_at timestamp with time zone not null);

create table if not exists public.llm_verification_runs (id uuid not null, org_id uuid not null, job_id uuid not null, video_id uuid, change_event_id uuid, result_id uuid, parent_run_id uuid, purpose text not null, provider text not null, model_name text not null, model_version text, prompt_id uuid, prompt_key text not null, prompt_version text not null, rule_id uuid, rule_version text, input_frame_ids uuid[] not null, input_clip_ids uuid[] not null, input_digest text, raw_response text, parsed_decision jsonb, decision verification_result_status, model_confidence numeric(5,4), schema_valid boolean, validation_error text, input_tokens integer, output_tokens integer, estimated_cost_usd numeric(12,6), latency_ms integer, provider_request_id text, error text, created_at timestamp with time zone not null);

create table if not exists public.network_erasures (email text not null, reason text, erased_at timestamp with time zone not null);

create table if not exists public.work_episodes (id uuid not null, org_id uuid not null, job_id uuid not null, location_id uuid, scope_item_id uuid, estimate_id uuid, estimate_line_id text, po_line_id uuid, intent_note text, trade text, system text, assembly text, task_key text, ontology_version text not null, task_label_source text not null, party_id uuid, performer_id uuid, performer_label text, performer_kind text not null, work_date date not null, started_at timestamp with time zone, ended_at timestamp with time zone, status work_episode_status not null, completion_note text, tier smallint not null, confidence jsonb not null, worker_consent work_consent_state not null, data_rights work_data_rights not null, rights_set_by uuid, rights_set_at timestamp with time zone, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.episode_observations (id uuid not null, episode_id uuid not null, org_id uuid not null, location_id uuid, phase work_observation_phase not null, proof_id uuid, evidence_kind text not null, reading_name text, reading_value numeric(14,4), reading_unit text, note text, observed_at timestamp with time zone not null, recorded_by uuid, created_at timestamp with time zone not null);

create table if not exists public.episode_actions (id uuid not null, episode_id uuid not null, org_id uuid not null, sequence integer not null, action text not null, object_label text, tool_label text, material_label text, po_line_id uuid, location_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, start_seconds numeric(10,2), end_seconds numeric(10,2), proof_id uuid, purpose text, result text, label_source text not null, confidence numeric(4,3), validated_by uuid, validated_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.episode_resources (id uuid not null, episode_id uuid not null, org_id uuid not null, kind text not null, name text not null, manufacturer text, model_or_sku text, lot_number text, quantity numeric(12,3), unit text, settings jsonb not null, calibrated_at timestamp with time zone, source text not null, po_line_id uuid, created_at timestamp with time zone not null);

create table if not exists public.episode_verifications (id uuid not null, episode_id uuid not null, org_id uuid not null, kind text not null, result text not null, verifier_label text, verified_by uuid, verified_at timestamp with time zone not null, measurement_name text, measurement_value numeric(14,4), measurement_unit text, tolerance_note text, detail text, created_at timestamp with time zone not null);

create table if not exists public.episode_outcomes (id uuid not null, episode_id uuid not null, org_id uuid not null, kind text not null, observed_at timestamp with time zone not null, days_after_work integer, detail text, responsible_party_id uuid, cost_amount numeric(12,2), corrected_by_episode_id uuid, recorded_by uuid, created_at timestamp with time zone not null);

create table if not exists public.episode_economics (episode_id uuid not null, org_id uuid not null, labor_hours numeric(10,2), labor_cost numeric(12,2), material_cost numeric(12,2), equipment_cost numeric(12,2), invoiced_amount numeric(12,2), approved_amount numeric(12,2), withheld_amount numeric(12,2), change_order_amount numeric(12,2), rework_cost numeric(12,2), delay_days integer, backcharge_amount numeric(12,2), insurance_paid_amount numeric(12,2), note text, updated_at timestamp with time zone not null);

create table if not exists public.platform_staff (user_id uuid not null, scope platform_staff_scope not null, display_name text, note text, created_at timestamp with time zone not null, created_by uuid);

create table if not exists public.platform_admin_audit (id uuid not null, actor_user_id uuid not null, actor_email text, action text not null, target_type text, target_id text, org_id uuid, detail jsonb not null, ip text, user_agent text, created_at timestamp with time zone not null);

create table if not exists public.internal_staff_totp (email text not null, secret_cipher text not null, secret_iv text not null, secret_tag text not null, enrolled_at timestamp with time zone not null, last_counter bigint not null, updated_at timestamp with time zone not null, first_name text, last_name text);

create table if not exists public.internal_access_requests (id uuid not null, email text not null, first_name text not null, last_name text not null, status text not null, requested_at timestamp with time zone not null, last_requested_at timestamp with time zone not null, reviewed_at timestamp with time zone, reviewed_by uuid, user_id uuid);

create table if not exists public.legal_holds (id uuid not null, case_number text not null, kind legal_hold_kind not null, title text not null, reason text not null, counsel_name text, received_at timestamp with time zone not null, due_at timestamp with time zone, status legal_hold_status not null, created_by uuid, created_at timestamp with time zone not null, released_by uuid, released_at timestamp with time zone, release_reason text);

create table if not exists public.legal_hold_subjects (id uuid not null, hold_id uuid not null, subject_type legal_subject_type not null, subject_id uuid not null, created_at timestamp with time zone not null);

create table if not exists public.legal_video_vault (id uuid not null, org_id uuid not null, source_kind legal_vault_source not null, source_id uuid not null, job_id uuid, actor_user_id uuid, storage_backend text not null, storage_bucket text not null, storage_key text not null, content_hash text, byte_size bigint, duration_seconds numeric(10,2), content_type text, captured_at timestamp with time zone, received_at timestamp with time zone not null, user_deleted_at timestamp with time zone, vaulted_at timestamp with time zone not null, metadata jsonb not null);

create table if not exists public.user_activity_events (id uuid not null, occurred_at timestamp with time zone not null, actor_user_id uuid, actor_email text, actor_label text, org_id uuid, action text not null, resource_type text, resource_id text, request_id text, method text, path text, status integer, ip text, user_agent text, detail jsonb not null);

create table if not exists public.legal_productions (id uuid not null, hold_id uuid not null, requested_by uuid, created_at timestamp with time zone not null, item_count integer not null, activity_count integer not null, note text);

create table if not exists public.episode_world_states (id uuid not null, episode_id uuid not null, org_id uuid not null, kind text not null, source_proof_id uuid, summary text, opening text, visible_conditions jsonb not null, changes jsonb not null, concerns jsonb not null, uncertainties jsonb not null, objects jsonb not null, payload jsonb not null, source text not null, model text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.episode_evidence_assets (id uuid not null, episode_id uuid not null, org_id uuid not null, proof_id uuid, kind text not null, phase text, content_hash text, storage_path text, duration_seconds numeric(10,2), byte_size bigint, captured_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.episode_annotations (id uuid not null, episode_id uuid not null, org_id uuid not null, kind text not null, model text, payload_hash text not null, payload jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.episode_immediate_outcomes (episode_id uuid not null, org_id uuid not null, status text not null, material_change text, summary text, scope_verdicts jsonb not null, source text not null, is_ground_truth boolean not null, model text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.token_usage_events (id uuid not null, org_id uuid not null, user_id uuid, job_id uuid, request_id text not null, feature token_usage_feature not null, source text, model_id text, input_tokens bigint not null, output_tokens bigint not null, cache_tokens bigint not null, total_tokens bigint generated always as (((input_tokens + output_tokens) + cache_tokens)) stored, price_nanos bigint not null, metadata jsonb not null, created_at timestamp with time zone not null, cost_nanos bigint not null, provider text, cache_read_tokens bigint not null, cache_write_5m_tokens bigint not null, cache_write_1h_tokens bigint not null, provider_usage jsonb, pricing_status text not null);

create table if not exists public.crm_audit_log (id bigint generated always as identity not null, org_id uuid, table_name text not null, row_id uuid, op text not null, actor_id uuid, changed_at timestamp with time zone not null, row_data jsonb, prev_data jsonb);

create table if not exists public.terms_acceptances (id uuid not null, user_id uuid not null, terms_version text not null, accepted_at timestamp with time zone not null, ip text, user_agent text);

create table if not exists public.atmosphere_migrations (version text not null, checksum text not null, applied_at timestamp with time zone not null, applied_by text not null, baselined boolean not null);

create table if not exists public.job_progress_grants (id uuid not null, org_id uuid not null, job_id uuid not null, user_id uuid not null, share_id uuid, recipient_email text not null, created_at timestamp with time zone not null, last_accessed_at timestamp with time zone, service_role text not null, access_kind text not null, grantee_org_id uuid, revoked_at timestamp with time zone);

create table if not exists public.safety_incidents (id uuid not null, org_id uuid not null, job_id uuid, party_id uuid, proof_id uuid, clip_id text, category safety_incident_category not null, severity safety_incident_severity not null, confidence numeric(4,3) not null, title text not null, description text not null, clip_timestamp_seconds numeric(12,3), lat double precision, lon double precision, location_label text, recommended_action safety_recommended_action not null, status safety_incident_status not null, source safety_incident_source not null, model text, signals jsonb not null, alert_sent_at timestamp with time zone, alert_channels text[] not null, acknowledged_at timestamp with time zone, acknowledged_by uuid, dismissed_at timestamp with time zone, dismissed_by uuid, dismiss_reason text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, reality text, confirmation text, dismiss_category text);

create table if not exists public.wellness_session_state (id uuid not null, org_id uuid not null, job_id uuid not null, party_id uuid, clip_id text, last_motion_at timestamp with time zone not null, last_heartbeat_at timestamp with time zone not null, alone_on_site boolean not null, last_motion_score numeric(6,4), person_count_estimate integer, recording_active boolean not null, lat double precision, lon double precision, location_label text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.daily_job_reports (id uuid not null, org_id uuid not null, job_id uuid not null, local_day date not null, timezone text not null, channel text not null, status daily_job_report_status not null, recipient_emails text[] not null, recipient_phones text[] not null, subject text, body_text text, body_html text, summary jsonb not null, clip_count integer not null, error text, sent_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.trade_playbooks (id uuid not null, org_id uuid not null, title text not null, trade text, summary text, status text not null, source_kind text not null, source_job_id uuid, skill_tags text[] not null, step_count integer not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.trade_playbook_steps (id uuid not null, playbook_id uuid not null, "position" integer not null, title text not null, instruction text, skill_key text, evidence_hint text, metadata jsonb not null);

create table if not exists public.trade_playbook_sources (id uuid not null, playbook_id uuid not null, job_id uuid, proof_id uuid, episode_id uuid, analysis_snapshot jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.ask_threads (id uuid not null, org_id uuid not null, job_id uuid not null, owner_user_id uuid, share_id uuid, title text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, last_message_at timestamp with time zone, rolling_summary text, summary_through_question_id uuid, summary_turn_count integer not null, summarized_at timestamp with time zone);

create table if not exists public.proof_live_sessions (id uuid not null, org_id uuid not null, job_id uuid not null, party_id uuid not null, clip_id text not null, storage_path text not null, work_date date not null, phase text not null, extension text not null, mime_type text not null, status text not null, last_mint_index integer not null, started_at timestamp with time zone not null, last_part_at timestamp with time zone not null, ended_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.recording_acknowledgments (id uuid not null, org_id uuid not null, job_id uuid not null, property_id uuid, actor_user_id uuid not null, actor_party_id uuid, disclosure_version text not null, work_date date not null, acknowledged_at timestamp with time zone not null, ip text, user_agent text, created_at timestamp with time zone not null);

create table if not exists public.crm_agent_credentials (org_id uuid not null, system text not null, username text not null, password_cipher text not null, password_iv text not null, password_tag text not null, notes text, status text not null, last_verified_at timestamp with time zone, last_error text, last_agent_job_id uuid, connected_by uuid, connected_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.crm_agent_jobs (id uuid not null, org_id uuid not null, system text not null, kind text not null, status text not null, request_summary jsonb, result_summary jsonb, error text, created_by uuid, created_at timestamp with time zone not null, started_at timestamp with time zone, finished_at timestamp with time zone);

create table if not exists public.content_mentions (id uuid not null, org_id uuid not null, mentioned_user_id uuid not null, handle text not null, source text not null, source_id uuid not null, job_id uuid, created_at timestamp with time zone not null);

create table if not exists public.ask_job_notes (id uuid not null, org_id uuid not null, job_id uuid not null, thread_id uuid not null, owner_user_id uuid, share_id uuid, note text not null, source_question_id uuid, created_at timestamp with time zone not null);

create table if not exists public.ask_transcript_chunks (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid not null, seq integer not null, start_sec double precision, end_sec double precision, text text not null, speaker_label text, transcript_sha256 text not null, created_at timestamp with time zone not null, fts tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored, embedding vector(1536), embedding_model text, embedding_at timestamp with time zone);

create table if not exists public.voiceprints (id uuid not null, user_id uuid not null, org_id uuid not null, consent_text text not null, consented_at timestamp with time zone not null, cross_company_opt_in boolean not null, duration_seconds numeric, embedding_model text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.voiceprint_embeddings (voiceprint_id uuid not null, embedding jsonb not null, dimension integer not null);

create table if not exists public.voice_consent_events (id uuid not null, user_id uuid not null, org_id uuid not null, action text not null, consent_text text, created_at timestamp with time zone not null);

create table if not exists public.voice_enrollment_requests (id uuid not null, org_id uuid not null, requester_user_id uuid not null, subject_user_id uuid not null, status text not null, created_at timestamp with time zone not null, resolved_at timestamp with time zone);

create table if not exists public.speaker_identities (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid not null, speaker_label text not null, display_name text, status text not null, method text not null, confidence numeric, voiceprint_id uuid, subject_user_id uuid, source_proof_id uuid, source_t_sec double precision, source_quote text, clip_title text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.speaker_role_guesses (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid not null, speaker_label text not null, role text not null, confidence numeric not null, source_t_sec double precision, source_quote text not null, clip_title text, status text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.clip_room_segments (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid not null, location_id uuid, sequence_index integer not null, room_name text not null, room_key text not null, start_seconds numeric(10,3) not null, end_seconds numeric(10,3) not null, confidence numeric(5,4), source text not null, user_corrected boolean not null, findings jsonb not null, speech jsonb not null, analysis_fingerprint text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.job_chat_documents (id uuid not null, org_id uuid not null, job_id uuid, context_job_id uuid, suggested_job_id uuid, proof_id uuid, filename text not null, media_type text not null, byte_size bigint not null, content_hash text not null, storage_path text not null, status text not null, doc_kind text not null, relevance text not null, relevance_reason text, summary text, extracted_text text, key_facts jsonb not null, chunk_index jsonb not null, extraction_error text, macros_ignored boolean not null, uploaded_by uuid, attached_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.ask_document_chunks (id uuid not null, org_id uuid not null, document_id uuid not null, job_id uuid, seq integer not null, location text not null, text text not null, created_at timestamp with time zone not null, fts tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored);

create table if not exists public.job_document_rooms (id uuid not null, org_id uuid not null, job_id uuid not null, document_id uuid not null, name text not null, dimensions text, notes text, source_location text, created_at timestamp with time zone not null);

create table if not exists public.ai_credit_ledger (id uuid not null, org_id uuid not null, delta_nanos bigint not null, kind text not null, stripe_event_id text, stripe_session_id text, request_id text, note text, actor_id uuid, created_at timestamp with time zone not null, stripe_charge_id text);

create table if not exists public.ai_usage_allocations (id uuid not null, org_id uuid not null, request_id text not null, cost_nanos bigint not null, allowance_nanos bigint not null, credit_nanos bigint not null, created_at timestamp with time zone not null);

create table if not exists public.ai_budget_price_spans (id uuid not null, org_id uuid not null, amount_cents integer not null, billing_interval text not null, effective_from timestamp with time zone not null, effective_to timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.ai_credit_pack_clawbacks (org_id uuid not null, stripe_charge_id text not null, granted_nanos bigint not null, charge_amount_cents integer not null, amount_refunded_cents integer not null);

create table if not exists public.ai_credit_pack_disputes (org_id uuid not null, stripe_dispute_id text not null, stripe_charge_id text not null, amount_cents integer not null, standing text not null, event_at timestamp with time zone);

create table if not exists public.capture_upload_attempts (org_id uuid not null, upload_key text not null, job_id uuid, started_at timestamp with time zone not null, last_attempt_at timestamp with time zone not null, attempts integer not null, completed_at timestamp with time zone, failed_at timestamp with time zone, last_error_code text);

create table if not exists public.ask_turn_events (id bigint generated always as identity not null, org_id uuid not null, surface text not null, outcome text not null, error_code text, total_ms integer not null, ttft_ms integer, model text, created_at timestamp with time zone not null);

create table if not exists public.analytics_campaigns (id uuid not null, name text not null, subject text not null, body_markdown text not null, audience jsonb not null, status text not null, created_by uuid, updated_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, sent_at timestamp with time zone, recipient_count integer, sent_count integer, failed_count integer, suppressed_count integer);

create table if not exists public.analytics_campaign_sends (id uuid not null, campaign_id uuid not null, email text not null, unsubscribe_token text not null, status text not null, provider_message_id text, error text, created_at timestamp with time zone not null, sent_at timestamp with time zone);

create table if not exists public.analytics_email_suppressions (email text not null, reason text not null, campaign_id uuid, created_by uuid, created_at timestamp with time zone not null);

create table if not exists public.ai_credit_auto_recharge_settings (org_id uuid not null, enabled boolean not null, pack_code text not null, consented_at timestamp with time zone, updated_by uuid, updated_at timestamp with time zone not null, disabled_reason text, disabled_at timestamp with time zone, last_attempt_at timestamp with time zone);

create table if not exists public.ai_credit_auto_recharges (id uuid not null, org_id uuid not null, pack_code text not null, amount_cents integer, currency text not null, credit_nanos bigint, status text not null, idempotency_key text not null, stripe_payment_intent_id text, stripe_charge_id text, failure_code text, failure_message text, trigger_source text, created_at timestamp with time zone not null, completed_at timestamp with time zone);

create table if not exists public.computer_sessions (id uuid not null, org_id uuid not null, provider text not null, provider_session_id text, provider_context_id text, status text not null, started_at timestamp with time zone not null, ended_at timestamp with time zone, browser_seconds integer, metered_at timestamp with time zone, created_at timestamp with time zone not null, purpose text not null, login_id uuid, target_url text, target_label text, started_by uuid);

create table if not exists public.computer_tasks (id uuid not null, org_id uuid not null, job_id uuid, created_by uuid, instructions text not null, start_url text, job_projection jsonb not null, status text not null, status_detail text, needs_you jsonb, human_control_by uuid, human_control_since timestamp with time zone, resume_requested_at timestamp with time zone, cancel_requested_at timestamp with time zone, session_id uuid, model_id text not null, step_count integer not null, max_steps integer not null, budget_nanos bigint not null, cost_nanos bigint not null, last_action text, current_url text, result_summary text, error text, created_at timestamp with time zone not null, started_at timestamp with time zone, finished_at timestamp with time zone, heartbeat_at timestamp with time zone, updated_at timestamp with time zone not null, practice jsonb);

create table if not exists public.computer_approvals (id uuid not null, org_id uuid not null, task_id uuid not null, status text not null, action_kind text not null, button_label text not null, summary text not null, page_url text, page_origin text, fields jsonb not null, screenshot_jpeg_b64 text, token_hash text, requested_at timestamp with time zone not null, expires_at timestamp with time zone not null, decided_by uuid, decided_at timestamp with time zone, consumed_at timestamp with time zone, approved_order jsonb);

create table if not exists public.computer_audit_events (id bigint generated always as identity not null, org_id uuid not null, task_id uuid, session_id uuid, job_id uuid, actor_kind text not null, actor_user_id uuid, event text not null, detail jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.computer_logins (id uuid not null, org_id uuid not null, label text not null, url text not null, host text not null, cookie_domains text[] not null, created_by uuid, created_at timestamp with time zone not null, last_signed_in_at timestamp with time zone, last_signed_in_by uuid, updated_at timestamp with time zone not null);

create table if not exists public.computer_login_credentials (login_id uuid not null, org_id uuid not null, username_sealed text not null, password_sealed text not null, key_fingerprint text not null, login_url text, status text not null, attention_reason text, last_used_at timestamp with time zone, created_by uuid, updated_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, company_id_sealed text);

create table if not exists public.ask_communication_styles (user_id uuid not null, traits jsonb not null, prompt_summary text not null, sample_count integer not null, last_signal_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.ask_analysis_chunks (id uuid not null, org_id uuid not null, job_id uuid not null, proof_id uuid not null, seq integer not null, kind text not null, start_sec double precision, end_sec double precision, text text not null, source_sha256 text not null, embedding vector(1536), embedding_model text, embedding_at timestamp with time zone, created_at timestamp with time zone not null, fts tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored);

create table if not exists public.ask_route_decisions (id uuid not null, org_id uuid, job_id uuid, question text not null, route text not null, reason text not null, unsure boolean not null, model_hint text, created_at timestamp with time zone not null);

create table if not exists public.ask_job_context_cache (job_id uuid not null, org_id uuid not null, fingerprint text not null, summary_text text not null, index_meta jsonb not null, rebuilt_at timestamp with time zone not null, source_updated_at timestamp with time zone);

create table if not exists public.ask_org_memory_facts (id uuid not null, org_id uuid not null, kind text not null, label text not null, detail text not null, restricted boolean not null, source_job_ids uuid[] not null, source_question_id uuid, confidence real not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.computer_site_playbooks (id uuid not null, site text not null, task_type text not null, playbook jsonb not null, success_count integer not null, reject_count integer not null, edit_count integer not null, last_success_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, version integer not null, steps jsonb not null, status text not null, source text not null, replay_success_count integer not null, failure_count integer not null, last_failure_at timestamp with time zone);

create table if not exists public.computer_playbook_outcomes (id uuid not null, org_id uuid not null, task_id uuid, site text not null, task_type text not null, outcome text not null, playbook_id uuid, created_at timestamp with time zone not null);

create table if not exists public.computer_supply_orders (id uuid not null, org_id uuid not null, job_id uuid, task_id uuid, approval_id uuid, vendor text not null, status text not null, order_key_hash text not null, line_count integer not null, subtotal_cents integer, currency text not null, fulfillment_mode text, has_job_address boolean not null, low_confidence_count integer not null, detail jsonb not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.computer_practice_runs (id uuid not null, org_id uuid not null, run_date date not null, site text not null, task_key text not null, task_type text not null, mode text not null, status text not null, failed_step integer, failure_reason text, steps jsonb not null, task_id uuid, playbook_id uuid, playbook_version integer, used_playbook boolean not null, model_calls integer not null, cost_nanos bigint not null, duration_ms integer, started_at timestamp with time zone not null, finished_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.computer_practice_screens (id bigint generated always as identity not null, run_id uuid not null, step_index integer not null, label text not null, jpeg_b64 text not null, created_at timestamp with time zone not null);

create table if not exists public.computer_playbook_drafts (id uuid not null, org_id uuid not null, task_id uuid, site text not null, task_type text not null, source text not null, steps jsonb not null, step_count integer not null, status text not null, review_note text, reviewed_by uuid, reviewed_at timestamp with time zone, playbook_id uuid, created_at timestamp with time zone not null);

create table if not exists public.computer_route_decisions (id uuid not null, org_id uuid, task_id uuid, step integer not null, route text not null, model text not null, reason text not null, created_at timestamp with time zone not null);

create table if not exists public.ask_answer_feedback (id uuid not null, org_id uuid not null, job_id uuid not null, question_id uuid not null, user_id uuid not null, rating smallint not null, reason text, comment text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.ask_pinned_answers (id uuid not null, org_id uuid not null, job_id uuid not null, question_id uuid not null, pinned_by uuid, created_at timestamp with time zone not null);

create table if not exists public.ask_pending_actions (id uuid not null, org_id uuid not null, job_id uuid not null, requested_by uuid, kind text not null, payload jsonb not null, status text not null, result text, decided_by uuid, decided_at timestamp with time zone, expires_at timestamp with time zone not null, created_at timestamp with time zone not null);

create table if not exists public.demo_bookings (id uuid not null, slot_start timestamp with time zone not null, status text not null, name text not null, email text not null, company text not null, phone text, notes text, guest_time_zone text, client_ip text, host_emailed_at timestamp with time zone, guest_emailed_at timestamp with time zone, created_at timestamp with time zone not null, google_event_id text, meet_url text, host_notified_at timestamp with time zone);

CREATE OR REPLACE FUNCTION public.create_org(p_name text, p_role member_role, p_work_type work_type)
 RETURNS orgs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org public.orgs;
  v_code text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  -- Ensure the caller has a profile row (satisfies the org_members FK).
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  -- Generate a unique, human-friendly 8-char join code.
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.orgs where join_code = v_code);
  end loop;

  insert into public.orgs (name, join_code, created_by)
  values (btrim(p_name), v_code, v_uid)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role, work_type)
  values (v_org.id, v_uid, p_role, p_work_type);

  return v_org;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.join_org(p_code text, p_role member_role, p_work_type work_type)
 RETURNS orgs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org public.orgs;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_org from public.orgs where join_code = upper(btrim(p_code));
  if v_org.id is null then
    raise exception 'invalid join code' using errcode = 'P0002';
  end if;

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.org_members (org_id, user_id, role, work_type)
  values (v_org.id, v_uid, p_role, p_work_type)
  on conflict (org_id, user_id)
  do update set role = excluded.role, work_type = excluded.work_type, status = 'active';

  return v_org;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.is_org_member(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.org_members
    where org_id = p_org
      and user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.shares_org(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on them.org_id = me.org_id
    where me.user_id = auth.uid() and them.user_id = p_user
  );
$function$
;

CREATE OR REPLACE FUNCTION public.device_lookup(p_device_id uuid, p_secret_hash text)
 RETURNS TABLE(pin_salt text, locked_until timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d.pin_salt, d.locked_until
  from public.device_credentials d
  where d.id = p_device_id and d.secret_hash = p_secret_hash;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_my_devices()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.device_credentials where user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.device_verify_pin(p_device_id uuid, p_secret_hash text, p_pin_hash text)
 RETURNS TABLE(ok boolean, user_id uuid, locked_until timestamp with time zone, attempts_left integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.device_credentials%rowtype;
begin
  select * into d
  from public.device_credentials
  where id = p_device_id and secret_hash = p_secret_hash
  for update;

  if not found then
    return query select false, null::uuid, null::timestamptz, 0;
    return;
  end if;

  if d.locked_until is not null and d.locked_until > now() then
    return query select false, null::uuid, d.locked_until, 0;
    return;
  end if;

  if d.pin_hash = p_pin_hash then
    update public.device_credentials
       set failed_attempts = 0, lockouts = 0, locked_until = null, last_used_at = now()
     where id = d.id;
    return query select true, d.user_id, null::timestamptz, 5;
    return;
  end if;

  if d.failed_attempts + 1 >= 5 then
    if d.lockouts + 1 >= 3 then
      delete from public.device_credentials where id = d.id;
      return query select false, null::uuid, null::timestamptz, 0;
      return;
    end if;
    update public.device_credentials
       set failed_attempts = 0, lockouts = d.lockouts + 1, locked_until = now() + interval '15 minutes'
     where id = d.id;
    return query select false, null::uuid, now() + interval '15 minutes', 0;
    return;
  end if;

  update public.device_credentials
     set failed_attempts = d.failed_attempts + 1
   where id = d.id;
  return query select false, null::uuid, null::timestamptz, 5 - (d.failed_attempts + 1);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enroll_device(p_secret_hash text, p_pin_hash text, p_pin_salt text, p_label text DEFAULT NULL::text, p_replace_device_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_max constant int := 5;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Changing the PIN on a device already enrolled: drop that row so the old
  -- PIN stops working rather than lingering as a second valid credential.
  if p_replace_device_id is not null then
    delete from public.device_credentials
     where id = p_replace_device_id and user_id = v_uid;
  end if;

  -- Keep only the most recently used enrollments, making room for the new one.
  delete from public.device_credentials
   where id in (
     select id from public.device_credentials
      where user_id = v_uid
      order by coalesce(last_used_at, created_at) desc
      offset v_max - 1
   );

  insert into public.device_credentials (user_id, secret_hash, pin_hash, pin_salt, label)
  values (v_uid, p_secret_hash, p_pin_hash, p_pin_salt, p_label)
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.web_access_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_install_bridges()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_installed text[] := '{}';
  v_skipped   text[] := '{}';
begin
  if to_regclass('public.web_runs') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.web_runs';
    execute 'create trigger audit_bridge_trg after insert or update on public.web_runs '
            'for each row execute function public.audit_bridge_web_runs()';
    v_installed := v_installed || 'web_runs'::text;
  else
    v_skipped := v_skipped || 'web_runs'::text;
  end if;

  if to_regclass('public.crm_sync_runs') is not null
     and to_regclass('public.crm_external_sources') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.crm_sync_runs';
    execute 'create trigger audit_bridge_trg after insert or update on public.crm_sync_runs '
            'for each row execute function public.audit_bridge_crm_sync_runs()';
    v_installed := v_installed || 'crm_sync_runs'::text;
  else
    v_skipped := v_skipped || 'crm_sync_runs'::text;
  end if;

  if to_regclass('public.backup_snapshots') is not null
     and to_regclass('public.backup_snapshot_items') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.backup_snapshots';
    execute 'create trigger audit_bridge_trg after insert or update on public.backup_snapshots '
            'for each row execute function public.audit_bridge_backup_snapshots()';
    v_installed := v_installed || 'backup_snapshots'::text;
  else
    v_skipped := v_skipped || 'backup_snapshots'::text;
  end if;

  return pg_catalog.format('installed: %s; not present yet: %s',
    coalesce(pg_catalog.array_to_string(v_installed, ', '), 'none'),
    coalesce(pg_catalog.array_to_string(v_skipped, ', '), 'none'));
end;
$function$
;

CREATE OR REPLACE FUNCTION private.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.can_manage_billing(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role::text in ('global_admin', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.price_usage(p_model_id text, p_input_tokens bigint DEFAULT 0, p_output_tokens bigint DEFAULT 0, p_cache_write_5m_tokens bigint DEFAULT 0, p_cache_write_1h_tokens bigint DEFAULT 0, p_cache_read_tokens bigint DEFAULT 0, p_is_batch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  c private.model_costs%rowtype;
  v_batch numeric; v_cost_in numeric; v_cost_out numeric;
  v_cost_cw5 numeric; v_cost_cw1h numeric; v_cost_cr numeric;
  v_cost numeric; v_price numeric;
begin
  select * into c from private.model_costs where model_id = p_model_id;
  if not found then raise exception 'unknown_model' using detail = p_model_id, errcode = 'P0002'; end if;
  if not c.is_active then raise exception 'model_inactive' using detail = p_model_id, errcode = 'P0002'; end if;

  v_batch := case when p_is_batch then c.batch_multiplier else 1 end;
  v_cost_in   := p_input_tokens * c.input_cost_per_mtok * 1000 * v_batch;
  v_cost_out  := p_output_tokens * c.output_cost_per_mtok * 1000 * v_batch;
  v_cost_cw5  := p_cache_write_5m_tokens * c.input_cost_per_mtok * 1000 * c.cache_write_5m_multiplier * v_batch;
  v_cost_cw1h := p_cache_write_1h_tokens * c.input_cost_per_mtok * 1000 * c.cache_write_1h_multiplier * v_batch;
  v_cost_cr   := p_cache_read_tokens * c.input_cost_per_mtok * 1000 * c.cache_read_multiplier * v_batch;
  v_cost := v_cost_in + v_cost_out + v_cost_cw5 + v_cost_cw1h + v_cost_cr;
  v_price := v_cost * c.markup;

  return jsonb_build_object(
    'model_id', c.model_id, 'is_batch', p_is_batch,
    'cost_nanos', round(v_cost)::bigint, 'price_nanos', round(v_price)::bigint,
    'breakdown', jsonb_build_object(
      'input', jsonb_build_object('tokens', p_input_tokens, 'price_nanos', round(v_cost_in * c.markup)::bigint),
      'output', jsonb_build_object('tokens', p_output_tokens, 'price_nanos', round(v_cost_out * c.markup)::bigint),
      'cache_write_5m', jsonb_build_object('tokens', p_cache_write_5m_tokens, 'price_nanos', round(v_cost_cw5 * c.markup)::bigint),
      'cache_write_1h', jsonb_build_object('tokens', p_cache_write_1h_tokens, 'price_nanos', round(v_cost_cw1h * c.markup)::bigint),
      'cache_read', jsonb_build_object('tokens', p_cache_read_tokens, 'price_nanos', round(v_cost_cr * c.markup)::bigint)));
end; $function$
;

CREATE OR REPLACE FUNCTION public.quote_usage(p_model_id text, p_input_tokens bigint DEFAULT 0, p_output_tokens bigint DEFAULT 0, p_cache_write_5m_tokens bigint DEFAULT 0, p_cache_write_1h_tokens bigint DEFAULT 0, p_cache_read_tokens bigint DEFAULT 0, p_is_batch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
  select private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  );
$function$
;

CREATE OR REPLACE FUNCTION private.advance_billing_period(p_org uuid)
 RETURNS org_billing
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b         public.org_billing%rowtype;
  p         public.billing_plans%rowtype;
  v_guard   integer := 0;
  v_created boolean := false;
begin
  select * into b from public.org_billing where org_id = p_org for update;

  if not found then
    insert into public.org_billing (org_id, period_start, period_end)
    values (p_org, now(), now() + interval '1 month')
    on conflict (org_id) do nothing;
    select * into b from public.org_billing where org_id = p_org for update;
    v_created := true;
  end if;

  select * into p from public.billing_plans where code = b.plan_code;

  while b.period_end <= now() and v_guard < 120 loop
    v_guard := v_guard + 1;

    if b.cancel_at_period_end and b.plan_code <> 'free' then
      update public.org_billing
         set plan_code = 'free', cancel_at_period_end = false, seats = 1,
             status = 'active', billing_interval = 'monthly'
       where org_id = p_org
       returning * into b;
      select * into p from public.billing_plans where code = b.plan_code;
    end if;

    update public.org_billing
       set period_start = b.period_end,
           period_end   = b.period_end + interval '1 month'
     where org_id = p_org
     returning * into b;
  end loop;

  return b;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_usage(p_org uuid, p_model_id text, p_request_id text, p_input_tokens bigint DEFAULT 0, p_output_tokens bigint DEFAULT 0, p_cache_write_5m_tokens bigint DEFAULT 0, p_cache_write_1h_tokens bigint DEFAULT 0, p_cache_read_tokens bigint DEFAULT 0, p_is_batch boolean DEFAULT false, p_feature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_priced jsonb;
  v_price  bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if coalesce(btrim(p_request_id), '') = '' then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  perform private.advance_billing_period(p_org);

  v_priced := private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  );
  v_price := (v_priced ->> 'price_nanos')::bigint;

  return jsonb_build_object(
    'event_id',    null,
    'price_nanos', v_price,
    'breakdown',   v_priced -> 'breakdown',
    'duplicate',   false,
    'balance',     public.credit_balance(p_org)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_billing_plan(p_org uuid, p_plan text, p_interval billing_interval DEFAULT 'monthly'::billing_interval, p_seats integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.org_billing%rowtype;
  p public.billing_plans%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan and is_active;
  if not found then
    raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002';
  end if;
  if p.is_contact_sales then
    raise exception 'plan_requires_sales' using detail = p_plan, errcode = 'P0001';
  end if;
  if p_seats < p.min_seats then
    raise exception 'seats_below_minimum'
      using detail = format('min=%s requested=%s', p.min_seats, p_seats), errcode = '22023';
  end if;

  b := private.advance_billing_period(p_org);

  if b.plan_code = p_plan and b.seats = p_seats and b.billing_interval = p_interval then
    update public.org_billing set cancel_at_period_end = false where org_id = p_org
      returning * into b;
    return jsonb_build_object('plan', p_plan, 'changed', false, 'balance', public.credit_balance(p_org));
  end if;

  if p_plan = 'free' and b.plan_code <> 'free' then
    update public.org_billing set cancel_at_period_end = true where org_id = p_org;
    return jsonb_build_object(
      'plan', b.plan_code, 'changed', true, 'effective_at', b.period_end,
      'cancel_at_period_end', true, 'balance', public.credit_balance(p_org)
    );
  end if;

  update public.org_billing
     set plan_code = p_plan,
         seats = p_seats,
         billing_interval = p_interval,
         status = 'active',
         cancel_at_period_end = false,
         period_start = now(),
         period_end = now() + interval '1 month'
   where org_id = p_org
   returning * into b;

  return jsonb_build_object(
    'plan', p_plan, 'changed', true, 'seats', p_seats,
    'period_end', b.period_end, 'granted_nanos', 0,
    'balance', public.credit_balance(p_org)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_billing_settings(p_org uuid, p_auto_reload_enabled boolean DEFAULT NULL::boolean, p_auto_reload_threshold bigint DEFAULT NULL::bigint, p_auto_reload_amount bigint DEFAULT NULL::bigint, p_monthly_spend_limit bigint DEFAULT NULL::bigint, p_clear_spend_limit boolean DEFAULT false)
 RETURNS org_billing
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare b public.org_billing%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.can_manage_billing(p_org) then raise exception 'billing_forbidden' using errcode = '42501'; end if;
  perform private.advance_billing_period(p_org);
  update public.org_billing
     set auto_reload_enabled = coalesce(p_auto_reload_enabled, auto_reload_enabled),
         auto_reload_threshold_nanos = coalesce(p_auto_reload_threshold, auto_reload_threshold_nanos),
         auto_reload_amount_nanos = coalesce(p_auto_reload_amount, auto_reload_amount_nanos),
         monthly_spend_limit_nanos = case when p_clear_spend_limit then null
              else coalesce(p_monthly_spend_limit, monthly_spend_limit_nanos) end
   where org_id = p_org returning * into b;
  return b;
end; $function$
;

CREATE OR REPLACE FUNCTION public.billing_overview(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.org_billing%rowtype;
  p public.billing_plans%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  b := private.advance_billing_period(p_org);
  select * into p from public.billing_plans where code = b.plan_code;

  return jsonb_build_object(
    'subscription', jsonb_build_object(
      'plan_code', b.plan_code,
      'plan_name', p.name,
      'billing_interval', b.billing_interval,
      'seats', b.seats,
      'status', b.status,
      'period_start', b.period_start,
      'period_end', b.period_end,
      'cancel_at_period_end', b.cancel_at_period_end,
      'monthly_price_cents', case when p.per_seat
                                  then p.monthly_price_cents * b.seats
                                  else p.monthly_price_cents end,
      'included_credits_nanos', p.included_credits_nanos * (case when p.per_seat then b.seats else 1 end),
      'rate_multiplier', p.rate_multiplier
    ),
    'settings', jsonb_build_object(
      'auto_reload_enabled', b.auto_reload_enabled,
      'auto_reload_threshold_nanos', b.auto_reload_threshold_nanos,
      'auto_reload_amount_nanos', b.auto_reload_amount_nanos,
      'monthly_spend_limit_nanos', b.monthly_spend_limit_nanos
    ),
    'balance', public.credit_balance(p_org),
    'period_usage', jsonb_build_object(
      'events', 0, 'price_nanos', 0, 'input_tokens', 0, 'output_tokens', 0, 'cache_tokens', 0
    ),
    'usage_by_model', '[]'::jsonb,
    'can_manage', private.can_manage_billing(p_org)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stripe_event_seen(p_event_id text, p_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare v_first boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  insert into private.stripe_events (id, type) values (p_event_id, p_type)
  on conflict (id) do nothing;
  get diagnostics v_first = row_count;
  return v_first;
end $function$
;

CREATE OR REPLACE FUNCTION public.link_stripe_customer(p_org uuid, p_customer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;
  perform private.advance_billing_period(p_org);
  update public.org_billing set stripe_customer_id = p_customer_id where org_id = p_org;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_payment(p_org uuid, p_kind text, p_status text, p_amount_cents integer, p_currency text DEFAULT 'usd'::text, p_description text DEFAULT NULL::text, p_payment_intent_id text DEFAULT NULL::text, p_invoice_id text DEFAULT NULL::text, p_charge_id text DEFAULT NULL::text, p_receipt_url text DEFAULT NULL::text, p_hosted_invoice_url text DEFAULT NULL::text, p_invoice_pdf_url text DEFAULT NULL::text, p_receipt_email text DEFAULT NULL::text, p_card_brand text DEFAULT NULL::text, p_card_last4 text DEFAULT NULL::text, p_purchase_id uuid DEFAULT NULL::uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_failure_reason text DEFAULT NULL::text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.payments%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_payment_intent_id is not null then
    select * into v_row from public.payments
     where stripe_payment_intent_id = p_payment_intent_id for update;
  elsif p_invoice_id is not null then
    select * into v_row from public.payments where stripe_invoice_id = p_invoice_id for update;
  end if;

  if found and v_row.id is not null then
    update public.payments set
      status = p_status, amount_cents = p_amount_cents,
      description = coalesce(p_description, description),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      stripe_invoice_id = coalesce(p_invoice_id, stripe_invoice_id),
      receipt_url = coalesce(p_receipt_url, receipt_url),
      hosted_invoice_url = coalesce(p_hosted_invoice_url, hosted_invoice_url),
      invoice_pdf_url = coalesce(p_invoice_pdf_url, invoice_pdf_url),
      receipt_email = coalesce(p_receipt_email, receipt_email),
      card_brand = coalesce(p_card_brand, card_brand),
      card_last4 = coalesce(p_card_last4, card_last4),
      purchase_id = coalesce(p_purchase_id, purchase_id),
      period_start = coalesce(p_period_start, period_start),
      period_end = coalesce(p_period_end, period_end),
      failure_reason = p_failure_reason
    where id = v_row.id returning * into v_row;
    return v_row;
  end if;

  insert into public.payments (
    org_id, kind, status, amount_cents, currency, description,
    stripe_payment_intent_id, stripe_invoice_id, stripe_charge_id,
    receipt_url, hosted_invoice_url, invoice_pdf_url, receipt_email,
    card_brand, card_last4, purchase_id, period_start, period_end, failure_reason)
  values (
    p_org, p_kind, p_status, p_amount_cents, p_currency, p_description,
    p_payment_intent_id, p_invoice_id, p_charge_id,
    p_receipt_url, p_hosted_invoice_url, p_invoice_pdf_url, p_receipt_email,
    p_card_brand, p_card_last4, p_purchase_id, p_period_start, p_period_end, p_failure_reason)
  returning * into v_row;
  return v_row;
end $function$
;

CREATE OR REPLACE FUNCTION public.stripe_cancel_subscription(p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
  select org_id, 'expiration', 'plan', -remaining_nanos, 'Subscription ended', id
  from public.credit_lots where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.credit_lots set remaining_nanos = 0
   where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.org_billing
     set plan_code = 'free', seats = 1, status = 'canceled',
         stripe_subscription_id = null, cancel_at_period_end = false,
         extra_fc_seats = 0
   where org_id = p_org;
end $function$
;

CREATE OR REPLACE FUNCTION private.analytics_scope()
 RETURNS analytics_scope
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.scope
  from public.analytics_staff s
  where s.user_id = private.analytics_actor();
$function$
;

CREATE OR REPLACE FUNCTION private.require_analytics(p_min analytics_scope DEFAULT 'investor'::analytics_scope)
 RETURNS analytics_scope
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_whoami()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.rollup_feature_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_day date;
  v_sessions integer;
  v_ms bigint;
  v_interactions bigint;
begin
  v_day := (new.started_at at time zone 'UTC')::date;

  if tg_op = 'INSERT' then
    v_sessions := 1;
    v_ms := new.active_ms;
    v_interactions := new.interactions;
  else
    v_sessions := 0;
    v_ms := new.active_ms - old.active_ms;
    v_interactions := new.interactions - old.interactions;
  end if;

  insert into public.feature_usage_daily (day, org_id, feature_key, sessions, active_ms, interactions)
  values (v_day, new.org_id, new.feature_key, v_sessions, v_ms, v_interactions)
  on conflict (day, org_id, feature_key) do update
    set sessions     = public.feature_usage_daily.sessions + excluded.sessions,
        active_ms    = public.feature_usage_daily.active_ms + excluded.active_ms,
        interactions = public.feature_usage_daily.interactions + excluded.interactions;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.feature_heartbeat(p_feature text, p_session uuid DEFAULT NULL::uuid, p_delta_ms integer DEFAULT 0, p_client text DEFAULT 'web'::text, p_interactions integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_delta integer;
  v_session uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from public.feature_catalog f where f.key = p_feature and f.is_active) then
    raise exception 'unknown_feature' using errcode = 'P0002', detail = p_feature;
  end if;

  -- Telemetry is attributed to the caller's org; a user outside an org has no
  -- org to attribute to, and is silently ignored rather than failing their page.
  select om.org_id into v_org
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;

  if v_org is null then
    return null;
  end if;

  v_delta := least(greatest(coalesce(p_delta_ms, 0), 0), 300000);

  if p_session is not null then
    update public.feature_usage_sessions s
       set active_ms    = least(s.active_ms + v_delta, 86400000),
           interactions = s.interactions + least(greatest(coalesce(p_interactions, 0), 0), 1000),
           last_seen_at = now()
     where s.id = p_session
       and s.user_id = auth.uid()
       and s.feature_key = p_feature
       and s.last_seen_at > now() - interval '30 minutes'
    returning s.id into v_session;

    if v_session is not null then
      return v_session;
    end if;
  end if;

  insert into public.feature_usage_sessions (org_id, user_id, feature_key, client, active_ms, interactions)
  values (
    v_org,
    auth.uid(),
    p_feature,
    case when coalesce(p_client, 'web') in ('web', 'mobile', 'desktop', 'api') then p_client else 'web' end,
    v_delta,
    least(greatest(coalesce(p_interactions, 0), 0), 1000)
  )
  returning id into v_session;

  return v_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.plan_mrr_cents(p_plan text, p_interval billing_interval, p_seats integer, p_status subscription_status)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_status not in ('active', 'past_due') then 0
    else coalesce((
      select (case
                when p_interval = 'annual' then coalesce(p.annual_price_cents, p.monthly_price_cents)
                else p.monthly_price_cents
              end)
             * (case when p.per_seat then greatest(coalesce(p_seats, 1), p.min_seats) else 1 end)
      from public.billing_plans p
      where p.code = p_plan
    ), 0)
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.record_billing_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'UPDATE'
     and new.plan_code              is not distinct from old.plan_code
     and new.billing_interval       is not distinct from old.billing_interval
     and new.seats                  is not distinct from old.seats
     and new.status                 is not distinct from old.status
     and new.atmosphere_plan_code   is not distinct from old.atmosphere_plan_code
     and new.included_fc_seats      is not distinct from old.included_fc_seats
     and new.extra_fc_seats         is not distinct from old.extra_fc_seats
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id
     and new.stripe_mrr_cents       is not distinct from old.stripe_mrr_cents
     and new.stripe_interval        is not distinct from old.stripe_interval
     and new.stripe_livemode        is not distinct from old.stripe_livemode then
    return new;
  end if;

  insert into public.org_billing_events (
    org_id, effective_at, plan_code, billing_interval, seats, status, mrr_cents, source,
    atmosphere_plan_code, fc_seats)
  values (
    new.org_id, now(), new.plan_code, new.billing_interval, new.seats, new.status,
    private.org_billing_mrr_cents(new),
    case when tg_op = 'INSERT' then 'signup' else 'change' end,
    new.atmosphere_plan_code, private.org_billing_fc_seats(new));

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pct_change(p_now numeric, p_prev numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when p_prev is null or p_prev = 0 or p_now is null then null
    else round(((p_now - p_prev) / abs(p_prev)) * 100, 1)
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_current_org()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select om.org_id
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_can_manage(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('project_manager', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.pm_project_in_org(p_project uuid, p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.pm_projects p
    where p.id = p_project and p.org_id = p_org
  );
$function$
;

CREATE OR REPLACE FUNCTION private.pm_assign_project_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.org_id is null then
    new.org_id := private.pm_current_org();
  end if;
  if new.org_id is null then
    raise exception 'you must belong to an organization before opening a project'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pm_projects:' || new.org_id::text, 0));
  select coalesce(max(seq_no), 0) + 1 into new.seq_no
  from public.pm_projects where org_id = new.org_id;

  new.project_number := 'PRJ-' || lpad(new.seq_no::text, 4, '0');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_stamp_project_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.phase is distinct from old.phase then
    if new.phase in ('mitigation', 'production', 'drying') and new.started_at is null then
      new.started_at := pg_catalog.now();
    end if;
    if new.phase in ('final_review', 'invoicing', 'paid') and new.completed_at is null then
      new.completed_at := pg_catalog.now();
    end if;
  end if;

  if new.status is distinct from old.status
     and new.status in ('closed', 'cancelled')
     and new.closed_at is null then
    new.closed_at := pg_catalog.now();
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_stamp_task_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := pg_catalog.now();
      new.completed_by := auth.uid();
    elsif new.status <> 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
    raise exception 'a blocked task needs a reason' using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_sync_equipment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' or (new.removed_at is null and old.removed_at is not null) then
    update public.pm_equipment
       set status = 'deployed'
     where id = new.equipment_id and status = 'available';
  elsif tg_op = 'UPDATE' and new.removed_at is not null and old.removed_at is null then
    update public.pm_equipment
       set status = 'available'
     where id = new.equipment_id and status = 'deployed';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_stamp_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status = 'provided' and new.provided_at is null then
      new.provided_at := pg_catalog.now();
      new.provided_by := auth.uid();
    elsif new.status = 'missing' then
      new.provided_at := null;
      new.provided_by := null;
    end if;
  end if;

  if new.status = 'waived' and coalesce(btrim(new.waived_reason), '') = '' then
    raise exception 'waiving a requirement needs a reason' using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_stamp_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' and new.approved_at is null then
      new.approved_at := pg_catalog.now();
      new.approved_by := auth.uid();
    elsif new.status = 'sent' and new.sent_at is null then
      new.sent_at := pg_catalog.now();
      new.sent_by := auth.uid();
    end if;
  end if;

  if new.status in ('approved', 'sent')
     and old.status in ('approved', 'sent')
     and new.body is distinct from old.body then
    raise exception 'an approved update cannot be rewritten — draft a new one'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_fill_org_from_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
begin
  if new.project_id is null then
    return new;
  end if;

  select p.org_id into v_org from public.pm_projects p where p.id = new.project_id;

  if v_org is null then
    raise exception 'project % does not exist', new.project_id using errcode = '23503';
  end if;

  new.org_id := v_org;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_guard_task_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if private.pm_can_manage(new.org_id) then
    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.assigned_to is distinct from old.assigned_to
     or new.title      is distinct from old.title
     or new.due_at     is distinct from old.due_at
     or new.priority   is distinct from old.priority
     or new.origin_key is distinct from old.origin_key
     or new.source     is distinct from old.source then
    raise exception 'only a project manager can reassign or re-scope a task'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_guard_document_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status = 'waived'
     and old.status is distinct from 'waived'
     and not private.pm_can_manage(new.org_id) then
    raise exception 'only a project manager can waive a documentation requirement'
      using errcode = '42501';
  end if;

  if (new.is_blocking is distinct from old.is_blocking
      or new.requirement_key is distinct from old.requirement_key)
     and not private.pm_can_manage(new.org_id) then
    raise exception 'only a project manager can change what a requirement is'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_guard_alert_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.org_id is distinct from old.org_id
     or new.rule_key is distinct from old.rule_key
     or new.fingerprint is distinct from old.fingerprint
     or new.project_id is distinct from old.project_id
     or new.first_seen_at is distinct from old.first_seen_at
     or new.created_at is distinct from old.created_at then
    raise exception 'pm_alerts: identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;

  if new.occurrences < old.occurrences then
    raise exception 'pm_alerts: occurrences cannot decrease'
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := pg_catalog.now();
      new.acknowledged_by := auth.uid();
    elsif new.status in ('resolved', 'dismissed') and new.resolved_at is null then
      new.resolved_at := pg_catalog.now();
      new.resolved_by := case when new.resolution = 'cleared' then null else auth.uid() end;
    elsif new.status = 'open' then
      new.resolved_at := null;
      new.resolved_by := null;
      new.resolution  := null;
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.estimator_is_org_member(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.estimator_can_manage_credentials(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION memory.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select m.org_id
  from public.org_members m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION memory.is_member_of(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION memory.is_org_member(p_org_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = p_user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION memory.reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'memory_events is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION memory.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION memory.changed_fields(p_changes jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(string_agg(k, ', ' order by k), 'no fields')
  from jsonb_object_keys(p_changes) as k;
$function$
;

CREATE OR REPLACE FUNCTION memory.job_in_org(p_job_id uuid, p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.crm_jobs j
    where j.id = p_job_id and j.org_id = p_org_id
  );
$function$
;

CREATE OR REPLACE FUNCTION memory.assign_job_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.org_id is null then
    new.org_id := memory.current_org_id();
  end if;
  if new.org_id is null then
    raise exception 'you must belong to an organization before opening a job'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));
  select coalesce(max(seq_no), 0) + 1 into new.seq_no
  from public.jobs
  where org_id = new.org_id;

  new.job_number := 'JOB-' || lpad(new.seq_no::text, 4, '0');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION memory.stamp_job_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then
      new.started_at := now();
    end if;
    if new.status in ('complete', 'invoiced', 'closed') and new.completed_at is null then
      new.completed_at := now();
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION memory.stamp_task_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := now();
      new.completed_by := auth.uid();
    elsif new.status <> 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION memory.capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'memory', 'pg_temp'
AS $function$
declare
  v_entity  text  := tg_argv[0];
  v_new     jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old     jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_actor   uuid  := auth.uid();
  v_org     uuid;
  v_job     uuid;
  v_label   text;
  v_event   text;
  v_summary text;
  v_key     text;
begin
  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  if v_org is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = 'updated_at' then
        continue;
      end if;
      if v_new -> v_key is distinct from v_old -> v_key then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      end if;
    end loop;

    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;

  v_job := case
    when v_entity = 'job' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'job_id', '')::uuid
  end;

  -- BEFORE INSERT on crm_jobs (or a trigger attached to the wrong table with
  -- entity 'job') would set job_id to a row that is not in crm_jobs yet. A
  -- stray FK then aborts the parent write. Leave job_id null rather than fail.
  if v_job is not null and not exists (
    select 1 from public.crm_jobs j where j.id = v_job
  ) then
    v_job := null;
  end if;

  v_event := v_entity || '.' || case tg_op
    when 'INSERT' then 'created'
    when 'DELETE' then 'deleted'
    else case
      when v_changes ? 'status'      then 'status_changed'
      when v_changes ? 'assigned_to' then 'reassigned'
      when v_changes ? 'released_at' then 'released'
      else 'updated'
    end
  end;

  v_label := coalesce(v_row ->> 'title', v_row ->> 'name', '');

  v_summary := case
    when v_entity = 'job' and tg_op = 'INSERT' then
      format('opened job #%s — %s', v_row ->> 'job_number', v_label)
    when v_entity = 'job' and tg_op = 'DELETE' then
      format('deleted job #%s — %s', v_row ->> 'job_number', v_label)
    when v_entity = 'job' and v_changes ? 'status' then
      format('moved job #%s from %s to %s', v_row ->> 'job_number',
             v_changes #>> '{status,from}', v_changes #>> '{status,to}')
    when v_entity = 'job' then
      format('updated job #%s (%s)', v_row ->> 'job_number', memory.changed_fields(v_changes))

    when v_entity = 'task' and tg_op = 'INSERT' then
      format('added task "%s"', v_label)
    when v_entity = 'task' and v_changes ? 'status' then
      format('marked task "%s" as %s', v_label, v_changes #>> '{status,to}')
    when v_entity = 'task' and v_changes ? 'assigned_to' then
      format('reassigned task "%s"', v_label)
    when v_entity = 'task' then
      format('updated task "%s" (%s)', v_label, memory.changed_fields(v_changes))

    when v_entity = 'assignment' and tg_op = 'INSERT' then
      format('put a %s on the job', v_row ->> 'role_on_job')
    when v_entity = 'assignment' and v_changes ? 'released_at' then
      'released someone from the job'
    when v_entity = 'assignment' then
      format('changed an assignment (%s)', memory.changed_fields(v_changes))

    when v_entity = 'work_log' and tg_op = 'INSERT' then
      format('logged %s%s', v_row ->> 'kind',
             case when v_row ->> 'minutes' is null then ''
                  else format(' (%s min)', v_row ->> 'minutes') end)
    when v_entity = 'work_log' then
      format('edited a %s entry (%s)', v_row ->> 'kind', memory.changed_fields(v_changes))

    else format('%s a %s', lower(tg_op), v_entity)
  end;

  begin
    insert into public.memory_events (
      org_id, actor_id, actor_email, actor_role,
      event_type, entity_type, entity_id, job_id,
      summary, changes, snapshot, source
    )
    values (
      v_org,
      v_actor,
      (select p.email from public.profiles p where p.id = v_actor),
      (select m.role::text from public.org_members m
        where m.user_id = v_actor and m.org_id = v_org limit 1),
      v_event, v_entity, (v_row ->> 'id')::uuid, v_job,
      v_summary, v_changes, v_new, 'trigger'
    );
  exception
    when others then
      raise warning 'memory.capture skipped (%) for %.%: %',
        v_event, v_entity, v_row ->> 'id', sqlerrm;
  end;

  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_memory_event(p_event_type text, p_summary text, p_entity_type text DEFAULT 'session'::text, p_entity_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'memory', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_org   uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_event_type !~ '^(auth|session|view|export|note)\.[a-z_]+$' then
    raise exception 'event type "%" cannot be recorded by a client', p_event_type
      using errcode = '22023';
  end if;

  v_org := memory.current_org_id();
  -- Signing in before onboarding is legitimate and has no org to file under.
  if v_org is null then
    return null;
  end if;

  if p_job_id is not null and not memory.job_in_org(p_job_id, v_org) then
    raise exception 'job does not belong to your organization' using errcode = '42501';
  end if;

  insert into public.memory_events (
    org_id, actor_id, actor_email, actor_role,
    event_type, entity_type, entity_id, job_id,
    summary, changes, snapshot, source
  )
  values (
    v_org, v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    (select m.role::text from public.org_members m
      where m.user_id = v_actor and m.org_id = v_org limit 1),
    p_event_type, p_entity_type, p_entity_id, p_job_id,
    left(p_summary, 500), '{}'::jsonb, coalesce(p_details, '{}'::jsonb), 'app'
  )
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.can_sell(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('sales', 'project_manager', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.pm_bump_thread_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.pm_threads
     set last_message_at = new.created_at,
         updated_at = pg_catalog.now()
   where id = new.thread_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.pm_fill_org_from_thread()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
begin
  select t.org_id into v_org from public.pm_threads t where t.id = new.thread_id;
  if v_org is null then
    raise exception 'thread % does not exist', new.thread_id using errcode = '23503';
  end if;
  new.org_id := v_org;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_org_contractor_type(p_contractor_type text)
 RETURNS orgs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org public.orgs;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_contractor_type is null
     or p_contractor_type not in ('restoration', 'roofing', 'general_contractor', 'other') then
    raise exception 'invalid contractor type' using errcode = '22023';
  end if;

  select om.org_id into v_org_id
  from public.org_members om
  where om.user_id = v_uid
  order by om.created_at
  limit 1;

  if v_org_id is null then
    raise exception 'not linked to an organization' using errcode = 'P0002';
  end if;

  update public.orgs o
     set contractor_type = p_contractor_type
   where o.id = v_org_id
     and (
       o.created_by = v_uid
       or o.contractor_type is null
     )
  returning * into v_org;

  if not found then
    raise exception 'cannot change contractor type for this organization' using errcode = '42501';
  end if;

  return v_org;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_connectors_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.homeowner_portal_bump_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  update public.homeowner_portal_conversations
     set last_message_at = new.created_at,
         updated_at = pg_catalog.now()
   where id = new.conversation_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.finance_current_org()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select om.org_id
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.can_manage_finance(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.open_finance_share(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_hash text;
  v_link public.finance_share_links%rowtype;
  v_pkg public.finance_share_packages%rowtype;
  v_docs jsonb;
  v_org_name text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    raise exception 'invalid share token' using errcode = '22023';
  end if;

  v_hash := encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select * into v_link
  from public.finance_share_links
  where token_hash = v_hash
  limit 1;

  if not found then
    raise exception 'share not found' using errcode = 'P0002';
  end if;

  if v_link.revoked_at is not null then
    raise exception 'share revoked' using errcode = 'P0001';
  end if;

  if v_link.expires_at <= now() then
    raise exception 'share expired' using errcode = 'P0001';
  end if;

  if v_link.max_views is not null and v_link.view_count >= v_link.max_views then
    raise exception 'share view limit reached' using errcode = 'P0001';
  end if;

  select * into v_pkg
  from public.finance_share_packages
  where id = v_link.package_id;

  if not found or v_pkg.status <> 'active' then
    raise exception 'share is not published' using errcode = 'P0001';
  end if;

  update public.finance_share_links
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = v_link.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'kind', d.kind,
        'description', d.description,
        'externalRef', d.external_ref,
        'periodLabel', d.period_label,
        'sortOrder', d.sort_order
      )
      order by d.sort_order, d.created_at
    ),
    '[]'::jsonb
  )
  into v_docs
  from public.finance_share_documents d
  where d.package_id = v_pkg.id;

  select o.name into v_org_name from public.orgs o where o.id = v_pkg.org_id;

  return jsonb_build_object(
    'packageId', v_pkg.id,
    'title', v_pkg.title,
    'purpose', v_pkg.purpose,
    'recipientName', v_pkg.recipient_name,
    'recipientOrg', v_pkg.recipient_org,
    'coverNote', v_pkg.cover_note,
    'sections', v_pkg.sections,
    'report', v_pkg.report,
    'companyProfile', v_pkg.company_profile,
    'documents', v_docs,
    'orgName', v_org_name,
    'publishedAt', v_pkg.published_at,
    'expiresAt', v_link.expires_at,
    'viewCount', v_link.view_count + 1
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.freeze_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.org_id := old.org_id;
  new.created_by := old.created_by;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.next_counter(p_org uuid, p_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_value bigint;
begin
  insert into public.crm_counters (org_id, name, value)
  values (p_org, p_name, 1)
  on conflict on constraint crm_counters_org_name_unique
    do update set value = public.crm_counters.value + 1
  returning value into v_value;

  return v_value;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.assign_job_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.job_number is null or new.job_number = 0 then
    new.job_number := private.next_counter(new.org_id, 'job_number');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_brief_next_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.revision is null or new.revision = 0 then
    select coalesce(max(revision), 0) + 1 into new.revision
    from public.job_briefs where job_id = new.job_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_briefs_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'A brief revision is a record of what was true. Publish a new revision instead.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_messages_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Messages on a shared job record cannot be edited or deleted. Post a correction.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_proof_questions_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'A question and its answer are a record of what somebody was told. Ask again instead.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_evidence_access_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'The chain of custody cannot be edited or deleted.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.evidence_downloads_settle_once()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status <> 'pending_payment' then
    raise exception 'A settled download is a record. It cannot change.';
  end if;
  if new.status = 'pending_payment' then
    raise exception 'A download can only move from pending to paid or waived.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.resolve_ai_model_pricing(p_provider text, p_model text, p_at timestamp with time zone DEFAULT now())
 RETURNS private.ai_model_pricing
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
  select *
  from private.ai_model_pricing p
  where p.provider = p_provider
    and p.model = p_model
    and p.is_active
    and p.effective_from <= p_at
    and (p.effective_to is null or p.effective_to > p_at)
  order by p.effective_from desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.resolve_compute_unit_rate(p_at timestamp with time zone DEFAULT now())
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
  select c.usd_per_compute_unit
  from private.compute_unit_config c
  where c.is_active
    and c.effective_from <= p_at
    and (c.effective_to is null or c.effective_to > p_at)
  order by c.effective_from desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.usd_to_nanos(p_usd numeric)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select round(p_usd * 1000000000)::bigint;
$function$
;

CREATE OR REPLACE FUNCTION private.estimate_ai_cost_nanos(p_pricing private.ai_model_pricing, p_input_tokens bigint, p_output_tokens bigint, p_cached_input_tokens bigint, p_reasoning_tokens bigint, p_image_count integer, p_video_seconds numeric, p_audio_seconds numeric, p_ocr_pages integer, p_embedding_tokens bigint, p_third_party_cost_nanos bigint, p_other_variable_cost_nanos bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_usd numeric := 0;
  v_mtok numeric := 1000000.0;
begin
  if p_pricing.id is not null then
    v_usd := v_usd
      + (coalesce(p_input_tokens, 0)::numeric * coalesce(p_pricing.input_token_price_usd, 0) / v_mtok)
      + (coalesce(p_output_tokens, 0)::numeric * coalesce(p_pricing.output_token_price_usd, 0) / v_mtok)
      + (coalesce(p_cached_input_tokens, 0)::numeric * coalesce(p_pricing.cached_input_token_price_usd, p_pricing.input_token_price_usd * 0.1, 0) / v_mtok)
      + (coalesce(p_reasoning_tokens, 0)::numeric * coalesce(p_pricing.output_token_price_usd, 0) / v_mtok)
      + (coalesce(p_image_count, 0)::numeric * coalesce(p_pricing.image_price_usd, 0))
      + (coalesce(p_video_seconds, 0)::numeric * coalesce(p_pricing.video_second_price_usd, 0))
      + (coalesce(p_audio_seconds, 0)::numeric * coalesce(p_pricing.audio_second_price_usd, 0))
      + (coalesce(p_ocr_pages, 0)::numeric * coalesce(p_pricing.ocr_page_price_usd, 0))
      + (coalesce(p_embedding_tokens, 0)::numeric * coalesce(p_pricing.embedding_token_price_usd, 0) / v_mtok);
  end if;
  return private.usd_to_nanos(v_usd)
    + coalesce(p_third_party_cost_nanos, 0)
    + coalesce(p_other_variable_cost_nanos, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.metering_period_bounds(p_org uuid, p_reference timestamp with time zone DEFAULT now())
 RETURNS TABLE(period_start date, period_end date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_anchor smallint := 1;
  v_ref date := (p_reference at time zone 'utc')::date;
  v_start date;
begin
  select coalesce(m.period_anchor_day, 1) into v_anchor
  from public.org_metering m where m.org_id = p_org;
  if not found then v_anchor := 1; end if;

  if extract(day from v_ref)::int >= v_anchor then
    v_start := make_date(extract(year from v_ref)::int, extract(month from v_ref)::int, v_anchor);
  else
    v_start := (make_date(extract(year from v_ref)::int, extract(month from v_ref)::int, v_anchor) - interval '1 month')::date;
  end if;

  period_start := v_start;
  period_end := (v_start + interval '1 month')::date;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.org_metering_terms(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  m public.org_metering%rowtype;
  v public.metering_plan_versions%rowtype;
  p public.metering_plans%rowtype;
begin
  select * into m from public.org_metering where org_id = p_org;
  if not found then return null; end if;
  select * into v from public.metering_plan_versions where id = m.plan_version_id;
  select * into p from public.metering_plans where id = v.plan_id;

  return jsonb_build_object(
    'planCode', p.code,
    'planName', p.name,
    'planVersion', v.version,
    'planVersionId', v.id,
    'baseMonthlyFeeCents', coalesce(m.override_base_monthly_fee_cents, v.base_monthly_fee_cents),
    'includedJobs', coalesce(m.override_included_jobs, v.included_jobs),
    'additionalJobPriceCents', coalesce(m.override_additional_job_price_cents, v.additional_job_price_cents),
    'includedComputeUnits', coalesce(m.override_included_compute_units, v.included_compute_units),
    'computeUnitOverageNanos', coalesce(m.override_compute_unit_overage_nanos, v.compute_unit_overage_nanos),
    'videoHourPriceCents', coalesce(m.override_video_hour_price_cents, v.video_hour_price_cents),
    'billingPeriodDays', v.billing_period_days,
    'periodAnchorDay', m.period_anchor_day,
    'hardStopAtLimit', m.hard_stop_at_limit,
    'usageLimitJobs', m.usage_limit_jobs,
    'usageLimitComputeUnits', m.usage_limit_compute_units,
    'alertThresholdPct', m.alert_threshold_pct,
    'marginAlertPct', m.margin_alert_pct
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_ai_usage_event(p_org uuid, p_idempotency_key text, p_action_type text, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_workflow_id text DEFAULT NULL::text, p_agent_run_id text DEFAULT NULL::text, p_agent_type text DEFAULT NULL::text, p_input_tokens bigint DEFAULT 0, p_output_tokens bigint DEFAULT 0, p_cached_input_tokens bigint DEFAULT 0, p_reasoning_tokens bigint DEFAULT 0, p_image_count integer DEFAULT 0, p_video_seconds numeric DEFAULT 0, p_audio_seconds numeric DEFAULT 0, p_ocr_pages integer DEFAULT 0, p_embedding_tokens bigint DEFAULT 0, p_third_party_cost_nanos bigint DEFAULT 0, p_other_variable_cost_nanos bigint DEFAULT 0, p_billable boolean DEFAULT true, p_metadata jsonb DEFAULT '{}'::jsonb, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.register_billable_job(p_org uuid, p_job_id uuid, p_workflow_type text, p_idempotency_key text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_bounds record;
  v_existing public.billing_period_jobs%rowtype;
  v_wf public.qualifying_workflow_types%rowtype;
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_wf from public.qualifying_workflow_types
  where code = p_workflow_type and is_active;
  if not found then
    raise exception 'unknown_workflow' using detail = p_workflow_type, errcode = 'P0002';
  end if;

  select * into v_bounds from private.metering_period_bounds(p_org, p_at);

  select * into v_existing from public.billing_period_jobs
  where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('jobId', v_existing.job_id, 'duplicate', true, 'periodStart', v_existing.period_start);
  end if;

  select * into v_existing from public.billing_period_jobs
  where org_id = p_org and period_start = v_bounds.period_start and job_id = p_job_id;
  if found then
    return jsonb_build_object('jobId', v_existing.job_id, 'duplicate', true, 'periodStart', v_existing.period_start);
  end if;

  insert into public.billing_period_jobs (
    org_id, period_start, period_end, job_id, workflow_type, first_event_at, idempotency_key
  ) values (
    p_org, v_bounds.period_start, v_bounds.period_end, p_job_id, p_workflow_type, coalesce(p_at, now()), p_idempotency_key
  );

  return jsonb_build_object('jobId', p_job_id, 'duplicate', false, 'periodStart', v_bounds.period_start);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_metering_period(p_org uuid, p_period_start date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.calculate_metering_period_unchecked(p_org, p_period_start);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.customer_metering_summary(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if not private.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.customer_metering_summary_unchecked(p_org);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_metering_period(p_org uuid, p_period_start date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_calc jsonb;
  v_bounds record;
  v_cu_rate numeric;
  v_stmt public.billing_period_statements%rowtype;
begin
  if not private.can_manage_billing(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_bounds from private.metering_period_bounds(p_org, coalesce(p_period_start::timestamptz, now()));
  if p_period_start is not null then
    v_bounds.period_start := p_period_start;
    v_bounds.period_end := (p_period_start + interval '1 month')::date;
  end if;

  v_calc := public.calculate_metering_period(p_org, v_bounds.period_start);
  v_cu_rate := coalesce(private.resolve_compute_unit_rate(now()), 0.01);

  insert into public.billing_period_statements (
    org_id, period_start, period_end, status, plan_snapshot, pricing_snapshot, summary, closed_at
  ) values (
    p_org,
    v_bounds.period_start,
    v_bounds.period_end,
    'closed',
    v_calc->'terms',
    jsonb_build_object('computeUnitRateUsd', v_cu_rate, 'closedAt', now()),
    v_calc,
    now()
  )
  on conflict (org_id, period_start) do update set
    status = 'closed',
    plan_snapshot = excluded.plan_snapshot,
    pricing_snapshot = excluded.pricing_snapshot,
    summary = excluded.summary,
    closed_at = now()
  returning * into v_stmt;

  return jsonb_build_object('statementId', v_stmt.id, 'summary', v_stmt.summary);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.ensure_org_metering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_plan_version_id uuid;
begin
  select pv.id into v_plan_version_id
  from public.metering_plan_versions pv
  join public.metering_plans p on p.id = pv.plan_id
  where p.code = 'work_verification'
    and pv.effective_to is null
  order by pv.version desc
  limit 1;

  if v_plan_version_id is not null then
    insert into public.org_metering (org_id, plan_version_id)
    values (new.id, v_plan_version_id)
    on conflict (org_id) do nothing;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_location_no_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  walker uuid := new.parent_id;
  hops   int := 0;
begin
  while walker is not null loop
    if walker = new.id then
      raise exception 'A location cannot be inside itself.';
    end if;
    hops := hops + 1;
    if hops > 20 then
      raise exception 'Location nesting is too deep to be real.';
    end if;
    select parent_id into walker from public.job_locations where id = walker;
  end loop;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.human_review_decisions_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Human review decisions are append-only. Record a new decision instead.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.verification_audit_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Verification audit events are append-only.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.llm_verification_runs_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'LLM verification runs are append-only. Create a new run instead.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.dataset_versions_protect_released()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status = 'released' and tg_op = 'UPDATE' then
    if new.example_count is distinct from old.example_count
       or new.checksum_manifest is distinct from old.checksum_manifest
       or new.ontology_version is distinct from old.ontology_version
       or new.schema_version is distinct from old.schema_version
       or new.version is distinct from old.version then
      raise exception 'Released dataset versions are immutable. Create a new version instead.';
    end if;
  end if;
  if old.status = 'released' and tg_op = 'DELETE' then
    raise exception 'Released dataset versions cannot be deleted. Mark revoked instead.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.mirror_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'crm_external_records is append-only: delete the source to remove its mirror'
      using errcode = 'restrict_violation';
  end if;

  if new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash
     or new.external_id is distinct from old.external_id
     or new.entity_type is distinct from old.entity_type
     or new.version is distinct from old.version
     or new.org_id is distinct from old.org_id
     or new.source_id is distinct from old.source_id
     or new.fetched_at is distinct from old.fetched_at then
    raise exception 'crm_external_records payloads are immutable; append a new version instead'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.expire_backups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_count integer;
begin
  update public.backup_snapshots
     set status = 'expired'
   where status = 'completed'
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.backup_public_tables()
 RETURNS TABLE(table_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
   order by 1;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_poolable_address(addr text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select addr is not null
     and addr = lower(addr)
     and addr ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     and split_part(addr, '@', 2) not in (
       'gmail.com','googlemail.com',
       'yahoo.com','yahoo.co.uk','yahoo.ca','yahoo.com.au','yahoo.fr','yahoo.de',
       'ymail.com','rocketmail.com',
       'hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com',
       'icloud.com','me.com','mac.com',
       'proton.me','protonmail.com','pm.me','tutanota.com','tuta.io','hushmail.com',
       'aol.com','aim.com','gmx.com','gmx.net','gmx.de','mail.com',
       'zoho.com','yandex.com','yandex.ru','fastmail.com','fastmail.fm',
       'inbox.com','mail.ru','qq.com','163.com','126.com','naver.com',
       'daum.net','seznam.cz','web.de','t-online.de','orange.fr','wanadoo.fr',
       'free.fr','libero.it','virgilio.it','terra.com.br','uol.com.br',
       'bol.com.br','rediffmail.com','sina.com','comcast.net','verizon.net',
       'att.net','sbcglobal.net','bellsouth.net','cox.net','charter.net',
       'earthlink.net','juno.com','btinternet.com','sky.com','talktalk.net',
       'shaw.ca','rogers.com','telus.net','bigpond.com','optusnet.com.au',
       -- Throwaway inboxes: whoever used one did not want to be contacted.
       'mailinator.com','guerrillamail.com','guerrillamail.net','10minutemail.com',
       'temp-mail.org','tempmail.com','throwawaymail.com','yopmail.com',
       'trashmail.com','sharklasers.com','getnada.com','maildrop.cc',
       'dispostable.com','fakeinbox.com','mintemail.com','spamgourmet.com',
       'mailnesia.com','tempinbox.com','moakt.com','emailondeck.com'
     )
     and split_part(addr, '@', 1) not in (
       'info','sales','support','admin','office','contact','hello','help',
       'billing','accounts','noreply','no-reply','postmaster','webmaster',
       'abuse','marketing','jobs','careers','team'
     )
$function$
;

CREATE OR REPLACE FUNCTION public.network_block_erased()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if exists (select 1 from public.network_erasures e where e.email = new.email) then
    raise exception 'address_erased' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.network_erase(p_email text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.network_erasures (email, reason)
  values (lower(p_email), p_reason)
  on conflict (email) do nothing;

  delete from public.network_contacts where email = lower(p_email);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.network_contribute(p_org uuid, p_email text, p_full_name text, p_title text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(trim(p_email));
  v_opted boolean;
begin
  select contributing into v_opted
  from public.network_contribution_settings
  where org_id = p_org;

  if coalesce(v_opted, false) is not true then
    return false;
  end if;

  if not public.is_poolable_address(v_email) then
    return false;
  end if;

  if exists (select 1 from public.network_erasures where email = v_email) then
    return false;
  end if;

  insert into public.network_contacts (
    email, domain, full_name, title, company_name, phone, mobile, contributed_by
  )
  values (
    v_email, split_part(v_email, '@', 2), trim(p_full_name),
    p_title, p_company, p_phone, p_mobile, p_org
  )
  on conflict (email, contributed_by) do update
    set full_name = excluded.full_name,
        title = coalesce(excluded.title, public.network_contacts.title),
        company_name = coalesce(excluded.company_name, public.network_contacts.company_name),
        phone = coalesce(excluded.phone, public.network_contacts.phone),
        mobile = coalesce(excluded.mobile, public.network_contacts.mobile),
        contributed_at = now();

  -- Corroboration counts distinct contributors, so an org re-syncing its own
  -- CRM cannot inflate confidence in its own data.
  update public.network_contacts
     set corroborations = (
       select count(distinct contributed_by)
       from public.network_contacts n2
       where n2.email = v_email
     )
   where email = v_email;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.network_withdraw(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  delete from public.network_contacts where contributed_by = p_org;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_unsubscribe(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_send public.analytics_campaign_sends%rowtype;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return true;
  end if;

  select * into v_send from public.analytics_campaign_sends where unsubscribe_token = p_token;
  if not found then
    return true;
  end if;

  insert into public.analytics_email_suppressions (email, reason, campaign_id)
  values (v_send.email, 'unsubscribe', v_send.campaign_id)
  on conflict (email) do nothing;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_crew_location(p_lat double precision, p_lon double precision, p_accuracy double precision DEFAULT NULL::double precision, p_heading double precision DEFAULT NULL::double precision, p_speed double precision DEFAULT NULL::double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_consent public.crew_location_consent%rowtype;
  v_hours integer;
begin
  select * into v_consent
  from public.crew_location_consent
  where user_id = auth.uid();

  -- No consent, no row. Silently, because the client may still be finishing a
  -- watch it started before the person switched sharing off, and that is not
  -- an error worth surfacing to them.
  if not found or v_consent.sharing is not true then
    return false;
  end if;

  select coalesce(location_retention_hours, 24) into v_hours
  from public.orgs where id = v_consent.org_id;

  insert into public.crew_locations (org_id, user_id, lat, lon, accuracy_m, heading, speed_mps, expires_at)
  values (
    v_consent.org_id, auth.uid(), p_lat, p_lon, p_accuracy, p_heading, p_speed,
    now() + make_interval(hours => coalesce(v_hours, 24))
  );

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stop_sharing_location()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted integer;
begin
  update public.crew_location_consent
     set sharing = false, decided_at = now(), updated_at = now()
   where user_id = auth.uid();

  delete from public.crew_locations where user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_expired_locations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_deleted integer;
begin
  delete from public.crew_locations where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.crm_accounts_no_cycles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cursor uuid := new.parent_account_id;
  v_depth  int := 0;
begin
  if new.parent_account_id is null then return new; end if;

  if new.parent_account_id = new.id then
    raise exception 'An account cannot be its own parent.';
  end if;

  -- Walk up. Twenty is far deeper than any real corporate structure and is
  -- here as a backstop in case a cycle predates this trigger.
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = new.id then
      raise exception 'That would put % under itself.', new.name;
    end if;
    select parent_account_id into v_cursor from public.crm_accounts where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  if v_depth >= 20 then
    raise exception 'Account hierarchy is too deep — twenty levels is already more than any real one.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.crm_account_merges_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'A merge is a record of something that happened. It cannot be edited away.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.purchase_order_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status = new.status then
    -- Same-status edits: fine in draft, refused once placed or cancelled.
    -- (Approved orders allow metadata edits like external_ref, but their
    -- lines are frozen by the line trigger below.)
    if old.status in ('placed', 'cancelled')
       and (new.supplier, new.job_name, new.note, new.external_ref)
           is distinct from (old.supplier, old.job_name, old.note, old.external_ref) then
      raise exception 'A % order is a record. It cannot be edited.', old.status;
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft'    and new.status in ('approved', 'cancelled')) or
    (old.status = 'approved' and new.status in ('placed', 'draft', 'cancelled'))
  ) then
    raise exception 'A purchase order cannot go from % to %.', old.status, new.status;
  end if;

  -- Withdrawing approval clears the stamps — a reopened draft carries no
  -- residue of a signature that no longer stands.
  if old.status = 'approved' and new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.purchase_order_lines_frozen()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_status text;
begin
  select status into v_status
    from public.purchase_orders
   where id = coalesce(new.po_id, old.po_id);

  -- Deleting lines under a cascade (parent row already gone) is allowed.
  if v_status is null then
    return coalesce(new, old);
  end if;

  if v_status <> 'draft' then
    raise exception
      'This order is %. Its lines are what was approved — reopen it to draft to change them.',
      v_status;
  end if;
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.purchase_order_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Order history cannot be edited or deleted.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.episode_verifications_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'A verification result is a record of what someone found. Add a new one.';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_org_membership()
 RETURNS TABLE(role member_role, work_type work_type, usage_intents text[], status text, org_id uuid, org_name text, org_join_code text, org_contractor_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.platform_staff_scope()
 RETURNS platform_staff_scope
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.scope from public.platform_staff s where s.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION private.require_platform_staff(p_min platform_staff_scope DEFAULT 'support'::platform_staff_scope)
 RETURNS platform_staff_scope
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_scope public.platform_staff_scope;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_scope := private.platform_staff_scope();

  if v_scope is null then
    raise exception 'platform_admin_forbidden' using errcode = '42501';
  end if;
  if v_scope < p_min then
    raise exception 'platform_admin_scope_insufficient'
      using errcode = '42501', detail = format('have=%s need=%s', v_scope, p_min);
  end if;

  return v_scope;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.platform_admin_whoami()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'scope', (select s.scope from public.platform_staff s where s.user_id = auth.uid()),
    'display_name', (select s.display_name from public.platform_staff s where s.user_id = auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.preview_org_by_join_code(p_code text)
 RETURNS TABLE(name text, join_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select o.name, o.join_code
  from public.orgs o
  where o.join_code = upper(trim(p_code))
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.repair_memory_job_fk()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  dropped boolean := false;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(con.conkey) as cols(attnum) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = cols.attnum
    where con.contype = 'f'
      and c.relname = 'memory_events'
      and a.attname = 'job_id'
  loop
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      r.sch,
      r.tbl,
      r.conname
    );
    dropped := true;
  end loop;
  return dropped;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.legal_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Legal records cannot be edited or deleted.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.legal_holds_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'A legal hold cannot be deleted. Release it.';
  end if;
  if old.status = 'released' and new.status is distinct from old.status then
    raise exception 'A released hold cannot be reopened in place. Open a new hold.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.legal_vault_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vaulted video cannot be destroyed.';
  end if;
  if new.org_id is distinct from old.org_id
     or new.source_kind is distinct from old.source_kind
     or new.source_id is distinct from old.source_id
     or new.storage_backend is distinct from old.storage_backend
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_key is distinct from old.storage_key
     or new.content_hash is distinct from old.content_hash
     or new.vaulted_at is distinct from old.vaulted_at then
    raise exception 'Vault identity cannot be rewritten.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_proofs_forbid_destroy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Proof video cannot be destroyed. Soft-delete it so the vault keeps the file.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.media_objects_forbid_destroy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1 from public.legal_video_vault v
     where v.source_kind = 'media_object' and v.source_id = old.id
  ) or old.legal_hold or old.deleted_at is not null then
    raise exception 'Media object cannot be destroyed. Soft-delete it so the vault keeps the file.';
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.episode_annotations_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'An annotation is a record of what a model or person said. Add a new one.';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stripe_event_forget(p_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  delete from private.stripe_events where id = p_event_id;
end $function$
;

CREATE OR REPLACE FUNCTION private.org_members_guard_product_seat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_phone text;
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
  select nullif('+' || regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '+')
    into v_phone from auth.users u where u.id = new.user_id;
  select exists (
    select 1 from public.org_invites i
    where i.org_id = new.org_id
      and i.status = 'pending'
      and (
        (v_email is not null and lower(i.email) = lower(v_email))
        or (v_phone is not null and i.phone = v_phone)
      )
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
$function$
;

CREATE OR REPLACE FUNCTION public.classify_token_feature(p_feature text)
 RETURNS token_usage_feature
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_feature is null or btrim(p_feature) = '' then 'other'::public.token_usage_feature
    when lower(p_feature) in (
      'computer', 'computer_use', 'computer_agent', 'computer_session', 'computer_browser'
    )
      or lower(p_feature) ~ '^computer([_-]|$)'
      then 'computer'::public.token_usage_feature
    when lower(p_feature) in (
      'web_search', 'web-search', 'tavily', 'tavily_search', 'gemini_search'
    )
      then 'web_search'::public.token_usage_feature
    when lower(p_feature) in (
      'video_analysis', 'verification', 'llm_verifier', 'vision', 'analyzer',
      'proof_analysis', 'frame_analysis', 'video', 'vision_analyzer',
      'work_event_verification', 'escalation', 'clip_analysis'
    )
      or lower(p_feature) ~ '(^|[_-])(video|verif|analys|vision|frame)([_-]|$)'
      then 'video_analysis'::public.token_usage_feature
    when lower(p_feature) in (
      'ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask', 'research'
    )
      or lower(p_feature) ~ '(^|[_-])ask([_-]|$)'
      then 'ask'::public.token_usage_feature
    when lower(p_feature) in (
      'chat', 'model_completion', 'field_assistant', 'technician',
      'voice', 'assist', 'field-assistant', 'technician_assist', 'field_assist'
    )
      or lower(p_feature) ~ '(chat|assist|voice|completion)'
      then 'chat'::public.token_usage_feature
    else 'other'::public.token_usage_feature
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.intake_create_job_file(p_org_id uuid, p_title text, p_work_type text, p_address text, p_city text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_claim_number text DEFAULT NULL::text, p_brief_note text DEFAULT NULL::text, p_facts jsonb DEFAULT '{}'::jsonb, p_scope jsonb DEFAULT '[]'::jsonb, p_invitees jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_property_id uuid;
  v_job_id uuid;
  v_job_number bigint;
  v_job_title text;
  v_revision integer;
  v_invitee jsonb;
  v_party_id uuid;
  v_party_company text;
  v_party_email text;
  v_party_token text;
  v_parties jsonb := '[]'::jsonb;
  v_scope_count integer := 0;
  v_source text;
  v_external boolean;
  v_company text;
  v_trade text;
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_org_id is null or not private.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) < 1 then
    raise exception 'title_required';
  end if;
  if p_work_type is null or p_work_type not in ('mitigation', 'construction') then
    raise exception 'work_type_invalid';
  end if;
  if jsonb_typeof(coalesce(p_invitees, '[]'::jsonb)) <> 'array' then
    raise exception 'invitees_invalid';
  end if;

  if v_address is not null then
    insert into public.crm_properties (
      org_id, address_line1, city, postal_code, region, country, latitude, longitude
    )
    values (
      p_org_id,
      left(v_address, 200),
      nullif(left(btrim(coalesce(p_city, '')), 120), ''),
      nullif(left(btrim(coalesce(p_postal_code, '')), 20), ''),
      nullif(left(btrim(coalesce(p_region, '')), 120), ''),
      coalesce(nullif(left(btrim(coalesce(p_country, '')), 8), ''), 'US'),
      p_latitude,
      p_longitude
    )
    returning id into v_property_id;
  end if;

  insert into public.crm_jobs (
    org_id, title, work_type, property_id, claim_number, status, created_by
  )
  values (
    p_org_id,
    left(btrim(p_title), 200),
    p_work_type::public.work_type,
    v_property_id,
    nullif(left(btrim(coalesce(p_claim_number, '')), 80), ''),
    'scheduled',
    v_uid
  )
  returning id, title, job_number into v_job_id, v_job_title, v_job_number;

  v_source := case
    when jsonb_array_length(coalesce(p_scope, '[]'::jsonb)) > 0 then 'scope_document'
    else 'manual'
  end;

  insert into public.job_intake (job_id, org_id, source, source_detail, entered_by)
  values (
    v_job_id,
    p_org_id,
    v_source,
    jsonb_build_object(
      'enteredFrom', 'intake_package',
      'captureInvites', jsonb_array_length(coalesce(p_invitees, '[]'::jsonb)),
      'scopeOptional', v_source = 'manual'
    ),
    v_uid
  );

  insert into public.job_briefs (org_id, job_id, revision, facts, note, created_by)
  values (
    p_org_id,
    v_job_id,
    0,
    coalesce(p_facts, '{}'::jsonb),
    nullif(left(btrim(coalesce(p_brief_note, '')), 2000), ''),
    v_uid
  )
  returning revision into v_revision;

  insert into public.job_scope_items (
    org_id, job_id, title, state, reason, revision, created_by
  )
  select
    p_org_id,
    v_job_id,
    left(btrim(s->>'title'), 200),
    case
      when s->>'state' = 'excluded' then 'excluded'::public.job_scope_state
      else 'included'::public.job_scope_state
    end,
    nullif(left(btrim(coalesce(s->>'reason', '')), 1000), ''),
    v_revision,
    v_uid
  from jsonb_array_elements(coalesce(p_scope, '[]'::jsonb)) as s
  where length(btrim(coalesce(s->>'title', ''))) >= 2;

  get diagnostics v_scope_count = row_count;

  for v_invitee in
    select value from jsonb_array_elements(coalesce(p_invitees, '[]'::jsonb)) as t(value)
  loop
    v_external := coalesce((v_invitee->>'external')::boolean, false)
      or coalesce(v_invitee->>'userId', '') = '';
    v_company := left(
      btrim(coalesce(nullif(v_invitee->>'company', ''), v_invitee->>'fullName', 'Field Capture')),
      160
    );
    v_trade := left(
      btrim(
        coalesce(
          nullif(v_invitee->>'trade', ''),
          case when v_external then 'subcontractor' else 'field_capture' end
        )
      ),
      60
    );

    insert into public.job_parties (
      org_id, job_id, company, trade, contact_name, email, role, invited_at, created_by
    )
    values (
      p_org_id,
      v_job_id,
      v_company,
      v_trade,
      left(btrim(coalesce(v_invitee->>'fullName', v_company)), 120),
      nullif(lower(btrim(coalesce(v_invitee->>'email', ''))), ''),
      'subcontractor',
      now(),
      v_uid
    )
    returning id, company, email, access_token
    into v_party_id, v_party_company, v_party_email, v_party_token;

    v_parties := v_parties || jsonb_build_array(
      jsonb_build_object(
        'id', v_party_id,
        'name', v_party_company,
        'email', v_party_email,
        'token', v_party_token,
        'external', v_external
      )
    );
  end loop;

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job_id,
      'title', v_job_title,
      'jobNumber', v_job_number
    ),
    'briefRevision', v_revision,
    'scopeSaved', v_scope_count,
    'parties', v_parties,
    'summary', jsonb_build_object(
      'jobId', v_job_id,
      'jobNumber', v_job_number,
      'title', v_job_title,
      'status', 'scheduled',
      'parties', jsonb_array_length(v_parties),
      'currentRevision', v_revision,
      'behind', 0,
      'awaiting', jsonb_array_length(v_parties),
      'exclusions', (
        select count(*)::int
        from public.job_scope_items
        where job_id = v_job_id and state = 'excluded'
      )
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.repair_crm_audit_triggers()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  dropped boolean := false;
begin
  if to_regclass('public.crm_jobs') is not null then
    if exists (
      select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'crm_jobs'
         and t.tgname = 'crm_jobs_audit'
         and not t.tgisinternal
    ) then
      execute 'drop trigger if exists crm_jobs_audit on public.crm_jobs';
      dropped := true;
    end if;
  end if;

  if to_regclass('public.crm_properties') is not null then
    execute 'drop trigger if exists crm_properties_audit on public.crm_properties';
  end if;
  if to_regclass('public.crm_accounts') is not null then
    execute 'drop trigger if exists crm_accounts_audit on public.crm_accounts';
  end if;
  if to_regclass('public.crm_contacts') is not null then
    execute 'drop trigger if exists crm_contacts_audit on public.crm_contacts';
  end if;
  if to_regclass('public.crm_leads') is not null then
    execute 'drop trigger if exists crm_leads_audit on public.crm_leads';
  end if;
  if to_regclass('public.crm_activities') is not null then
    execute 'drop trigger if exists crm_activities_audit on public.crm_activities';
  end if;

  drop function if exists private.crm_audit();
  return dropped;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_crm_audit_log()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if to_regclass('public.crm_audit_log') is null then
    execute $sql$
      create table public.crm_audit_log (
        id            bigint generated always as identity primary key,
        org_id        uuid,
        table_name    text not null,
        row_id        uuid,
        op            text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
        actor_id      uuid,
        changed_at    timestamptz not null default now(),
        row_data      jsonb,
        prev_data     jsonb
      )
    $sql$;
    execute 'create index if not exists crm_audit_log_org_time_idx on public.crm_audit_log (org_id, changed_at desc)';
    execute 'alter table public.crm_audit_log enable row level security';
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_video_processing_job(p_owner text, p_lease_seconds integer DEFAULT 90, p_id uuid DEFAULT NULL::uuid)
 RETURNS video_processing_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.video_processing_jobs;
  v_secs integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'owner_required';
  end if;
  v_secs := greatest(coalesce(p_lease_seconds, 90), 15);

  update public.video_processing_jobs as j
     set lease_owner = btrim(p_owner),
         lease_until = now() + make_interval(secs => v_secs),
         status = case when j.status = 'pending' then 'running'::verification_step_status else j.status end,
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select c.id
       from public.video_processing_jobs as c
      where c.status in ('pending', 'running')
        and (p_id is null or c.id = p_id)
        and (
          c.lease_until is null
          or c.lease_until < now()
          or c.lease_owner = btrim(p_owner)
        )
      order by c.created_at
      for update skip locked
      limit 1
   )
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_job_proof_work(p_kind text, p_owner text, p_lease_seconds integer DEFAULT 90, p_id uuid DEFAULT NULL::uuid)
 RETURNS job_proofs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.job_proofs;
  v_secs integer;
  v_kind text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'owner_required';
  end if;
  v_kind := lower(btrim(coalesce(p_kind, '')));
  if v_kind not in ('narration', 'transcript', 'analysis') then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;
  v_secs := greatest(coalesce(p_lease_seconds, 90), 15);

  if v_kind = 'narration' then
    update public.job_proofs as j
       set narration_lease_owner = btrim(p_owner),
           narration_lease_until = now() + make_interval(secs => v_secs),
           narration_status = case
             when j.narration_status is null or j.narration_status in ('idle', 'queued')
               then 'running'
             else j.narration_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and (
            c.narration_status is null
            or c.narration_status in ('idle', 'queued', 'running')
          )
          and (
            c.narration_lease_until is null
            or c.narration_lease_until < now()
            or c.narration_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  elsif v_kind = 'transcript' then
    update public.job_proofs as j
       set transcript_lease_owner = btrim(p_owner),
           transcript_lease_until = now() + make_interval(secs => v_secs),
           transcript_status = case
             when j.transcript_status is null or j.transcript_status in ('idle', 'queued')
               then 'running'
             else j.transcript_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and (
            c.transcript_status is null
            or c.transcript_status in ('idle', 'queued', 'running')
          )
          and (
            c.transcript_lease_until is null
            or c.transcript_lease_until < now()
            or c.transcript_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  else
    update public.job_proofs as j
       set analysis_lease_owner = btrim(p_owner),
           analysis_lease_until = now() + make_interval(secs => v_secs),
           analysis_status = case
             when j.analysis_status = 'queued' then 'running'
             else j.analysis_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and c.analysis_status in ('queued', 'running')
          and (
            c.analysis_lease_until is null
            or c.analysis_lease_until < now()
            or c.analysis_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.is_field_capture_seat(p_role text, p_email text, p_usage_intents text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select
    coalesce(lower(p_email), '') like '%@field.atmosphere.app'
    or coalesce(p_role, '') in (
      'employee', 'field_technician', 'project_manager', 'accountant', 'sales'
    )
    or coalesce(p_usage_intents, '{}'::text[]) @> array['field_work']::text[];
$function$
;

CREATE OR REPLACE FUNCTION private.field_capture_seats_allowed(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_status text;
  v_extra integer := 0;
  v_included integer := 3;
begin
  begin
    select b.status::text,
           coalesce(b.extra_fc_seats, 0),
           coalesce(b.included_fc_seats, 3)
      into v_status, v_extra, v_included
    from public.org_billing b
    where b.org_id = p_org;
  exception
    when undefined_column then
      begin
        select b.status::text, coalesce(b.extra_fc_seats, 0)
          into v_status, v_extra
        from public.org_billing b
        where b.org_id = p_org;
        v_included := 3;
      exception
        when undefined_column then
          select b.status::text into v_status
          from public.org_billing b
          where b.org_id = p_org;
          v_extra := 0;
          v_included := 3;
      end;
  end;
  if not found then
    return 3;
  end if;
  if v_status is null or v_status in ('active', 'trialing', 'past_due', 'comped') then
    return greatest(v_included, 0) + greatest(v_extra, 0);
  end if;
  return 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.field_capture_seats_used(p_org uuid, p_exclude_user uuid DEFAULT NULL::uuid, p_exclude_invite uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  with counted_members as (
    select
      m.user_id,
      lower(trim(p.email)) as email,
      private.is_field_capture_seat(m.role::text, p.email, m.usage_intents) as is_seat
    from public.org_members m
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org
      and (p_exclude_user is null or m.user_id <> p_exclude_user)
  )
  select
    (
      select count(*)::int from counted_members where is_seat
    )
    +
    (
      select count(*)::int
      from public.org_invites i
      where i.org_id = p_org
        and i.status = 'pending'
        and (p_exclude_invite is null or i.id <> p_exclude_invite)
        and private.is_field_capture_seat(i.role::text, i.email, null)
        and not exists (
          select 1 from counted_members m
          where m.email is not null and m.email = lower(trim(i.email))
        )
    );
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_field_capture_seat_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_used integer;
  v_allowed integer;
  v_is_seat boolean;
  v_was_seat boolean := false;
  v_email text;
begin
  if tg_table_name = 'org_members' then
    v_org := new.org_id;
    select email into v_email from public.profiles where id = new.user_id;
    v_is_seat := private.is_field_capture_seat(new.role::text, v_email, new.usage_intents);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      select email into v_email from public.profiles where id = old.user_id;
      v_was_seat := private.is_field_capture_seat(old.role::text, v_email, old.usage_intents);
      if v_was_seat then
        return new;
      end if;
    end if;
    perform pg_advisory_xact_lock(84215, hashtext(v_org::text));
    v_used := private.field_capture_seats_used(v_org, new.user_id, null);
  elsif tg_table_name = 'org_invites' then
    if new.status is distinct from 'pending' then
      return new;
    end if;
    v_org := new.org_id;
    v_is_seat := private.is_field_capture_seat(new.role::text, new.email, null);
    if not v_is_seat then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'pending'
       and private.is_field_capture_seat(old.role::text, old.email, null) then
      return new;
    end if;
    perform pg_advisory_xact_lock(84215, hashtext(v_org::text));
    v_used := private.field_capture_seats_used(v_org, null, new.id);
  else
    return new;
  end if;

  v_allowed := private.field_capture_seats_allowed(v_org);
  if v_used >= v_allowed then
    raise exception 'fc_seat_limit'
      using errcode = 'P0001',
            hint = 'fc_seat_limit',
            detail = format('used=%s allowed=%s', v_used, v_allowed);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.credit_balance(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Credit wallet removed. Sold path meters via token_usage / org_metering.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and auth.uid() is not null
     and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total_nanos', 0,
    'plan_nanos', 0,
    'purchased_nanos', 0,
    'promo_nanos', 0,
    'next_expiry', null
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stripe_sync_subscription(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer, p_subscription_id text, p_status subscription_status, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_cancel_at_period_end boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.org_billing%rowtype; p public.billing_plans%rowtype;
  v_changed boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan;
  if not found then raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002'; end if;

  perform private.advance_billing_period(p_org);
  select * into b from public.org_billing where org_id = p_org for update;

  v_changed := b.plan_code is distinct from p_plan
            or b.seats is distinct from p_seats
            or b.period_end is distinct from p_period_end;

  update public.org_billing set
    plan_code = p_plan, billing_interval = p_interval, seats = greatest(p_seats, 1),
    status = p_status, stripe_subscription_id = p_subscription_id,
    period_start = coalesce(p_period_start, period_start),
    period_end = coalesce(p_period_end, period_end),
    cancel_at_period_end = p_cancel_at_period_end
  where org_id = p_org returning * into b;

  return jsonb_build_object('plan', p_plan, 'changed', v_changed,
    'period_end', b.period_end, 'balance', public.credit_balance(p_org));
end $function$
;

CREATE OR REPLACE FUNCTION public.voiceprints_matchable(p_org uuid)
 RETURNS TABLE(voiceprint_id uuid, user_id uuid, org_id uuid, full_name text, embedding jsonb, cross_company_opt_in boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select v.id, v.user_id, v.org_id, p.full_name, e.embedding, v.cross_company_opt_in
  from public.voiceprints v
  join public.voiceprint_embeddings e on e.voiceprint_id = v.id
  left join public.profiles p on p.id = v.user_id
  where v.consented_at is not null
    and length(btrim(v.consent_text)) > 0
    and (
      v.org_id = p_org
      or v.cross_company_opt_in is true
    );
$function$
;

CREATE OR REPLACE FUNCTION private.speaker_job_clip_owned(p_org uuid, p_job uuid, p_proof uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.is_org_member(p_org)
    and exists (
      select 1
      from public.crm_jobs j
      join public.job_proofs p
        on p.id = p_proof
       and p.job_id = j.id
       and p.org_id = j.org_id
      where j.id = p_job
        and j.org_id = p_org
    );
$function$
;

CREATE OR REPLACE FUNCTION public.set_proof_room_segments(p_proof_id uuid, p_segments jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update public.job_proofs
  set ai_findings = jsonb_set(
    case
      when jsonb_typeof(ai_findings) = 'object' then ai_findings
      else '{}'::jsonb
    end,
    '{roomSegments}',
    case
      when jsonb_typeof(p_segments) = 'array' then p_segments
      else '[]'::jsonb
    end,
    true
  )
  where id = p_proof_id;
$function$
;

CREATE OR REPLACE FUNCTION public.proofs_awaiting_room_backfill(p_limit integer, p_job_id uuid DEFAULT NULL::uuid, p_org_id uuid DEFAULT NULL::uuid, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, p.created_at
  from public.job_proofs p
  where p.deleted_at is null
    and p.narration_status in ('done', 'skipped')
    and (p_job_id is null or p.job_id = p_job_id)
    and (p_org_id is null or p.org_id = p_org_id)
    and not exists (
      select 1 from public.clip_room_segments s where s.proof_id = p.id
    )
    and not (coalesce(p.ai_findings, '{}'::jsonb) ? 'roomSegments')
    and (
      p_after is null
      or p.created_at > p_after
      or (p.created_at = p_after and p.id > p_after_id)
    )
  order by p.created_at asc, p.id asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.ai_credit_balance(p_org uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(delta_nanos), 0)::bigint
  from public.ai_credit_ledger
  where org_id = p_org;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_allowance_totals(p_org uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone)
 RETURNS TABLE(period_spend_nanos bigint, window_event_nanos bigint, window_allowance_nanos bigint, window_allocation_count bigint, credit_balance_nanos bigint, by_feature jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    coalesce((
      select sum(greatest(coalesce(cost_nanos, 0), 0))
      from public.token_usage_events
      where org_id = p_org
        and created_at >= p_period_start
        and created_at < p_period_end
    ), 0)::bigint,
    coalesce((
      select sum(greatest(coalesce(cost_nanos, 0), 0))
      from public.token_usage_events
      where org_id = p_org
        and created_at >= p_period_start
        and created_at < p_period_end
        and created_at >= p_window_start
    ), 0)::bigint,
    coalesce((
      select sum(greatest(allowance_nanos, 0))
      from public.ai_usage_allocations
      where org_id = p_org
        and created_at >= p_window_start
    ), 0)::bigint,
    coalesce((
      select count(*)
      from public.ai_usage_allocations
      where org_id = p_org
        and created_at >= p_window_start
    ), 0)::bigint,
    public.ai_credit_balance(p_org),
    coalesce((
      select jsonb_object_agg(feature, nanos)
      from (
        select feature::text as feature,
               sum(greatest(coalesce(cost_nanos, 0), 0))::bigint as nanos
        from public.token_usage_events
        where org_id = p_org
          and created_at >= p_period_start
          and created_at < p_period_end
        group by feature
      ) grouped
    ), '{}'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.settle_ai_usage(p_org uuid, p_request_id text, p_cost_nanos bigint, p_allowance_nanos bigint, p_credit_nanos bigint, p_at timestamp with time zone, p_period_allowance_nanos bigint, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone, p_rolling_cap_nanos bigint, p_window_event_nanos bigint)
 RETURNS TABLE(applied boolean, credit_applied boolean, allowance_nanos bigint, credit_nanos bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.ai_usage_allocations%rowtype;
  v_balance bigint;
  v_caller_allowance bigint := greatest(coalesce(p_allowance_nanos, 0), 0);
  v_credit bigint := greatest(coalesce(p_credit_nanos, 0), 0);
  v_allowance bigint := v_caller_allowance;
  v_period_used bigint := 0;
  v_window_used bigint := 0;
  v_window_count bigint := 0;
  v_window_room bigint := 0;
begin
  if p_request_id is null or length(btrim(p_request_id)) = 0 then
    raise exception 'request_id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select a.* into v_existing
  from public.ai_usage_allocations a
  where a.org_id = p_org and a.request_id = p_request_id;

  if found then
    return query
      select true,
             v_existing.credit_nanos > 0,
             v_existing.allowance_nanos,
             v_existing.credit_nanos;
    return;
  end if;

  if p_period_start is not null
     and p_period_end is not null
     and p_period_allowance_nanos is not null
  then
    select coalesce(sum(greatest(a.allowance_nanos, 0)), 0)
      into v_period_used
    from public.ai_usage_allocations a
    where a.org_id = p_org
      and a.created_at >= p_period_start
      and a.created_at < p_period_end;

    v_allowance := least(v_allowance, greatest(0, p_period_allowance_nanos - v_period_used));
  end if;

  if p_rolling_cap_nanos is not null and p_window_start is not null then
    select coalesce(sum(greatest(a.allowance_nanos, 0)), 0), count(*)
      into v_window_used, v_window_count
    from public.ai_usage_allocations a
    where a.org_id = p_org
      and a.created_at >= p_window_start;

    if v_window_count > 0 then
      v_window_room := greatest(0, p_rolling_cap_nanos - v_window_used);
    else
      v_window_room := greatest(0, p_rolling_cap_nanos - greatest(coalesce(p_window_event_nanos, 0), 0));
    end if;

    v_allowance := least(v_allowance, v_window_room);
  end if;

  v_credit := v_credit + greatest(0, v_caller_allowance - v_allowance);

  select public.ai_credit_balance(p_org) into v_balance;

  if v_credit > 0 and v_balance < v_credit then
    v_credit := 0;
  end if;

  insert into public.ai_usage_allocations (
    org_id, request_id, cost_nanos, allowance_nanos, credit_nanos, created_at
  ) values (
    p_org,
    p_request_id,
    greatest(coalesce(p_cost_nanos, 0), 0),
    v_allowance,
    v_credit,
    coalesce(p_at, now())
  );

  if v_credit > 0 then
    insert into public.ai_credit_ledger (
      org_id, delta_nanos, kind, request_id, note, created_at
    ) values (
      p_org, -v_credit, 'consume', p_request_id, 'AI usage', coalesce(p_at, now())
    );
  end if;

  return query select true, v_credit > 0, v_allowance, v_credit;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_proofs_guard_budget_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.ai_budget_hold is distinct from old.ai_budget_hold
     or new.ai_budget_hold_reason is distinct from old.ai_budget_hold_reason
  then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'ai_budget_hold is server-write-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_subscription_price_span(p_org uuid, p_amount_cents integer, p_interval text, p_at timestamp with time zone, p_period_start timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_open public.ai_budget_price_spans%rowtype;
  v_from timestamptz;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'amount_cents required' using errcode = '22023';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'billing interval required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-budget-price-span'), hashtext(p_org::text));

  select *
    into v_open
  from public.ai_budget_price_spans
  where org_id = p_org
    and effective_to is null
  order by effective_from desc, created_at desc
  limit 1
  for update;

  if found and v_open.amount_cents = p_amount_cents then
    return;
  end if;

  -- Same instant cannot close and reopen without violating effective_to > effective_from.
  if found and p_at <= v_open.effective_from then
    update public.ai_budget_price_spans
    set amount_cents = p_amount_cents,
        billing_interval = p_interval
    where id = v_open.id;
    return;
  end if;

  if found then
    update public.ai_budget_price_spans
    set effective_to = p_at
    where id = v_open.id
      and effective_to is null;
    v_from := p_at;
  elsif p_period_start is not null and p_period_start < p_at then
    v_from := p_period_start;
  else
    v_from := p_at;
  end if;

  insert into public.ai_budget_price_spans (
    org_id, amount_cents, billing_interval, effective_from
  ) values (
    p_org, p_amount_cents, p_interval, v_from
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_ai_credit_clawback(p_org uuid, p_event_id text, p_charge_id text, p_charge_amount_cents integer, p_granted_nanos bigint, p_amount_refunded_cents integer, p_dispute_amount_cents integer, p_dispute_standing text, p_dispute_id text, p_event_at timestamp with time zone, p_note text)
 RETURNS TABLE(applied boolean, debited_nanos bigint, restored_nanos bigint, shortfall_nanos bigint, balance_nanos bigint, clawed_nanos bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.ai_credit_ledger%rowtype;
  v_state public.ai_credit_pack_clawbacks%rowtype;
  v_grant bigint;
  v_refund_share bigint := 0;
  v_dispute_share bigint := 0;
  v_target bigint;
  v_clawed bigint;
  v_delta bigint;
  v_balance bigint;
  v_debit bigint := 0;
  v_restore bigint := 0;
  v_shortfall bigint := 0;
  v_note text;
  v_apply_dispute boolean := false;
  v_incoming_rank integer := 0;
  v_stored_rank integer := 0;
  v_dispute public.ai_credit_pack_disputes%rowtype;
  v_have_dispute boolean := false;
  v_latest_dispute_at timestamptz;
  v_open_dispute_cents integer := 0;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    raise exception 'event_id required' using errcode = '22023';
  end if;
  if p_charge_id is null or length(btrim(p_charge_id)) = 0 then
    raise exception 'charge_id required' using errcode = '22023';
  end if;
  if p_dispute_standing is not null and p_dispute_standing not in ('open', 'lost', 'won') then
    raise exception 'dispute standing required' using errcode = '22023';
  end if;
  if p_dispute_standing is not null and (p_dispute_id is null or length(btrim(p_dispute_id)) = 0) then
    raise exception 'dispute_id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select *
    into v_existing
  from public.ai_credit_ledger
  where stripe_event_id = p_event_id;

  if found then
    select coalesce(-sum(delta_nanos), 0)
      into v_clawed
    from public.ai_credit_ledger
    where org_id = p_org
      and stripe_charge_id = p_charge_id;
    return query
      select false,
             case when v_existing.delta_nanos < 0 then -v_existing.delta_nanos else 0::bigint end,
             case when v_existing.delta_nanos > 0 then v_existing.delta_nanos else 0::bigint end,
             0::bigint,
             public.ai_credit_balance(p_org),
             v_clawed;
    return;
  end if;

  v_grant := greatest(coalesce(p_granted_nanos, 0), 0);

  select *
    into v_state
  from public.ai_credit_pack_clawbacks
  where org_id = p_org
    and stripe_charge_id = p_charge_id
  for update;

  if not found then
    insert into public.ai_credit_pack_clawbacks (
      org_id, stripe_charge_id, granted_nanos, charge_amount_cents, amount_refunded_cents
    ) values (
      p_org,
      p_charge_id,
      v_grant,
      greatest(coalesce(p_charge_amount_cents, 0), 0),
      greatest(coalesce(p_amount_refunded_cents, 0), 0)
    )
    returning * into v_state;
  else
    update public.ai_credit_pack_clawbacks
    set granted_nanos = greatest(granted_nanos, v_grant),
        charge_amount_cents = greatest(charge_amount_cents, greatest(coalesce(p_charge_amount_cents, 0), 0)),
        amount_refunded_cents = greatest(amount_refunded_cents, greatest(coalesce(p_amount_refunded_cents, 0), 0))
    where org_id = p_org
      and stripe_charge_id = p_charge_id
    returning * into v_state;
  end if;

  -- Same dispute: open is rank 1 and never replaces won or lost (rank 2).
  -- At the same rank, only a Stripe event at least as new as the stored one applies.
  -- A different dp_ id applies only when its event is strictly newer than the
  -- latest dispute already stored for this charge.
  if p_dispute_standing is not null then
    v_incoming_rank := case p_dispute_standing
      when 'won' then 2
      when 'lost' then 2
      when 'open' then 1
      else 0
    end;

    select *
      into v_dispute
    from public.ai_credit_pack_disputes
    where org_id = p_org
      and stripe_dispute_id = p_dispute_id
    for update;
    v_have_dispute := found;

    if v_have_dispute then
      v_stored_rank := case
        when v_dispute.standing in ('won', 'lost') then 2
        else 1
      end;
      if v_incoming_rank > v_stored_rank then
        v_apply_dispute := true;
      elsif v_incoming_rank = v_stored_rank and v_incoming_rank > 0 then
        v_apply_dispute := v_dispute.event_at is null
          or p_event_at is null
          or p_event_at >= v_dispute.event_at;
      end if;
    else
      select d.event_at
        into v_latest_dispute_at
      from public.ai_credit_pack_disputes d
      where d.org_id = p_org
        and d.stripe_charge_id = p_charge_id
      order by d.event_at desc nulls last
      limit 1;

      if not found then
        v_apply_dispute := true;
      else
        v_apply_dispute := p_event_at is not null
          and (v_latest_dispute_at is null or p_event_at > v_latest_dispute_at);
      end if;
    end if;

    if v_apply_dispute and not v_have_dispute then
      insert into public.ai_credit_pack_disputes (
        org_id, stripe_dispute_id, stripe_charge_id, amount_cents, standing, event_at
      ) values (
        p_org,
        p_dispute_id,
        p_charge_id,
        greatest(coalesce(p_dispute_amount_cents, 0), 0),
        p_dispute_standing,
        p_event_at
      );
    elsif v_apply_dispute then
      update public.ai_credit_pack_disputes
      set stripe_charge_id = p_charge_id,
          amount_cents = greatest(coalesce(p_dispute_amount_cents, 0), 0),
          standing = p_dispute_standing,
          event_at = p_event_at
      where org_id = p_org
        and stripe_dispute_id = p_dispute_id;
    end if;
  end if;

  select coalesce(max(amount_cents), 0)
    into v_open_dispute_cents
  from public.ai_credit_pack_disputes
  where org_id = p_org
    and stripe_charge_id = p_charge_id
    and standing <> 'won';

  if v_state.charge_amount_cents > 0 and v_state.granted_nanos > 0 then
    v_refund_share := least(
      v_state.granted_nanos,
      round(
        v_state.granted_nanos
        * least(v_state.amount_refunded_cents, v_state.charge_amount_cents)::numeric
        / v_state.charge_amount_cents
      )::bigint
    );
    if v_open_dispute_cents > 0 then
      v_dispute_share := least(
        v_state.granted_nanos,
        round(
          v_state.granted_nanos
          * least(v_open_dispute_cents, v_state.charge_amount_cents)::numeric
          / v_state.charge_amount_cents
        )::bigint
      );
    end if;
  end if;

  v_target := least(v_state.granted_nanos, greatest(v_refund_share, v_dispute_share));

  select coalesce(-sum(delta_nanos), 0)
    into v_clawed
  from public.ai_credit_ledger
  where org_id = p_org
    and stripe_charge_id = p_charge_id;

  v_delta := v_target - v_clawed;
  v_balance := greatest(public.ai_credit_balance(p_org), 0);

  if v_delta > 0 then
    v_debit := least(v_delta, v_balance);
    v_shortfall := v_delta - v_debit;
  elsif v_delta < 0 then
    v_restore := -v_delta;
  end if;

  v_note := concat_ws(
    ' ',
    nullif(btrim(coalesce(p_note, '')), ''),
    case when v_shortfall > 0 then 'shortfall_nanos=' || v_shortfall::text else null end
  );

  insert into public.ai_credit_ledger (
    org_id, delta_nanos, kind, stripe_event_id, stripe_charge_id, note
  ) values (
    p_org,
    case when v_restore > 0 then v_restore else -v_debit end,
    case when v_restore > 0 then 'adjustment' else 'refund' end,
    p_event_id,
    p_charge_id,
    nullif(v_note, '')
  );

  return query
    select true,
           v_debit,
           v_restore,
           v_shortfall,
           v_balance - v_debit + v_restore,
           v_clawed + v_debit - v_restore;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.analytics_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_capture_upload(p_org uuid, p_upload_key text, p_event text, p_job uuid DEFAULT NULL::uuid, p_error_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := left(btrim(coalesce(p_upload_key, '')), 500);
  v_err text := nullif(left(btrim(coalesce(p_error_code, '')), 64), '');
begin
  if p_org is null or v_key = '' then
    return;
  end if;

  if p_event = 'start' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id)
    values (p_org, v_key, p_job)
    on conflict (org_id, upload_key) do update
      set attempts        = a.attempts + 1,
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'touch' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id)
    values (p_org, v_key, p_job)
    on conflict (org_id, upload_key) do update
      set last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'complete' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id, completed_at)
    values (p_org, v_key, p_job, now())
    on conflict (org_id, upload_key) do update
      set completed_at    = coalesce(a.completed_at, now()),
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'fail' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id, failed_at, last_error_code)
    values (p_org, v_key, p_job, now(), coalesce(v_err, 'unknown'))
    on conflict (org_id, upload_key) do update
      set failed_at       = now(),
          last_error_code = coalesce(v_err, 'unknown'),
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  else
    raise exception 'unknown capture upload event %', p_event using errcode = '22023';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.analytics_campaign_json(c analytics_campaigns)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'subject', c.subject, 'body_markdown', c.body_markdown,
    'audience', c.audience, 'status', c.status,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'sent_at', c.sent_at,
    'recipient_count', c.recipient_count, 'sent_count', c.sent_count,
    'failed_count', c.failed_count, 'suppressed_count', c.suppressed_count);
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaigns_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.require_analytics('internal');
  return jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(private.analytics_campaign_json(c) order by c.updated_at desc)
      from public.analytics_campaigns c), '[]'::jsonb),
    'suppressed', (select count(*) from public.analytics_email_suppressions));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaign_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.analytics_campaigns;
begin
  perform private.require_analytics('internal');
  select * into c from public.analytics_campaigns where id = p_id;
  if not found then
    return null;
  end if;
  return private.analytics_campaign_json(c);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaign_save(p_id uuid, p_name text, p_subject text, p_body text, p_audience jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  c public.analytics_campaigns;
begin
  perform private.require_analytics('internal');
  v_actor := private.analytics_actor();

  if p_id is null then
    insert into public.analytics_campaigns (name, subject, body_markdown, audience, created_by, updated_by)
    values (coalesce(nullif(btrim(p_name), ''), 'Untitled campaign'), coalesce(p_subject, ''),
            coalesce(p_body, ''), coalesce(p_audience, '{}'::jsonb), v_actor, v_actor)
    returning * into c;
  else
    update public.analytics_campaigns
       set name = coalesce(nullif(btrim(p_name), ''), name),
           subject = coalesce(p_subject, subject),
           body_markdown = coalesce(p_body, body_markdown),
           audience = coalesce(p_audience, audience),
           updated_by = v_actor,
           updated_at = now()
     where id = p_id and status = 'draft'
    returning * into c;
    if not found then
      raise exception 'campaign_not_editable' using errcode = 'P0002';
    end if;
  end if;
  return private.analytics_campaign_json(c);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaign_delete(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.require_analytics('internal');
  delete from public.analytics_campaigns where id = p_id and status = 'draft';
  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_email_suppressed(p_emails text[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.require_analytics('internal');
  return coalesce((
    select array_agg(s.email order by s.email)
    from public.analytics_email_suppressions s
    where s.email = any (select lower(btrim(e)) from unnest(coalesce(p_emails, '{}')) e)), '{}');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaign_begin_send(p_id uuid, p_emails text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.analytics_campaigns;
  v_total integer;
  v_suppressed integer;
  v_recipients jsonb;
begin
  perform private.require_analytics('internal');

  select * into c from public.analytics_campaigns where id = p_id for update;
  if not found or c.status <> 'draft' then
    raise exception 'campaign_not_sendable' using errcode = 'P0002';
  end if;

  with wanted as (
    select distinct lower(btrim(e)) as email
    from unnest(coalesce(p_emails, '{}')) e
    where e is not null and btrim(e) like '%_@_%'
  ),
  kept as (
    select w.email from wanted w
    where not exists (select 1 from public.analytics_email_suppressions s where s.email = w.email)
  ),
  ins as (
    insert into public.analytics_campaign_sends (campaign_id, email)
    select p_id, k.email from kept k
    on conflict (campaign_id, email) do nothing
    returning email, unsubscribe_token
  )
  select (select count(*) from wanted),
         (select count(*) from wanted) - (select count(*) from kept),
         coalesce(jsonb_agg(jsonb_build_object('email', email, 'token', unsubscribe_token) order by email), '[]'::jsonb)
    into v_total, v_suppressed, v_recipients
  from ins;

  update public.analytics_campaigns
     set status = 'sending',
         recipient_count = jsonb_array_length(v_recipients),
         suppressed_count = v_suppressed,
         updated_by = private.analytics_actor(),
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('recipients', v_recipients, 'suppressed', v_suppressed, 'requested', v_total);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_campaign_finish_send(p_id uuid, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.analytics_campaigns;
  v_sent integer;
  v_failed integer;
begin
  perform private.require_analytics('internal');

  update public.analytics_campaign_sends s
     set status = case when (r ->> 'ok')::boolean then 'sent' else 'failed' end,
         provider_message_id = left(r ->> 'provider_id', 200),
         error = left(r ->> 'error', 500),
         sent_at = case when (r ->> 'ok')::boolean then now() end
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where s.campaign_id = p_id and s.email = lower(r ->> 'email');

  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed')
    into v_sent, v_failed
  from public.analytics_campaign_sends where campaign_id = p_id;

  update public.analytics_campaigns
     set status = case when v_sent = 0 and v_failed > 0 then 'failed' else 'sent' end,
         sent_count = v_sent,
         failed_count = v_failed,
         sent_at = now(),
         updated_at = now()
   where id = p_id and status = 'sending'
  returning * into c;

  if not found then
    raise exception 'campaign_not_sending' using errcode = 'P0002';
  end if;
  return private.analytics_campaign_json(c);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_token_usage(p_org uuid, p_request_id text, p_feature text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_model_id text DEFAULT NULL::text, p_input_tokens bigint DEFAULT 0, p_output_tokens bigint DEFAULT 0, p_cache_tokens bigint DEFAULT 0, p_price_nanos bigint DEFAULT 0, p_metadata jsonb DEFAULT '{}'::jsonb, p_at timestamp with time zone DEFAULT now(), p_cost_nanos bigint DEFAULT 0, p_provider text DEFAULT NULL::text, p_cache_read_tokens bigint DEFAULT 0, p_cache_write_5m_tokens bigint DEFAULT 0, p_cache_write_1h_tokens bigint DEFAULT 0, p_provider_usage jsonb DEFAULT NULL::jsonb, p_pricing_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_user    uuid;
  v_feature public.token_usage_feature;
  v_row     public.token_usage_events%rowtype;
  v_dup     boolean := false;
  v_split   bigint := greatest(coalesce(p_cache_read_tokens, 0), 0)
                    + greatest(coalesce(p_cache_write_5m_tokens, 0), 0)
                    + greatest(coalesce(p_cache_write_1h_tokens, 0), 0);
  v_status  text := case
                      when p_pricing_status in ('priced', 'unpriced', 'repriced_conservative', 'legacy') then p_pricing_status
                      -- Callers that do not say (older backends): tokens with no
                      -- cost and no price is an unpriced row, never a silent $0.
                      when coalesce(p_cost_nanos, 0) <= 0 and coalesce(p_price_nanos, 0) <= 0
                       and coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0) + coalesce(p_cache_tokens, 0) > 0
                        then 'unpriced'
                      else 'priced'
                    end;
begin
  if coalesce(btrim(p_request_id), '') = '' then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  if v_uid is not null and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  v_user := coalesce(p_user_id, v_uid);
  v_feature := public.classify_token_feature(coalesce(p_feature, p_source));

  insert into public.token_usage_events (
    org_id, user_id, job_id, request_id, feature, source, model_id,
    input_tokens, output_tokens, cache_tokens,
    cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
    provider, provider_usage, pricing_status,
    cost_nanos, price_nanos, metadata, created_at
  ) values (
    p_org, v_user, p_job_id, btrim(p_request_id), v_feature,
    nullif(btrim(coalesce(p_source, p_feature, '')), ''),
    nullif(btrim(coalesce(p_model_id, '')), ''),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    -- The aggregate is never smaller than the provider-reported split.
    greatest(coalesce(p_cache_tokens, 0), v_split, 0),
    greatest(coalesce(p_cache_read_tokens, 0), 0),
    greatest(coalesce(p_cache_write_5m_tokens, 0), 0),
    greatest(coalesce(p_cache_write_1h_tokens, 0), 0),
    nullif(btrim(coalesce(p_provider, '')), ''),
    p_provider_usage,
    v_status,
    greatest(coalesce(p_cost_nanos, 0), 0),
    greatest(coalesce(p_price_nanos, 0), 0),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_at, now())
  )
  on conflict (org_id, request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    v_dup := true;
    select * into v_row
    from public.token_usage_events
    where org_id = p_org and request_id = btrim(p_request_id);
  end if;

  return jsonb_build_object(
    'eventId', v_row.id,
    'duplicate', v_dup,
    'feature', v_row.feature,
    'inputTokens', v_row.input_tokens,
    'outputTokens', v_row.output_tokens,
    'cacheTokens', v_row.cache_tokens,
    'totalTokens', v_row.total_tokens,
    'costNanos', v_row.cost_nanos,
    'priceNanos', v_row.price_nanos,
    'pricingStatus', v_row.pricing_status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_ai_auto_recharge(p_org uuid, p_cooldown_seconds integer, p_max_per_day integer, p_stale_seconds integer DEFAULT 900, p_trigger text DEFAULT NULL::text)
 RETURNS TABLE(claimed boolean, reason text, recharge_id uuid, idempotency_key text, pack_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_settings public.ai_credit_auto_recharge_settings%rowtype;
  v_recent integer;
  v_id uuid;
  v_key text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_settings
    from public.ai_credit_auto_recharge_settings s
   where s.org_id = p_org
   for update;

  if not found or not v_settings.enabled then
    return query select false, 'disabled'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- An attempt left pending by a crash is closed out as failed after
  -- p_stale_seconds; the webhook still grants credits if Stripe did charge.
  update public.ai_credit_auto_recharges r
     set status = 'failed',
         failure_code = 'stale_attempt',
         failure_message = 'The attempt did not finish.',
         completed_at = now()
   where r.org_id = p_org
     and r.status = 'pending'
     and r.created_at < now() - make_interval(secs => greatest(p_stale_seconds, 60));

  if exists (
    select 1 from public.ai_credit_auto_recharges r
     where r.org_id = p_org and r.status = 'pending'
  ) then
    return query select false, 'in_flight'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_settings.last_attempt_at is not null
     and v_settings.last_attempt_at > now() - make_interval(secs => greatest(p_cooldown_seconds, 0)) then
    return query select false, 'cooldown'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select count(*) into v_recent
    from public.ai_credit_auto_recharges r
   where r.org_id = p_org
     and r.created_at > now() - interval '24 hours';

  if v_recent >= greatest(p_max_per_day, 0) then
    return query select false, 'daily_cap'::text, null::uuid, null::text, null::text;
    return;
  end if;

  v_id := gen_random_uuid();
  v_key := 'ai-auto-recharge:' || p_org::text || ':' || v_id::text;

  insert into public.ai_credit_auto_recharges (id, org_id, pack_code, idempotency_key, trigger_source)
  values (v_id, p_org, v_settings.pack_code, v_key, p_trigger);

  update public.ai_credit_auto_recharge_settings s
     set last_attempt_at = now()
   where s.org_id = p_org;

  return query select true, 'claimed'::text, v_id, v_key, v_settings.pack_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.finish_ai_auto_recharge(p_recharge uuid, p_status text, p_payment_intent_id text DEFAULT NULL::text, p_charge_id text DEFAULT NULL::text, p_amount_cents integer DEFAULT NULL::integer, p_currency text DEFAULT NULL::text, p_credit_nanos bigint DEFAULT NULL::bigint, p_failure_code text DEFAULT NULL::text, p_failure_message text DEFAULT NULL::text)
 RETURNS ai_credit_auto_recharges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.ai_credit_auto_recharges%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.ai_credit_auto_recharges where id = p_recharge for update;
  if not found then
    raise exception 'unknown_recharge' using errcode = 'P0002';
  end if;

  -- A success is final: a late failure report cannot undo a paid charge.
  if v_row.status = 'succeeded' then
    return v_row;
  end if;

  update public.ai_credit_auto_recharges set
    status = p_status,
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
    amount_cents = coalesce(p_amount_cents, amount_cents),
    currency = coalesce(p_currency, currency),
    credit_nanos = coalesce(p_credit_nanos, credit_nanos),
    failure_code = case when p_status = 'failed' then p_failure_code else null end,
    failure_message = case when p_status = 'failed' then p_failure_message else null end,
    completed_at = now()
  where id = p_recharge
  returning * into v_row;

  if p_status = 'failed' then
    update public.ai_credit_auto_recharge_settings set
      enabled = false,
      disabled_reason = coalesce(p_failure_message, 'The automatic charge failed.'),
      disabled_at = now(),
      updated_at = now()
    where org_id = v_row.org_id;
  end if;

  return v_row;
end $function$
;

CREATE OR REPLACE FUNCTION private.calculate_metering_period_unchecked(p_org uuid, p_period_start date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_bounds record;
  v_terms jsonb;
  v_jobs integer;
  v_included_jobs integer;
  v_excess_jobs integer;
  v_cu_total numeric;
  v_cu_included numeric;
  v_cu_excess numeric;
  v_video_seconds numeric;
  v_base_cents integer;
  v_job_overage_cents integer;
  v_cu_overage_nanos bigint;
  v_cu_overage_charge_nanos bigint;
  v_video_charge_cents integer;
  v_customer_charge_cents integer;
  v_ai_cost_nanos bigint;
  v_gross_profit_nanos bigint;
  v_margin_pct numeric;
begin
  select * into v_bounds from private.metering_period_bounds(p_org, coalesce(p_period_start::timestamptz, now()));
  if p_period_start is not null then
    v_bounds.period_start := p_period_start;
    v_bounds.period_end := (p_period_start + interval '1 month')::date;
  end if;

  v_terms := private.org_metering_terms(p_org);
  if v_terms is null then
    raise exception 'no_metering_plan' using errcode = 'P0002';
  end if;

  select count(*)::int into v_jobs
  from public.billing_period_jobs
  where org_id = p_org
    and period_start = v_bounds.period_start;

  v_included_jobs := (v_terms->>'includedJobs')::int;
  v_excess_jobs := greatest(v_jobs - v_included_jobs, 0);

  select coalesce(sum(compute_units), 0), coalesce(sum(estimated_provider_cost_nanos), 0)
  into v_cu_total, v_ai_cost_nanos
  from private.ai_usage_events
  where org_id = p_org
    and billable
    and created_at >= v_bounds.period_start::timestamptz
    and created_at < v_bounds.period_end::timestamptz;

  v_cu_included := (v_terms->>'includedComputeUnits')::numeric;
  v_cu_excess := greatest(v_cu_total - v_cu_included, 0);

  select coalesce(sum(video_seconds), 0) into v_video_seconds
  from private.ai_usage_events
  where org_id = p_org
    and billable
    and created_at >= v_bounds.period_start::timestamptz
    and created_at < v_bounds.period_end::timestamptz;

  v_base_cents := (v_terms->>'baseMonthlyFeeCents')::int;
  v_job_overage_cents := v_excess_jobs * (v_terms->>'additionalJobPriceCents')::int;
  v_cu_overage_nanos := (v_terms->>'computeUnitOverageNanos')::bigint;
  v_cu_overage_charge_nanos := round(v_cu_excess * v_cu_overage_nanos)::bigint;

  if (v_terms->>'videoHourPriceCents') is not null then
    v_video_charge_cents := round((v_video_seconds / 3600.0) * (v_terms->>'videoHourPriceCents')::int)::int;
  else
    v_video_charge_cents := 0;
  end if;

  v_customer_charge_cents := v_base_cents + v_job_overage_cents
    + round(v_cu_overage_charge_nanos / 10000000.0)::int
    + v_video_charge_cents;

  v_gross_profit_nanos := private.usd_to_nanos(v_customer_charge_cents / 100.0) - v_ai_cost_nanos;
  if v_customer_charge_cents > 0 then
    v_margin_pct := round((v_gross_profit_nanos::numeric / nullif(private.usd_to_nanos(v_customer_charge_cents / 100.0), 0)) * 100, 2);
  else
    v_margin_pct := null;
  end if;

  return jsonb_build_object(
    'periodStart', v_bounds.period_start,
    'periodEnd', v_bounds.period_end,
    'terms', v_terms,
    'processedJobs', v_jobs,
    'includedJobs', v_included_jobs,
    'excessJobs', v_excess_jobs,
    'jobOverageChargeCents', v_job_overage_cents,
    'computeUnitsConsumed', v_cu_total,
    'includedComputeUnits', v_cu_included,
    'excessComputeUnits', v_cu_excess,
    'computeOverageChargeCents', round(v_cu_overage_charge_nanos / 10000000.0)::int,
    'videoVerificationHours', round(v_video_seconds / 3600.0, 2),
    'videoProcessingChargeCents', v_video_charge_cents,
    'basePlatformChargeCents', v_base_cents,
    'estimatedAiCostCents', round(v_ai_cost_nanos / 10000000.0)::int,
    'estimatedGrossProfitCents', round(v_gross_profit_nanos / 10000000.0)::int,
    'estimatedGrossMarginPct', v_margin_pct,
    'estimatedCustomerChargeCents', v_customer_charge_cents
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.customer_metering_summary_unchecked(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_calc jsonb;
begin
  v_calc := private.calculate_metering_period_unchecked(p_org, null);

  return jsonb_build_object(
    'periodStart', v_calc->'periodStart',
    'periodEnd', v_calc->'periodEnd',
    'planName', v_calc->'terms'->'planName',
    'processedJobs', v_calc->'processedJobs',
    'includedJobs', v_calc->'includedJobs',
    'excessJobs', v_calc->'excessJobs',
    'videoVerificationHours', v_calc->'videoVerificationHours',
    'computeOverage', case when (v_calc->>'excessComputeUnits')::numeric > 0
      then jsonb_build_object(
        'units', v_calc->'excessComputeUnits',
        'chargeCents', v_calc->'computeOverageChargeCents'
      ) else null end,
    'basePlatformChargeCents', v_calc->'basePlatformChargeCents',
    'jobOverageChargeCents', v_calc->'jobOverageChargeCents',
    'videoProcessingChargeCents', v_calc->'videoProcessingChargeCents',
    'estimatedUpcomingBillCents', v_calc->'estimatedCustomerChargeCents'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.customer_metering_summary_for_member(p_org uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_org is null or p_user is null or not exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = p_user
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.customer_metering_summary_unchecked(p_org);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.computer_audit_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- An org delete cascades here; let that through and nothing else.
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs o where o.id = old.org_id) then
      return old;
    end if;
  end if;
  raise exception 'computer_audit_events is append-only'
    using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.user_can_access_job(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.crm_jobs j
    where j.id = p_job_id
      and private.is_org_member(j.org_id)
      and (
        j.created_by = auth.uid()
        or exists (
          select 1 from public.job_assignments a
          where a.job_id = j.id and a.user_id = auth.uid() and a.released_at is null
        )
        or exists (
          select 1 from public.job_progress_grants g
          where g.job_id = j.id and g.user_id = auth.uid()
        )
        or exists (
          select 1 from public.org_members m
          where m.org_id = j.org_id
            and m.user_id = auth.uid()
            and m.role::text in ('global_admin', 'owner', 'admin', 'office_manager')
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.org_internal_reason(p_org uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when o.exclude_from_analytics then coalesce(o.analytics_exclusion_reason, 'internal / test')
    when b.stripe_subscription_id like 'comp\_%' then 'comp account'
  end
  from public.orgs o
  left join public.org_billing b on b.org_id = o.id
  where o.id = p_org;
$function$
;

CREATE OR REPLACE FUNCTION private.analytics_in_scope(p_org uuid, p_include_internal boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_include_internal, false)
      or p_org is null
      or private.org_internal_reason(p_org) is null;
$function$
;

CREATE OR REPLACE FUNCTION private.atmosphere_catalog_mrr_cents(p_plan text, p_interval text, p_extra_seats integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when coalesce(p_interval, 'month') = 'year' then
      round((
        (case p_plan when 'starter' then 399000 when 'scale' then 1999000 else 849000 end)
        + greatest(coalesce(p_extra_seats, 0), 0) * 125000
      ) / 12.0)::integer
    else
      (case p_plan when 'starter' then 39900 when 'scale' then 199900 else 84900 end)
      + greatest(coalesce(p_extra_seats, 0), 0) * 12500
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.atmosphere_plan_name(p_plan text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case coalesce(p_plan, 'work_verification')
    when 'starter' then 'Starter'
    when 'work_verification' then 'Work Verification'
    when 'scale' then 'Scale'
    else initcap(replace(p_plan, '_', ' '))
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.org_mrr_cents(p_status subscription_status, p_subscription_id text, p_livemode boolean, p_stripe_mrr_cents integer, p_atmosphere_plan text, p_interval text, p_extra_seats integer, p_legacy_plan text, p_legacy_interval billing_interval, p_legacy_seats integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_status is null or p_status not in ('active', 'past_due') then 0
    when p_subscription_id is null or p_subscription_id not like 'sub\_%' then 0
    when p_livemode is false then 0
    when p_stripe_mrr_cents is not null then p_stripe_mrr_cents
    when p_atmosphere_plan is not null then
      private.atmosphere_catalog_mrr_cents(p_atmosphere_plan, p_interval, p_extra_seats)
    when coalesce(p_legacy_plan, 'free') <> 'free' then
      private.plan_mrr_cents(p_legacy_plan, p_legacy_interval, p_legacy_seats, p_status)
    else 0
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.org_billing_mrr_cents(b org_billing)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.org_mrr_cents(
    b.status, b.stripe_subscription_id, b.stripe_livemode, b.stripe_mrr_cents,
    b.atmosphere_plan_code, b.stripe_interval, b.extra_fc_seats,
    b.plan_code, b.billing_interval, b.seats);
$function$
;

CREATE OR REPLACE FUNCTION private.org_billing_fc_seats(b org_billing)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest(coalesce(b.included_fc_seats, 0), 0) + greatest(coalesce(b.extra_fc_seats, 0), 0);
$function$
;

CREATE OR REPLACE FUNCTION private.org_billing_label(b org_billing)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when b.org_id is null then 'no_subscription'
    when b.stripe_subscription_id like 'comp\_%' then 'comp'
    when b.stripe_subscription_id is null or b.stripe_subscription_id not like 'sub\_%' then 'no_subscription'
    when b.stripe_livemode is false then 'test_mode'
    else b.status::text
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.ai_feature_catalog_key(p_feature text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case p_feature
    when 'ask' then 'ai_assistant'
    when 'chat' then 'ai_assistant'
    when 'web_search' then 'ai_assistant'
    when 'computer' then 'computer_use'
    when 'video_analysis' then 'verifier_library'
    else p_feature
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.org_last_active_at(p_org uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest(
    (select max(s.last_seen_at) from public.feature_usage_sessions s where s.org_id = p_org),
    (select max(p.received_at) from public.job_proofs p where p.org_id = p_org and p.deleted_at is null),
    (select max(t.created_at) from public.ask_turn_events t where t.org_id = p_org),
    (select max(e.created_at) from public.token_usage_events e where e.org_id = p_org));
$function$
;

CREATE OR REPLACE FUNCTION private.mrr_cents_at(p_at timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(e.mrr_cents), 0)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e
  where private.analytics_in_scope(o.id, p_include_internal);
$function$
;

CREATE OR REPLACE FUNCTION private.paying_orgs_at(p_at timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e
  where e.mrr_cents > 0
    and private.analytics_in_scope(o.id, p_include_internal);
$function$
;

CREATE OR REPLACE FUNCTION private.seats_at(p_at timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(greatest(coalesce(e.fc_seats, 0), 0)), 0)::bigint
  from public.orgs o
  cross join lateral (
    select ev.mrr_cents, ev.fc_seats
    from public.org_billing_events ev
    where ev.org_id = o.id and ev.effective_at <= p_at
    order by ev.effective_at desc, ev.id desc
    limit 1
  ) e
  where e.mrr_cents > 0
    and private.analytics_in_scope(o.id, p_include_internal);
$function$
;

CREATE OR REPLACE FUNCTION private.churned_orgs_between(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(distinct t.org_id)::bigint
  from (
    select ev.org_id, ev.effective_at, ev.mrr_cents, ev.status,
           lag(ev.mrr_cents) over (partition by ev.org_id order by ev.effective_at, ev.id) as prev_mrr
    from public.org_billing_events ev
    where ev.effective_at < p_to
  ) t
  where t.effective_at >= p_from
    and t.mrr_cents = 0
    and t.status not in ('active', 'past_due')
    and coalesce(t.prev_mrr, 0) > 0
    and private.analytics_in_scope(t.org_id, p_include_internal);
$function$
;

CREATE OR REPLACE FUNCTION private.job_proofs_first_analysed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'UPDATE' and old.first_analysed_at is not null then
    new.first_analysed_at := old.first_analysed_at;
  elsif new.first_analysed_at is null
        and new.analysed_at is not null
        and (tg_op = 'INSERT' or old.analysed_at is null) then
    new.first_analysed_at := new.analysed_at;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_internal_orgs()
 RETURNS TABLE(org_id uuid, org_name text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
begin
  perform private.require_analytics('internal');
  return query
  select o.id, o.name, private.org_internal_reason(o.id)
  from public.orgs o
  where private.org_internal_reason(o.id) is not null
  order by o.name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_summary(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now(), p_include_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_scope public.analytics_scope;
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
  v_month_start timestamptz;
  v_mrr bigint; v_mrr_prev bigint;
  v_seats bigint; v_seats_prev bigint;
  v_paying bigint; v_paying_prev bigint;
  v_users bigint; v_users_prev bigint;
  v_orgs bigint; v_orgs_prev bigint;
  v_filled bigint;
  v_trial_mrr bigint;
  v_annual_mrr bigint;
  v_revenue bigint; v_sub_revenue bigint; v_usage_revenue bigint; v_credit_revenue bigint;
  v_refunds bigint; v_tax bigint;
  v_result jsonb;
  v_days numeric;
begin
  v_scope := private.require_analytics('investor');

  v_month_start := date_trunc('month', now());
  v_days := greatest(extract(epoch from (p_to - p_from)) / 86400.0, 1);

  v_mrr         := private.mrr_cents_at(now(), v_inc);
  v_mrr_prev    := private.mrr_cents_at(v_month_start, v_inc);
  v_seats       := private.seats_at(now(), v_inc);
  v_seats_prev  := private.seats_at(v_month_start, v_inc);
  v_paying      := private.paying_orgs_at(now(), v_inc);
  v_paying_prev := private.paying_orgs_at(v_month_start, v_inc);

  select count(distinct m.user_id) into v_users
  from public.org_members m where private.analytics_in_scope(m.org_id, v_inc);
  select count(distinct m.user_id) into v_users_prev
  from public.org_members m
  where m.created_at < v_month_start and private.analytics_in_scope(m.org_id, v_inc);
  select count(*) into v_orgs from public.orgs o where private.analytics_in_scope(o.id, v_inc);
  select count(*) into v_orgs_prev from public.orgs o
  where o.created_at < v_month_start and private.analytics_in_scope(o.id, v_inc);

  -- Field Capture seats in use on paying orgs.
  select coalesce(sum(private.field_capture_seats_used(b.org_id)), 0) into v_filled
  from public.org_billing b
  where private.org_billing_mrr_cents(b) > 0
    and private.analytics_in_scope(b.org_id, v_inc);

  -- Trial pipeline: MRR if every live trial converted at its stored price.
  select coalesce(sum(private.org_mrr_cents(
           'active', b.stripe_subscription_id, b.stripe_livemode, b.stripe_mrr_cents,
           b.atmosphere_plan_code, b.stripe_interval, b.extra_fc_seats,
           b.plan_code, b.billing_interval, b.seats)), 0)
    into v_trial_mrr
  from public.org_billing b
  where b.status = 'trialing' and private.analytics_in_scope(b.org_id, v_inc);

  -- The slice of MRR on annual (prepaid) terms.
  select coalesce(sum(private.org_billing_mrr_cents(b)), 0) into v_annual_mrr
  from public.org_billing b
  where coalesce(b.stripe_interval, case when b.billing_interval = 'annual' then 'year' end) = 'year'
    and private.analytics_in_scope(b.org_id, v_inc);

  select
    coalesce(sum(net_cents), 0),
    coalesce(sum(net_cents) filter (where kind = 'subscription'), 0),
    coalesce(sum(net_cents) filter (where kind = 'usage'), 0),
    coalesce(sum(net_cents) filter (where kind = 'credits'), 0),
    coalesce(sum(net_cents) filter (where kind = 'refund'), 0),
    coalesce(sum(tax_cents), 0)
  into v_revenue, v_sub_revenue, v_usage_revenue, v_credit_revenue, v_refunds, v_tax
  from private.payments_net
  where created_at >= p_from and created_at < p_to
    and private.analytics_in_scope(org_id, v_inc);

  v_result := jsonb_build_object(
    'scope', v_scope,
    'include_internal', v_inc,
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', round(v_days, 1)),

    'customers', jsonb_build_object(
      'orgs_total', v_orgs,
      'orgs_new', (select count(*) from public.orgs o
                   where o.created_at >= p_from and o.created_at < p_to
                     and private.analytics_in_scope(o.id, v_inc)),
      'orgs_paying', v_paying,
      'orgs_paying_prev', v_paying_prev,
      'orgs_active', (
        select count(distinct a.org_id) from (
          select org_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select org_id from public.usage_events where created_at >= p_from and created_at < p_to
        ) a where private.analytics_in_scope(a.org_id, v_inc)),
      'orgs_excluded', (select count(*) from public.orgs o where private.org_internal_reason(o.id) is not null),
      'orgs_growth_mom_pct', private.pct_change(v_orgs, v_orgs_prev),
      'paying_growth_mom_pct', private.pct_change(v_paying, v_paying_prev)),

    'users', jsonb_build_object(
      'users_total', v_users,
      'users_new', (select count(distinct m.user_id) from public.org_members m
                    where m.created_at >= p_from and m.created_at < p_to
                      and private.analytics_in_scope(m.org_id, v_inc)),
      'users_active', (
        select count(distinct a.user_id) from (
          select user_id, org_id from public.feature_usage_sessions where last_seen_at >= p_from and last_seen_at < p_to
          union
          select user_id, org_id from public.usage_events where user_id is not null and created_at >= p_from and created_at < p_to
        ) a where private.analytics_in_scope(a.org_id, v_inc)),
      'users_growth_mom_pct', private.pct_change(v_users, v_users_prev)),

    'seats', jsonb_build_object(
      'seats_licensed', v_seats,
      'seats_filled', v_filled,
      'seat_utilization_pct', case when v_seats > 0 then round(v_filled::numeric / v_seats * 100, 1) end,
      'seats_growth_mom_pct', private.pct_change(v_seats, v_seats_prev)),

    'revenue', jsonb_build_object(
      'mrr_cents', v_mrr,
      'arr_cents', v_mrr * 12,
      'annual_contracted_mrr_cents', v_annual_mrr,
      'annual_contracted_arr_cents', v_annual_mrr * 12,
      'monthly_billed_mrr_cents', v_mrr - v_annual_mrr,
      'trial_pipeline_mrr_cents', v_trial_mrr,
      'mrr_growth_mom_pct', private.pct_change(v_mrr, v_mrr_prev),
      'net_new_mrr_cents', v_mrr - v_mrr_prev,
      'churned_orgs_this_month', private.churned_orgs_between(v_month_start, now(), v_inc),
      'collected_in_range_cents', v_revenue,
      'subscription_revenue_cents', v_sub_revenue,
      'usage_revenue_cents', v_usage_revenue,
      'credit_revenue_cents', v_credit_revenue,
      'refunds_cents', v_refunds,
      'tax_excluded_cents', v_tax,
      'trailing_12m_revenue_cents', (
        select coalesce(sum(net_cents), 0) from private.payments_net
        where created_at >= now() - interval '12 months'
          and private.analytics_in_scope(org_id, v_inc)),
      'avg_monthly_spend_per_account_cents', case when v_paying > 0
        then round((v_revenue / v_days * 30.0) / v_paying) end,
      'avg_monthly_spend_per_seat_cents', case when v_seats > 0
        then round((v_revenue / v_days * 30.0) / v_seats) end,
      'arpa_mrr_cents', case when v_paying > 0 then round(v_mrr::numeric / v_paying) end),

    'engagement', jsonb_build_object(
      'tracked_hours', (
        select round(coalesce(sum(active_ms), 0) / 3600000.0, 2)
        from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'sessions', (
        select count(*) from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'features_used', (
        select count(distinct feature_key) from public.feature_usage_sessions s
        where s.last_seen_at >= p_from and s.last_seen_at < p_to
          and private.analytics_in_scope(s.org_id, v_inc)),
      'features_tracked', (select count(*) from public.feature_catalog where is_active),
      'ai_requests', (
        select count(*) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc))));

  -- AI cost: internal only. List value (cost x customer markup) is NOT
  -- revenue: usage is covered by the plan's AI allowance, not invoiced.
  if v_scope >= 'internal' then
    v_result := v_result || jsonb_build_object('unit_economics', jsonb_build_object(
      'model_cost_cents', (
        select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc)),
      'list_value_cents', (
        select round(coalesce(sum(u.price_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= p_from and u.created_at < p_to
          and private.analytics_in_scope(u.org_id, v_inc)),
      'model_cost_30d_cents', (
        select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0) from public.usage_events u
        where u.created_at >= now() - interval '30 days'
          and private.analytics_in_scope(u.org_id, v_inc))));
  end if;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_monthly(p_months integer DEFAULT 24, p_include_internal boolean DEFAULT false)
 RETURNS TABLE(month date, new_orgs bigint, total_orgs bigint, paying_orgs bigint, active_orgs bigint, churned_orgs bigint, new_users bigint, total_users bigint, active_users bigint, seats bigint, mrr_cents bigint, arr_cents bigint, revenue_cents bigint, subscription_revenue_cents bigint, usage_revenue_cents bigint, credit_revenue_cents bigint, refunds_cents bigint, arpa_cents numeric, mrr_growth_pct numeric, user_growth_pct numeric, seat_growth_pct numeric, tracked_hours numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with months as (
    select generate_series(
      date_trunc('month', now()) - ((least(greatest(p_months, 1), 60) - 1) * interval '1 month'),
      date_trunc('month', now()),
      interval '1 month'
    )::timestamptz as m_start
  ),
  bounds as (
    select m_start,
           m_start + interval '1 month' as m_end,
           least(m_start + interval '1 month', now()) as m_at
    from months
  ),
  pay as (
    select pn.* from private.payments_net pn where private.analytics_in_scope(pn.org_id, v_inc)
  ),
  base as (
    select
      b.m_start::date as month,
      (select count(*) from public.orgs o
        where o.created_at >= b.m_start and o.created_at < b.m_end
          and private.analytics_in_scope(o.id, v_inc)) as new_orgs,
      (select count(*) from public.orgs o
        where o.created_at < b.m_at and private.analytics_in_scope(o.id, v_inc)) as total_orgs,
      private.paying_orgs_at(b.m_at, v_inc) as paying_orgs,
      (select count(distinct a.org_id) from (
         select org_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select org_id, created_at from public.usage_events) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end
         and private.analytics_in_scope(a.org_id, v_inc)) as active_orgs,
      private.churned_orgs_between(b.m_start, b.m_end, v_inc) as churned_orgs,
      (select count(distinct m.user_id) from public.org_members m
        where m.created_at >= b.m_start and m.created_at < b.m_end
          and private.analytics_in_scope(m.org_id, v_inc)) as new_users,
      (select count(distinct m.user_id) from public.org_members m
        where m.created_at < b.m_at and private.analytics_in_scope(m.org_id, v_inc)) as total_users,
      (select count(distinct a.user_id) from (
         select user_id, org_id, last_seen_at as seen_at from public.feature_usage_sessions
         union all
         select user_id, org_id, created_at from public.usage_events where user_id is not null) a
       where a.seen_at >= b.m_start and a.seen_at < b.m_end
         and private.analytics_in_scope(a.org_id, v_inc)) as active_users,
      private.seats_at(b.m_at, v_inc) as seats,
      private.mrr_cents_at(b.m_at, v_inc) as mrr_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.created_at >= b.m_start and p.created_at < b.m_end)::bigint as revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'subscription' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as subscription_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'usage' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as usage_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'credits' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as credit_revenue_cents,
      (select coalesce(sum(p.net_cents), 0) from pay p
        where p.kind = 'refund' and p.created_at >= b.m_start and p.created_at < b.m_end)::bigint
        as refunds_cents,
      (select round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) from public.feature_usage_sessions s
        where s.last_seen_at >= b.m_start and s.last_seen_at < b.m_end
          and private.analytics_in_scope(s.org_id, v_inc)) as tracked_hours
    from bounds b
  )
  select
    month, new_orgs, total_orgs, paying_orgs, active_orgs, churned_orgs,
    new_users, total_users, active_users, seats, mrr_cents, mrr_cents * 12 as arr_cents,
    revenue_cents, subscription_revenue_cents, usage_revenue_cents, credit_revenue_cents, refunds_cents,
    case when paying_orgs > 0 then round(mrr_cents::numeric / paying_orgs) end as arpa_cents,
    private.pct_change(mrr_cents, lag(mrr_cents) over (order by month)) as mrr_growth_pct,
    private.pct_change(total_users, lag(total_users) over (order by month)) as user_growth_pct,
    private.pct_change(seats, lag(seats) over (order by month)) as seat_growth_pct,
    tracked_hours
  from base
  order by base.month;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_features(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now(), p_include_internal boolean DEFAULT false)
 RETURNS TABLE(feature_key text, label text, area text, sessions bigint, active_ms bigint, active_hours numeric, users bigint, orgs bigint, avg_session_minutes numeric, share_pct numeric, time_rank bigint, ai_requests bigint, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with usage as (
    select s.feature_key,
           count(*)                              as sessions,
           coalesce(sum(s.active_ms), 0)::bigint as active_ms,
           count(distinct s.user_id)             as users,
           count(distinct s.org_id)              as orgs,
           max(s.last_seen_at)                   as last_used_at
    from public.feature_usage_sessions s
    where s.last_seen_at >= p_from and s.last_seen_at < p_to
      and private.analytics_in_scope(s.org_id, v_inc)
    group by s.feature_key
  ),
  ai as (
    select private.ai_feature_catalog_key(u.feature) as feature_key, count(*) as ai_requests
    from public.usage_events u
    where u.feature is not null and u.created_at >= p_from and u.created_at < p_to
      and private.analytics_in_scope(u.org_id, v_inc)
    group by 1
  ),
  total as (select nullif(sum(active_ms), 0) as total_ms from usage)
  select
    f.key, f.label, f.area,
    coalesce(u.sessions, 0),
    coalesce(u.active_ms, 0),
    round(coalesce(u.active_ms, 0) / 3600000.0, 2),
    coalesce(u.users, 0),
    coalesce(u.orgs, 0),
    case when coalesce(u.sessions, 0) > 0
      then round(u.active_ms / (u.sessions * 60000.0), 1) else 0 end,
    round(coalesce(u.active_ms, 0) * 100.0 / coalesce((select total_ms from total), 1), 1),
    row_number() over (order by coalesce(u.active_ms, 0) desc, f.sort_order),
    coalesce(a.ai_requests, 0),
    u.last_used_at
  from public.feature_catalog f
  left join usage u on u.feature_key = f.key
  left join ai a on a.feature_key = f.key
  where f.is_active
  order by coalesce(u.active_ms, 0) desc, f.sort_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_accounts(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 500, p_include_internal boolean DEFAULT false)
 RETURNS TABLE(org_id uuid, org_name text, created_at timestamp with time zone, plan_code text, plan_name text, billing_interval text, status text, seats integer, seats_used integer, members bigint, mrr_cents bigint, arr_cents bigint, revenue_in_range_cents bigint, credit_spend_cents numeric, ai_cost_cents numeric, active_hours numeric, top_feature text, last_active_at timestamp with time zone, internal boolean, internal_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  return query
  with rows_ as (
    select
      o.id, o.name, o.created_at,
      b.org_id as billing_org,
      b.atmosphere_plan_code, b.stripe_interval, b.billing_interval as legacy_interval,
      private.org_billing_label(b) as label,
      case when b.org_id is null then 0 else private.org_billing_fc_seats(b) end as fc_seats,
      coalesce(private.org_billing_mrr_cents(b), 0)::bigint as mrr,
      private.org_internal_reason(o.id) as reason
    from public.orgs o
    left join public.org_billing b on b.org_id = o.id
    where private.analytics_in_scope(o.id, v_inc)
  )
  select
    r.id, r.name, r.created_at,
    case when r.billing_org is null then 'none' else coalesce(r.atmosphere_plan_code, 'work_verification') end,
    case when r.billing_org is null then 'No plan' else private.atmosphere_plan_name(r.atmosphere_plan_code) end,
    case coalesce(r.stripe_interval, case when r.legacy_interval = 'annual' then 'year' else 'month' end)
      when 'year' then 'annual' else 'monthly' end,
    r.label,
    r.fc_seats,
    private.field_capture_seats_used(r.id),
    (select count(*) from public.org_members m where m.org_id = r.id),
    r.mrr,
    r.mrr * 12,
    (select coalesce(sum(pn.net_cents), 0) from private.payments_net pn
      where pn.org_id = r.id and pn.created_at >= p_from and pn.created_at < p_to)::bigint,
    (select round(coalesce(sum(u.price_nanos), 0) / 10000000.0, 2) from public.usage_events u
      where u.org_id = r.id and u.created_at >= p_from and u.created_at < p_to),
    (select round(coalesce(sum(u.cost_nanos), 0) / 10000000.0, 2) from public.usage_events u
      where u.org_id = r.id and u.created_at >= p_from and u.created_at < p_to),
    (select round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) from public.feature_usage_sessions s
      where s.org_id = r.id and s.last_seen_at >= p_from and s.last_seen_at < p_to),
    (select f.label from public.feature_usage_sessions s
      join public.feature_catalog f on f.key = s.feature_key
      where s.org_id = r.id and s.last_seen_at >= p_from and s.last_seen_at < p_to
      group by f.label order by sum(s.active_ms) desc limit 1),
    private.org_last_active_at(r.id),
    r.reason is not null,
    r.reason
  from rows_ r
  order by r.mrr desc, r.created_at desc
  limit least(greatest(p_limit, 1), 5000);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_account_detail(p_org_id uuid, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account jsonb;
begin
  perform private.require_analytics('internal');

  if not exists (select 1 from public.orgs where id = p_org_id) then
    return null;
  end if;

  select to_jsonb(a) into v_account
  from public.analytics_accounts(p_from, p_to, 5000, true) a
  where a.org_id = p_org_id;

  return jsonb_build_object(
    'account', v_account,
    'members', (
      select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt"), '[]'::jsonb)
      from (
        select m.user_id as "userId", pr.email, pr.full_name as "fullName", m.role::text as role,
               m.work_type::text as "workType", m.status, m.created_at as "createdAt"
        from public.org_members m
        left join public.profiles pr on pr.id = m.user_id
        where m.org_id = p_org_id
      ) t
    ),
    'jobs', jsonb_build_object(
      'total', (select count(*) from public.crm_jobs j where j.org_id = p_org_id and j.deleted_at is null),
      'deleted', (select count(*) from public.crm_jobs j where j.org_id = p_org_id and j.deleted_at is not null),
      'byStatus', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select j.status::text as status, count(*)::int as count
          from public.crm_jobs j
          where j.org_id = p_org_id and j.deleted_at is null
          group by j.status
          order by count(*) desc
        ) t
      ),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select j.id, j.title, j.status::text as status, j.work_type::text as "workType",
                 j.job_number as "jobNumber", j.created_at as "createdAt"
          from public.crm_jobs j
          where j.org_id = p_org_id and j.deleted_at is null
          order by j.created_at desc
          limit 25
        ) t
      )
    ),
    'features', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select s.feature_key as "featureKey", coalesce(f.label, s.feature_key) as label,
               round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) as "activeHours",
               count(*)::int as sessions
        from public.feature_usage_sessions s
        left join public.feature_catalog f on f.key = s.feature_key
        where s.org_id = p_org_id and s.last_seen_at >= p_from and s.last_seen_at < p_to
        group by s.feature_key, f.label
        order by sum(s.active_ms) desc
        limit 20
      ) t
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_plan_mix(p_include_internal boolean DEFAULT false)
 RETURNS TABLE(plan_code text, plan_name text, billing_interval text, orgs bigint, seats bigint, mrr_cents bigint, arr_cents bigint, mrr_share_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with classified as (
    select o.id,
           b.atmosphere_plan_code, b.stripe_interval,
           case when b.org_id is null then 0 else private.org_billing_fc_seats(b) end as fc_seats,
           coalesce(private.org_billing_mrr_cents(b), 0) as mrr,
           private.org_billing_label(b) as label
    from public.orgs o
    left join public.org_billing b on b.org_id = o.id
    where private.analytics_in_scope(o.id, v_inc)
  ),
  rows_ as (
    select
      case when c.mrr > 0 then coalesce(c.atmosphere_plan_code, 'work_verification')
           when c.label = 'comp' then 'comp'
           else 'none' end as plan_code,
      case when c.mrr > 0 then private.atmosphere_plan_name(c.atmosphere_plan_code)
           when c.label = 'comp' then 'Comp (no charge)'
           else 'No paid subscription' end as plan_name,
      case when c.mrr > 0 then
             case coalesce(c.stripe_interval, 'month') when 'year' then 'annual' else 'monthly' end
           else '—' end as billing_interval,
      count(*)::bigint as orgs,
      coalesce(sum(case when c.mrr > 0 then c.fc_seats else 0 end), 0)::bigint as seats,
      coalesce(sum(c.mrr), 0)::bigint as mrr_cents
    from classified c
    group by 1, 2, 3
  )
  select r.plan_code, r.plan_name, r.billing_interval, r.orgs, r.seats, r.mrr_cents, r.mrr_cents * 12,
         round(r.mrr_cents * 100.0 / nullif((select sum(x.mrr_cents) from rows_ x), 0), 1)
  from rows_ r
  order by r.mrr_cents desc, r.orgs desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_retention(p_months integer DEFAULT 12, p_include_internal boolean DEFAULT false)
 RETURNS TABLE(cohort_month date, cohort_size bigint, month_offset integer, active_orgs bigint, retention_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('investor');

  return query
  with cohorts as (
    select date_trunc('month', o.created_at) as cohort_month, o.id as org_id
    from public.orgs o
    where o.created_at >= date_trunc('month', now()) - ((least(greatest(p_months, 1), 36) - 1) * interval '1 month')
      and private.analytics_in_scope(o.id, v_inc)
  ),
  sized as (
    select cohort_month, count(*) as cohort_size from cohorts group by cohort_month
  ),
  activity as (
    select org_id, date_trunc('month', seen_at) as active_month from (
      select org_id, last_seen_at as seen_at from public.feature_usage_sessions
      union all
      select org_id, created_at from public.usage_events) a
    group by 1, 2
  )
  select
    s.cohort_month::date,
    s.cohort_size,
    (extract(year from age(m.month, s.cohort_month)) * 12
      + extract(month from age(m.month, s.cohort_month)))::integer as month_offset,
    count(distinct a.org_id) as active_orgs,
    round(count(distinct a.org_id) * 100.0 / nullif(s.cohort_size, 0), 1)
  from sized s
  join lateral generate_series(s.cohort_month, date_trunc('month', now()), interval '1 month') as m(month) on true
  left join cohorts c on c.cohort_month = s.cohort_month
  left join activity a on a.org_id = c.org_id and a.active_month = m.month
  group by s.cohort_month, s.cohort_size, m.month
  order by s.cohort_month desc, 3;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.analytics_product_health(p_weeks integer DEFAULT 12, p_include_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inc        boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
  v_weeks      integer := greatest(4, least(coalesce(p_weeks, 12), 52));
  v_now        timestamptz := now();
  v_this_week  timestamptz := date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC';
  v_from       timestamptz := v_this_week - make_interval(weeks => v_weeks);
  v_cur_from   timestamptz := v_now - interval '28 days';
  v_prev_from  timestamptz := v_now - interval '56 days';
  v_series     jsonb;
  v_uploads    jsonb;
  v_analysis   jsonb;
  v_evidence   jsonb;
  v_ask        jsonb;
begin
  perform private.require_analytics('investor');

  -- North star: hours filmed (live films only) by orgs paying at the end of
  -- the week, over the Field Capture seats those orgs pay for.
  with weeks as (
    select ws,
           least(ws + interval '7 days', v_now) as we,
           (ws + interval '7 days') > v_now     as partial
    from generate_series(v_from, v_this_week, interval '1 week') as ws
  ),
  paying as (
    select w.ws, o.id as org_id, coalesce(e.fc_seats, 0) as seats
    from weeks w
    cross join public.orgs o
    cross join lateral (
      select ev.fc_seats, ev.mrr_cents
      from public.org_billing_events ev
      where ev.org_id = o.id and ev.effective_at <= w.we
      order by ev.effective_at desc, ev.id desc
      limit 1
    ) e
    where e.mrr_cents > 0
      and private.analytics_in_scope(o.id, v_inc)
  ),
  seat_weeks as (
    select ws, sum(greatest(seats, 0))::bigint as seats, count(*)::bigint as orgs
    from paying group by ws
  ),
  proof_weeks as (
    select w.ws,
           coalesce(sum(p.duration_seconds), 0) / 3600.0 as hours_all,
           coalesce(sum(p.duration_seconds) filter (where pa.org_id is not null), 0) / 3600.0 as hours_paying,
           count(p.id)::bigint as films
    from weeks w
    left join public.job_proofs p
      on p.received_at >= w.ws and p.received_at < w.ws + interval '7 days'
     and p.deleted_at is null
     and private.analytics_in_scope(p.org_id, v_inc)
    left join paying pa on pa.ws = w.ws and pa.org_id = p.org_id
    group by w.ws
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start',     w.ws,
           'partial',        w.partial,
           'paying_seats',   coalesce(s.seats, 0),
           'paying_orgs',    coalesce(s.orgs, 0),
           'hours_paying',   round(coalesce(pw.hours_paying, 0)::numeric, 3),
           'hours_all',      round(coalesce(pw.hours_all, 0)::numeric, 3),
           'films',          coalesce(pw.films, 0),
           'hours_per_seat', case when coalesce(s.seats, 0) > 0
                               then round((pw.hours_paying / s.seats)::numeric, 3) end
         ) order by w.ws), '[]'::jsonb)
    into v_series
  from weeks w
  left join seat_weeks s on s.ws = w.ws
  left join proof_weeks pw on pw.ws = w.ws;

  with u as (
    select a.*,
           case when a.started_at >= v_cur_from then 'cur'
                when a.started_at >= v_prev_from then 'prev' end as period,
           (a.completed_at is null and a.failed_at is null
             and a.last_attempt_at > v_now - interval '24 hours') as in_flight
    from public.capture_upload_attempts a
    where a.started_at >= v_prev_from
      and private.analytics_in_scope(a.org_id, v_inc)
  ),
  agg as (
    select period,
           count(*)                                                        as started,
           count(*) filter (where completed_at is not null)                as completed,
           count(*) filter (where completed_at is null and failed_at is not null) as failed,
           count(*) filter (where completed_at is null and failed_at is null and not in_flight) as abandoned,
           count(*) filter (where in_flight)                               as in_flight,
           count(*) filter (where attempts > 1)                            as retried,
           count(*) filter (where attempts > 1 and completed_at is null and in_flight) as retrying
    from u where period is not null group by period
  ),
  errs as (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n) order by n desc, code), '[]'::jsonb) as top
    from (
      select last_error_code as code, count(*) as n
      from u
      where period = 'cur' and completed_at is null and last_error_code is not null
      group by last_error_code
      order by count(*) desc
      limit 5
    ) e
  )
  select jsonb_build_object(
    'tracking_since', (select min(a.started_at) from public.capture_upload_attempts a
                       where private.analytics_in_scope(a.org_id, v_inc)),
    'current',  (select to_jsonb(agg) - 'period' from agg where period = 'cur'),
    'prior',    (select to_jsonb(agg) - 'period' from agg where period = 'prev'),
    'top_errors', (select top from errs)
  ) into v_uploads;

  -- Upload -> FIRST analysis.
  with p as (
    select received_at,
           extract(epoch from (first_analysed_at - received_at)) as secs,
           analysis_status,
           first_analysed_at,
           case when received_at >= v_cur_from then 'cur'
                when received_at >= v_prev_from then 'prev' end as period
    from public.job_proofs
    where received_at >= least(v_prev_from, v_from)
      and deleted_at is null
      and private.analytics_in_scope(org_id, v_inc)
  ),
  per as (
    select period,
           count(*)                                                           as received,
           count(*) filter (where analysis_status = 'done' and secs >= 0)     as analysed,
           count(*) filter (where analysis_status = 'done' and first_analysed_at is null) as first_time_unknown,
           count(*) filter (where analysis_status = 'failed')                 as failed,
           count(*) filter (where analysis_status is null or analysis_status not in ('done', 'failed')) as pending,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where period is not null group by period
  ),
  wk as (
    select date_trunc('week', received_at at time zone 'UTC') at time zone 'UTC' as ws,
           count(*) filter (where analysis_status = 'done' and secs >= 0) as analysed,
           count(*) filter (where analysis_status = 'done' and first_analysed_at is null) as first_time_unknown,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where received_at >= v_from group by 1
  )
  select jsonb_build_object(
    'measured_to', 'first_analysis',
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'weekly',  coalesce((select jsonb_agg(jsonb_build_object(
                  'week_start', ws, 'analysed', analysed, 'first_time_unknown', first_time_unknown,
                  'median_seconds', round(median_seconds::numeric, 1),
                  'p90_seconds', round(p90_seconds::numeric, 1)) order by ws) from wk), '[]'::jsonb)
  ) into v_analysis;

  -- Evidence delivered. Proofs analysed = live films whose FIRST analysis
  -- finished in the window (re-analysis is not new evidence).
  select jsonb_build_object(
    'current', jsonb_build_object(
      'proofs_analysed', (select count(*) from public.job_proofs p
        where p.first_analysed_at >= v_cur_from and p.deleted_at is null
          and private.analytics_in_scope(p.org_id, v_inc)),
      'daily_reports_sent', (select count(*) from public.daily_job_reports d
        where d.status = 'sent' and d.sent_at >= v_cur_from and private.analytics_in_scope(d.org_id, v_inc)),
      'evidence_downloads', (select count(*) from public.evidence_downloads e
        where e.created_at >= v_cur_from and private.analytics_in_scope(e.org_id, v_inc)),
      'share_links_created', (select count(*) from public.verifier_shares s
        where s.created_at >= v_cur_from and private.analytics_in_scope(s.org_id, v_inc)),
      'share_links_opened', (select count(*) from public.verifier_shares s
        where s.last_opened_at >= v_cur_from and private.analytics_in_scope(s.org_id, v_inc))),
    'prior', jsonb_build_object(
      'proofs_analysed', (select count(*) from public.job_proofs p
        where p.first_analysed_at >= v_prev_from and p.first_analysed_at < v_cur_from and p.deleted_at is null
          and private.analytics_in_scope(p.org_id, v_inc)),
      'daily_reports_sent', (select count(*) from public.daily_job_reports d
        where d.status = 'sent' and d.sent_at >= v_prev_from and d.sent_at < v_cur_from
          and private.analytics_in_scope(d.org_id, v_inc)),
      'evidence_downloads', (select count(*) from public.evidence_downloads e
        where e.created_at >= v_prev_from and e.created_at < v_cur_from
          and private.analytics_in_scope(e.org_id, v_inc)),
      'share_links_created', (select count(*) from public.verifier_shares s
        where s.created_at >= v_prev_from and s.created_at < v_cur_from
          and private.analytics_in_scope(s.org_id, v_inc)),
      'share_links_opened', null),
    'lifetime', jsonb_build_object(
      'share_links', (select count(*) from public.verifier_shares s where private.analytics_in_scope(s.org_id, v_inc)),
      'share_link_opens', (select coalesce(sum(s.open_count), 0) from public.verifier_shares s
        where private.analytics_in_scope(s.org_id, v_inc)))
  ) into v_evidence;

  with t as (
    select outcome, total_ms, ttft_ms,
           case when created_at >= v_cur_from then 'cur'
                when created_at >= v_prev_from then 'prev' end as period
    from public.ask_turn_events
    where created_at >= v_prev_from
      and private.analytics_in_scope(org_id, v_inc)
  ),
  per as (
    select period,
           count(*)                                           as turns,
           count(*) filter (where outcome = 'answered')       as answered,
           count(*) filter (where outcome = 'error')          as errors,
           count(*) filter (where outcome = 'refused')        as refused,
           count(*) filter (where outcome = 'stopped')        as stopped,
           percentile_cont(0.5) within group (order by total_ms) filter (where outcome = 'answered') as median_ms,
           percentile_cont(0.9) within group (order by total_ms) filter (where outcome = 'answered') as p90_ms,
           percentile_cont(0.5) within group (order by ttft_ms)  filter (where outcome = 'answered' and ttft_ms is not null) as median_ttft_ms
    from t where period is not null group by period
  )
  select jsonb_build_object(
    'tracking_since', (select min(a.created_at) from public.ask_turn_events a
                       where private.analytics_in_scope(a.org_id, v_inc)),
    'questions', jsonb_build_object(
      'current', (select count(*) from public.job_proof_questions q
        where q.created_at >= v_cur_from and private.analytics_in_scope(q.org_id, v_inc)),
      'prior', (select count(*) from public.job_proof_questions q
        where q.created_at >= v_prev_from and q.created_at < v_cur_from and private.analytics_in_scope(q.org_id, v_inc)),
      'orgs_current', (select count(distinct q.org_id) from public.job_proof_questions q
        where q.created_at >= v_cur_from and private.analytics_in_scope(q.org_id, v_inc))),
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'feedback', null
  ) into v_ask;

  return jsonb_build_object(
    'generated_at', v_now,
    'weeks', v_weeks,
    'include_internal', v_inc,
    'windows', jsonb_build_object(
      'current', jsonb_build_object('from', v_cur_from, 'to', v_now),
      'prior',   jsonb_build_object('from', v_prev_from, 'to', v_cur_from)),
    'north_star', jsonb_build_object('weekly', v_series),
    'uploads', v_uploads,
    'analysis', v_analysis,
    'evidence', v_evidence,
    'ask', v_ask
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_token_usage_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'includeInternal', v_inc,
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'inputTokens', coalesce(sum(e.input_tokens), 0),
        'outputTokens', coalesce(sum(e.output_tokens), 0),
        'cacheTokens', coalesce(sum(e.cache_tokens), 0),
        'totalTokens', coalesce(sum(e.total_tokens), 0),
        'priceNanos', coalesce(sum(e.price_nanos), 0),
        'costNanos', coalesce(sum(e.cost_nanos), 0),
        'distinctOrgs', count(distinct e.org_id)::int,
        'distinctUsers', count(distinct e.user_id) filter (where e.user_id is not null)::int,
        'distinctModels', count(distinct e.model_id) filter (
          where e.model_id is not null and btrim(e.model_id) <> '')::int
      )
      from public.token_usage_events e
      where e.created_at >= p_from and e.created_at < p_to
        and private.analytics_in_scope(e.org_id, v_inc)
    ),
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.org_id as "orgId", o.name as "orgName",
               private.org_internal_reason(e.org_id) is not null as "internal",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos",
               count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers",
               count(distinct e.model_id) filter (
                 where e.model_id is not null and btrim(e.model_id) <> '')::int as "distinctModels"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.org_id, o.name
        order by sum(e.total_tokens) desc, o.name asc
        limit 200
      ) t
    ),
    'byUser', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.user_id as "userId",
               coalesce(nullif(btrim(pr.full_name), ''), split_part(coalesce(au.email, ''), '@', 1), 'Unattributed') as "userName",
               au.email as "email",
               e.org_id as "orgId", o.name as "orgName",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        left join public.profiles pr on pr.id = e.user_id
        left join auth.users au on au.id = e.user_id
        where e.created_at >= p_from and e.created_at < p_to
          and e.user_id is not null
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.user_id, pr.full_name, au.email, e.org_id, o.name
        order by sum(e.total_tokens) desc, coalesce(au.email, '') asc
        limit 200
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(e.model_id), ''), '(unknown)') as "model",
               count(*)::int as "eventCount",
               coalesce(sum(e.input_tokens), 0) as "inputTokens",
               coalesce(sum(e.output_tokens), 0) as "outputTokens",
               coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos",
               count(distinct e.org_id)::int as "distinctOrgs",
               count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by coalesce(nullif(btrim(e.model_id), ''), '(unknown)')
        order by sum(e.total_tokens) desc, 1 asc
        limit 100
      ) t
    ),
    'byFeature', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.feature::text as "feature",
               count(*)::int as "eventCount",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               coalesce(sum(e.price_nanos), 0) as "priceNanos",
               coalesce(sum(e.cost_nanos), 0) as "costNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.feature
        order by sum(e.total_tokens) desc
      ) t
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_metering_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_inc boolean := coalesce(p_include_internal, false)
    and coalesce(private.analytics_scope() = 'internal', false);  -- investors always see customers only
begin
  perform private.require_analytics('internal');

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'source', 'token_usage_events',
    'includeInternal', v_inc,
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.org_id as "orgId", o.name as "orgName",
               private.org_internal_reason(e.org_id) is not null as "internal",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos",
               round(coalesce(sum(e.cost_nanos), 0) / 10000000.0, 2) as "computeUnits",
               coalesce(sum(e.total_tokens), 0) as "totalTokens",
               count(distinct e.job_id) filter (where e.job_id is not null) as "distinctJobs"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.org_id, o.name
        order by sum(e.cost_nanos) desc
        limit 100
      ) t
    ),
    'byWorkflow', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select e.feature::text as "workflowId",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by e.feature
        order by sum(e.cost_nanos) desc
        limit 50
      ) t
    ),
    'byAgent', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(e.source), ''), '(unspecified)') as "agentType",
               count(*)::int as "eventCount",
               coalesce(sum(e.cost_nanos), 0) as "aiCostNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
          and private.analytics_in_scope(e.org_id, v_inc)
        group by 1
        order by sum(e.cost_nanos) desc
        limit 50
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select x.provider, x.model,
               count(*)::int as "eventCount",
               coalesce(sum(x.cost_nanos), 0) as "aiCostNanos"
        from (
          select e.cost_nanos,
                 coalesce(nullif(btrim(e.model_id), ''), '(unknown)') as model,
                 coalesce(nullif(btrim(e.metadata ->> 'provider'), ''),
                   case
                     when e.model_id ilike 'claude%' or e.model_id ilike 'anthropic%' then 'anthropic'
                     when e.model_id ilike 'gpt%' or e.model_id ~* '^o[0-9]' or e.model_id ilike 'openai%' then 'openai'
                     when e.model_id ilike 'gemini%' or e.model_id ilike 'google%' then 'google'
                     when e.model_id ilike 'grok%' or e.model_id ilike 'xai%' then 'xai'
                     else 'unknown'
                   end) as provider
          from public.token_usage_events e
          where e.created_at >= p_from and e.created_at < p_to
            and private.analytics_in_scope(e.org_id, v_inc)
        ) x
        group by x.provider, x.model
        order by sum(x.cost_nanos) desc
        limit 50
      ) t
    ),
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'aiCostNanos', coalesce(sum(e.cost_nanos), 0),
        'computeUnits', round(coalesce(sum(e.cost_nanos), 0) / 10000000.0, 2),
        'totalTokens', coalesce(sum(e.total_tokens), 0),
        'distinctOrgs', count(distinct e.org_id)::int
      )
      from public.token_usage_events e
      where e.created_at >= p_from and e.created_at < p_to
        and private.analytics_in_scope(e.org_id, v_inc)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.job_dup_remap_jsonb(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_text text;
  r record;
begin
  if p is null then
    return null;
  end if;
  v_text := p::text;
  for r in
    select distinct m.old_id::text as old_text, m.new_id::text as new_text
    from regexp_matches(
           v_text,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
           'g'
         ) as x(v)
    join pg_temp.job_dup_map m on m.old_id = x.v[1]::uuid
  loop
    v_text := replace(v_text, r.old_text, r.new_text);
  end loop;
  return v_text::jsonb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.duplicate_job_file_contents(p_org_id uuid, p_source_job_id uuid, p_target_job_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_actor_label text DEFAULT 'Office'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  -- Copy order: parents before children. "where" picks the source rows ($1 is
  -- the source job). "set" overrides columns: a SQL expression over the source
  -- row `s`, or JSON null to leave the column to its default.
  v_specs jsonb := $specs$[
    {"t": "job_parties", "where": "s.job_id = $1",
     "set": {"access_token": null, "invited_at": "null", "last_seen_at": "null"}},
    {"t": "job_locations", "where": "s.job_id = $1"},
    {"t": "job_briefs", "where": "s.job_id = $1"},
    {"t": "scope_documents", "where": "s.job_id = $1"},
    {"t": "job_scope_items", "where": "s.job_id = $1"},
    {"t": "job_acknowledgements", "where": "s.job_id = $1"},
    {"t": "job_messages", "where": "s.job_id = $1"},
    {"t": "job_tasks", "where": "s.job_id = $1"},
    {"t": "work_logs", "where": "s.job_id = $1"},
    {"t": "job_assignments", "where": "s.job_id = $1"},
    {"t": "job_proofs", "where": "s.job_id = $1 and s.deleted_at is null",
     "set": {"clip_id": "null", "legal_hold": "false", "hold_reason": "null",
             "scheduled_purge_at": "null",
             "narration_lease_owner": "null", "narration_lease_until": "null",
             "transcript_lease_owner": "null", "transcript_lease_until": "null",
             "analysis_lease_owner": "null", "analysis_lease_until": "null",
             "summary_lease_until": "null"}},
    {"t": "job_proof_segments", "where": "s.proof_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "job_proof_frames", "where": "s.proof_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "ask_transcript_chunks", "where": "s.job_id = $1"},
    {"t": "ask_analysis_chunks", "where": "s.job_id = $1"},
    {"t": "speaker_identities", "where": "s.job_id = $1"},
    {"t": "speaker_role_guesses", "where": "s.job_id = $1"},
    {"t": "clip_room_segments", "where": "s.job_id = $1"},
    {"t": "safety_incidents", "where": "s.job_id = $1"},
    {"t": "work_episodes", "where": "s.job_id = $1"},
    {"t": "recording_acknowledgments", "where": "s.job_id = $1"},
    {"t": "job_chat_documents",
     "where": "(s.job_id = $1 or (s.job_id is null and s.context_job_id = $1))"},
    {"t": "ask_document_chunks", "where": "s.document_id in (select old_id from pg_temp.job_dup_map)"},
    {"t": "job_document_rooms", "where": "s.job_id = $1"},
    {"t": "ask_threads", "where": "s.job_id = $1 and s.share_id is null"},
    {"t": "job_proof_questions", "where": "s.job_id = $1"},
    {"t": "ask_pinned_answers", "where": "s.job_id = $1"},
    {"t": "ask_answer_feedback", "where": "s.job_id = $1"},
    {"t": "ask_job_notes", "where": "s.job_id = $1 and s.share_id is null"}
  ]$specs$::jsonb;
  v_spec jsonb;
  v_table text;
  v_rel regclass;
  v_tables text[] := '{}';
  v_where text;
  v_cols text[];
  v_exprs text[];
  v_count integer;
  v_counts jsonb := '{}'::jsonb;
  v_source_title text;
  v_target_title text;
  v_target_number bigint;
  c record;
begin
  if p_org_id is null or p_source_job_id is null or p_target_job_id is null
     or p_source_job_id = p_target_job_id then
    raise exception 'duplicate_bad_arguments' using errcode = '22023';
  end if;

  select title into v_source_title
  from public.crm_jobs
  where id = p_source_job_id and org_id = p_org_id;
  if not found then
    raise exception 'duplicate_source_not_found' using errcode = 'P0002';
  end if;

  select title, job_number into v_target_title, v_target_number
  from public.crm_jobs
  where id = p_target_job_id and org_id = p_org_id;
  if not found then
    raise exception 'duplicate_target_not_found' using errcode = 'P0002';
  end if;

  -- Copy into a fresh job only, never on top of one that has its own file.
  if exists (select 1 from public.job_briefs where job_id = p_target_job_id)
     or exists (select 1 from public.job_proofs where job_id = p_target_job_id)
     or exists (select 1 from public.job_proof_questions where job_id = p_target_job_id) then
    raise exception 'duplicate_target_not_empty' using errcode = '23505';
  end if;

  if to_regclass('pg_temp.job_dup_map') is not null then
    drop table pg_temp.job_dup_map;
  end if;
  create temp table job_dup_map (
    old_id uuid primary key,
    new_id uuid not null unique,
    tbl    text not null
  ) on commit drop;
  insert into pg_temp.job_dup_map values (p_source_job_id, p_target_job_id, 'crm_jobs');

  -- Tables this database has (ask_analysis_chunks needs pgvector).
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    if to_regclass('public.' || (v_spec ->> 't')) is not null then
      v_tables := v_tables || (v_spec ->> 't');
    end if;
  end loop;

  -- Pass 1: mint the new ids for every row, so pass 2 can rewrite references
  -- in any direction (a thread's summary points at a later question). A row
  -- whose required parent is not being copied (a question in a homeowner's
  -- share thread, a frame of a deleted clip) is left out.
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    v_table := v_spec ->> 't';
    continue when not v_table = any (v_tables);
    v_rel := ('public.' || v_table)::regclass;
    v_where := v_spec ->> 'where';
    for c in
      select a.attname
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f'
        and k.conrelid = v_rel
        and k.confrelid <> v_rel
        and array_length(k.conkey, 1) = 1
        and k.confrelid::regclass::text = any (v_tables)
    loop
      v_where := v_where || format(
        ' and (s.%1$I is null or s.%1$I in (select old_id from pg_temp.job_dup_map))',
        c.attname
      );
    end loop;
    execute format(
      'insert into pg_temp.job_dup_map (old_id, new_id, tbl)
         select s.id, gen_random_uuid(), %L from %s s where %s',
      v_table, v_rel, v_where
    ) using p_source_job_id;
  end loop;

  -- Pass 2: copy each table's rows under their new ids.
  for v_spec in select value from jsonb_array_elements(v_specs) loop
    v_table := v_spec ->> 't';
    continue when not v_table = any (v_tables);
    v_rel := ('public.' || v_table)::regclass;
    v_cols := '{}';
    v_exprs := '{}';
    for c in
      select
        a.attname,
        format_type(a.atttypid, a.atttypmod) as typ,
        (
          select k.confrelid::regclass::text
          from pg_constraint k
          where k.contype = 'f'
            and k.conrelid = v_rel
            and array_length(k.conkey, 1) = 1
            and k.conkey[1] = a.attnum
          limit 1
        ) as fk_table
      from pg_attribute a
      where a.attrelid = v_rel
        and a.attnum > 0
        and not a.attisdropped
        and a.attgenerated = ''
        and a.attidentity = ''
      order by a.attnum
    loop
      if (v_spec -> 'set') ? c.attname then
        continue when jsonb_typeof(v_spec -> 'set' -> c.attname) = 'null';
        v_cols := v_cols || quote_ident(c.attname);
        v_exprs := v_exprs || (v_spec -> 'set' ->> c.attname);
        continue;
      end if;
      v_cols := v_cols || quote_ident(c.attname);
      if c.attname = 'id' then
        v_exprs := v_exprs || 'm0.new_id'::text;
      elsif c.fk_table = 'crm_jobs' then
        v_exprs := v_exprs || format(
          'case when s.%1$I = $1 then $2 else s.%1$I end', c.attname
        );
      elsif c.fk_table = any (v_tables) then
        -- References inside the job file follow the copy; one that is not
        -- copied (a deleted clip) is cleared rather than left pointing back.
        v_exprs := v_exprs || format(
          '(select m.new_id from pg_temp.job_dup_map m where m.old_id = s.%I)', c.attname
        );
      elsif c.typ = 'uuid' then
        v_exprs := v_exprs || format(
          'coalesce((select m.new_id from pg_temp.job_dup_map m where m.old_id = s.%1$I), s.%1$I)',
          c.attname
        );
      elsif c.typ = 'uuid[]' then
        v_exprs := v_exprs || format(
          'case when s.%1$I is null then null else array(
             select coalesce(m.new_id, u.x)
             from unnest(s.%1$I) with ordinality as u(x, n)
             left join pg_temp.job_dup_map m on m.old_id = u.x
             order by u.n) end',
          c.attname
        );
      elsif c.typ = 'jsonb' then
        v_exprs := v_exprs || format('private.job_dup_remap_jsonb(s.%I)', c.attname);
      elsif c.typ = 'json' then
        v_exprs := v_exprs || format('private.job_dup_remap_jsonb(s.%I::jsonb)::json', c.attname);
      else
        v_exprs := v_exprs || format('s.%I', c.attname);
      end if;
    end loop;

    execute format(
      'insert into %s (%s) select %s from %s s
         join pg_temp.job_dup_map m0 on m0.old_id = s.id and m0.tbl = %L',
      v_rel,
      array_to_string(v_cols, ', '),
      array_to_string(v_exprs, ', '),
      v_rel,
      v_table
    ) using p_source_job_id, p_target_job_id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;

  -- Custody: say where the copy's clips came from, and on the original that
  -- they were copied out. Nothing from the original's log is replayed here.
  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  select p_org_id, p_target_job_id, m.new_id, 'duplicated', p_actor_id,
         coalesce(nullif(p_actor_label, ''), 'Office'),
         left(format('from “%s”', v_source_title), 500)
  from pg_temp.job_dup_map m
  where m.tbl = 'job_proofs';

  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  select p_org_id, p_source_job_id, m.old_id, 'duplicated', p_actor_id,
         coalesce(nullif(p_actor_label, ''), 'Office'),
         left(format('to “%s”', v_target_title), 500)
  from pg_temp.job_dup_map m
  where m.tbl = 'job_proofs';

  insert into public.job_evidence_access
    (org_id, job_id, proof_id, action, actor_id, actor_label, detail)
  values
    (p_org_id, p_target_job_id, null, 'duplicated', p_actor_id,
     coalesce(nullif(p_actor_label, ''), 'Office'),
     left(format('Job file duplicated from “%s”. Earlier filing, viewing and sharing of these clips is recorded on the original.', v_source_title), 500)),
    (p_org_id, p_source_job_id, null, 'duplicated', p_actor_id,
     coalesce(nullif(p_actor_label, ''), 'Office'),
     left(format('Job file duplicated to “%s”%s.', v_target_title,
                 coalesce(' (#' || v_target_number || ')', '')), 500));

  drop table if exists pg_temp.job_dup_map;
  return v_counts;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.has_job_progress_grant(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.job_progress_grants g
    join public.verifier_shares s on s.id = g.share_id
    join auth.users u on u.id = g.user_id
    where g.job_id = p_job_id
      and g.user_id = auth.uid()
      and g.revoked_at is null
      and s.revoked_at is null
      and s.job_id = g.job_id
      and lower(coalesce(s.recipient_email, '')) = lower(coalesce(u.email, ''))
      and lower(g.recipient_email) = lower(coalesce(u.email, ''))
  );
$function$
;

CREATE OR REPLACE FUNCTION private.revoke_job_progress_grants_on_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.job_progress_grants
       set revoked_at = new.revoked_at
     where share_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$function$
;

alter table public.profiles alter column created_at set default now();

alter table public.profiles alter column updated_at set default now();

alter table public.orgs alter column wellness_critical_after_seconds set default 600;

alter table public.orgs alter column exclude_from_analytics set default false;

alter table public.orgs alter column safety_live_enabled set default true;

alter table public.orgs alter column child_blur_enabled set default true;

alter table public.orgs alter column daily_job_report_extra_emails set default '{}'::text[];

alter table public.orgs alter column daily_job_report_send_hour set default 18;

alter table public.orgs alter column daily_job_report_channel set default 'email'::text;

alter table public.orgs alter column daily_job_report_timezone set default 'America/New_York'::text;

alter table public.orgs alter column daily_job_report_enabled set default false;

alter table public.orgs alter column wellness_require_alone set default true;

alter table public.orgs alter column wellness_no_motion_seconds set default 300;

alter table public.orgs alter column wellness_check_enabled set default true;

alter table public.orgs alter column safety_alert_emails set default '{}'::text[];

alter table public.orgs alter column safety_auto_escalate_to_authorities set default false;

alter table public.orgs alter column location_retention_hours set default 24;

alter table public.orgs alter column created_at set default now();

alter table public.orgs alter column id set default gen_random_uuid();

alter table public.org_members alter column status set default 'active'::text;

alter table public.org_members alter column id set default gen_random_uuid();

alter table public.org_members alter column usage_intents set default '{}'::text[];

alter table public.org_members alter column created_at set default now();

alter table public.device_credentials alter column lockouts set default 0;

alter table public.device_credentials alter column id set default gen_random_uuid();

alter table public.device_credentials alter column failed_attempts set default 0;

alter table public.device_credentials alter column created_at set default now();

alter table private.model_costs alter column markup set default 2.0;

alter table private.model_costs alter column cache_read_multiplier set default 0.1;

alter table private.model_costs alter column cache_write_1h_multiplier set default 2.0;

alter table private.model_costs alter column provider set default 'anthropic'::text;

alter table private.model_costs alter column cache_write_5m_multiplier set default 1.25;

alter table private.model_costs alter column updated_at set default now();

alter table private.model_costs alter column created_at set default now();

alter table private.model_costs alter column sort_order set default 100;

alter table private.model_costs alter column is_active set default true;

alter table private.model_costs alter column batch_multiplier set default 0.5;

alter table public.billing_plans alter column features set default '[]'::jsonb;

alter table public.billing_plans alter column is_contact_sales set default false;

alter table public.billing_plans alter column is_active set default true;

alter table public.billing_plans alter column sort_order set default 100;

alter table public.billing_plans alter column rate_multiplier set default 1;

alter table public.billing_plans alter column min_seats set default 1;

alter table public.billing_plans alter column per_seat set default false;

alter table public.billing_plans alter column included_credits_nanos set default 0;

alter table public.org_billing alter column included_fc_seats set default 3;

alter table public.org_billing alter column period_start set default now();

alter table public.org_billing alter column period_end set default (now() + '1 mon'::interval);

alter table public.org_billing alter column cancel_at_period_end set default false;

alter table public.org_billing alter column auto_reload_enabled set default false;

alter table public.org_billing alter column auto_reload_threshold_nanos set default '5000000000'::bigint;

alter table public.org_billing alter column auto_reload_amount_nanos set default '25000000000'::bigint;

alter table public.org_billing alter column created_at set default now();

alter table public.org_billing alter column updated_at set default now();

alter table public.org_billing alter column extra_fc_seats set default 0;

alter table public.org_billing alter column atmosphere_plan_code set default 'work_verification'::text;

alter table public.org_billing alter column plan_code set default 'free'::text;

alter table public.org_billing alter column billing_interval set default 'monthly'::billing_interval;

alter table public.org_billing alter column seats set default 1;

alter table public.org_billing alter column status set default 'active'::subscription_status;

alter table public.payments alter column id set default gen_random_uuid();

alter table public.payments alter column updated_at set default now();

alter table public.payments alter column created_at set default now();

alter table public.payments alter column currency set default 'usd'::text;

alter table public.payments alter column status set default 'pending'::text;

alter table private.stripe_events alter column received_at set default now();

alter table public.analytics_staff alter column scope set default 'internal'::analytics_scope;

alter table public.analytics_staff alter column created_at set default now();

alter table public.feature_catalog alter column is_active set default true;

alter table public.feature_catalog alter column sort_order set default 100;

alter table public.feature_usage_sessions alter column last_seen_at set default now();

alter table public.feature_usage_sessions alter column id set default gen_random_uuid();

alter table public.feature_usage_sessions alter column client set default 'web'::text;

alter table public.feature_usage_sessions alter column started_at set default now();

alter table public.feature_usage_sessions alter column active_ms set default 0;

alter table public.feature_usage_sessions alter column interactions set default 0;

alter table public.feature_usage_daily alter column interactions set default 0;

alter table public.feature_usage_daily alter column sessions set default 0;

alter table public.feature_usage_daily alter column active_ms set default 0;

alter table public.org_billing_events alter column mrr_cents set default 0;

alter table public.org_billing_events alter column effective_at set default now();

alter table public.org_billing_events alter column source set default 'change'::text;

alter table public.org_billing_events alter column id set default nextval('org_billing_events_id_seq'::regclass);

alter table public.jobs alter column created_by set default auth.uid();

alter table public.jobs alter column updated_at set default now();

alter table public.jobs alter column id set default gen_random_uuid();

alter table public.jobs alter column status set default 'lead'::text;

alter table public.jobs alter column priority set default 'normal'::text;

alter table public.jobs alter column created_at set default now();

alter table public.job_tasks alter column org_id set default memory.current_org_id();

alter table public.job_tasks alter column created_by set default auth.uid();

alter table public.job_tasks alter column created_at set default now();

alter table public.job_tasks alter column updated_at set default now();

alter table public.job_tasks alter column "position" set default 0;

alter table public.job_tasks alter column priority set default 'normal'::text;

alter table public.job_tasks alter column id set default gen_random_uuid();

alter table public.job_tasks alter column status set default 'todo'::text;

alter table public.job_assignments alter column updated_at set default now();

alter table public.job_assignments alter column assigned_at set default now();

alter table public.job_assignments alter column id set default gen_random_uuid();

alter table public.job_assignments alter column org_id set default memory.current_org_id();

alter table public.job_assignments alter column role_on_job set default 'crew'::text;

alter table public.job_assignments alter column assigned_by set default auth.uid();

alter table public.work_logs alter column kind set default 'work'::text;

alter table public.work_logs alter column updated_at set default now();

alter table public.work_logs alter column created_at set default now();

alter table public.work_logs alter column author_id set default auth.uid();

alter table public.work_logs alter column occurred_at set default now();

alter table public.work_logs alter column org_id set default memory.current_org_id();

alter table public.work_logs alter column id set default gen_random_uuid();

alter table public.memory_events alter column occurred_at set default now();

alter table public.memory_events alter column id set default gen_random_uuid();

alter table public.memory_events alter column changes set default '{}'::jsonb;

alter table public.memory_events alter column source set default 'trigger'::text;

alter table public.media_objects alter column id set default gen_random_uuid();

alter table public.media_objects alter column tier set default 'hot'::media_tier;

alter table public.media_objects alter column updated_at set default now();

alter table public.media_objects alter column backend set default 'supabase'::media_backend;

alter table public.media_objects alter column kind set default 'field_day_video'::media_kind;

alter table public.media_objects alter column created_at set default now();

alter table public.media_objects alter column state set default 'pending_upload'::media_state;

alter table public.media_objects alter column legal_hold set default false;

alter table public.org_media_quotas alter column updated_at set default now();

alter table public.media_upload_sessions alter column created_at set default now();

alter table public.crm_counters alter column value set default 0;

alter table public.crm_counters alter column id set default gen_random_uuid();

alter table public.crm_properties alter column is_archived set default false;

alter table public.crm_properties alter column created_at set default now();

alter table public.crm_properties alter column country set default 'US'::text;

alter table public.crm_properties alter column id set default gen_random_uuid();

alter table public.crm_properties alter column updated_at set default now();

alter table public.crm_jobs alter column paid_amount set default 0;

alter table public.crm_jobs alter column updated_at set default now();

alter table public.crm_jobs alter column created_at set default now();

alter table public.crm_jobs alter column invoiced_amount set default 0;

alter table public.crm_jobs alter column priority set default 3;

alter table public.crm_jobs alter column status set default 'draft'::crm_job_status;

alter table public.crm_jobs alter column id set default gen_random_uuid();

alter table public.job_parties alter column updated_at set default now();

alter table public.job_parties alter column id set default gen_random_uuid();

alter table public.job_parties alter column role set default 'subcontractor'::text;

alter table public.job_parties alter column access_token set default encode(gen_random_bytes(24), 'hex'::text);

alter table public.job_parties alter column created_at set default now();

alter table public.job_briefs alter column created_at set default now();

alter table public.job_briefs alter column facts set default '{}'::jsonb;

alter table public.job_briefs alter column id set default gen_random_uuid();

alter table public.job_scope_items alter column state set default 'included'::job_scope_state;

alter table public.job_scope_items alter column updated_at set default now();

alter table public.job_scope_items alter column id set default gen_random_uuid();

alter table public.job_scope_items alter column created_at set default now();

alter table public.job_scope_items alter column revision set default 1;

alter table public.job_acknowledgements alter column acknowledged_at set default now();

alter table public.job_acknowledgements alter column id set default gen_random_uuid();

alter table public.job_messages alter column created_at set default now();

alter table public.job_messages alter column is_decision set default false;

alter table public.job_messages alter column id set default gen_random_uuid();

alter table public.job_proofs alter column received_at set default now();

alter table public.job_proofs alter column actions set default '[]'::jsonb;

alter table public.job_proofs alter column ai_budget_hold set default false;

alter table public.job_proofs alter column labels set default '{}'::text[];

alter table public.job_proofs alter column state set default 'uploaded'::job_proof_state;

alter table public.job_proofs alter column checks set default '[]'::jsonb;

alter table public.job_proofs alter column created_at set default now();

alter table public.job_proofs alter column analysis_attempts set default 0;

alter table public.job_proofs alter column tags set default '{}'::text[];

alter table public.job_proofs alter column id set default gen_random_uuid();

alter table public.job_proofs alter column legal_hold set default false;

alter table public.job_proofs alter column device_metadata set default '{}'::jsonb;

alter table public.job_proofs alter column transcript_status set default 'idle'::text;

alter table public.job_proof_frames alter column id set default gen_random_uuid();

alter table public.job_proof_frames alter column created_at set default now();

alter table public.job_proof_questions alter column document_ids set default '{}'::uuid[];

alter table public.job_proof_questions alter column created_at set default now();

alter table public.job_proof_questions alter column grounded_on set default '[]'::jsonb;

alter table public.job_proof_questions alter column id set default gen_random_uuid();

alter table public.job_proof_questions alter column web_sources set default '[]'::jsonb;

alter table public.job_proof_questions alter column office_only set default false;

alter table public.job_evidence_access alter column occurred_at set default now();

alter table public.job_evidence_access alter column id set default gen_random_uuid();

alter table public.job_evidence_policy alter column auto_purge set default false;

alter table public.job_evidence_policy alter column keep_years set default '{"after": 2, "issue": 7, "other": 2, "before": 2, "condition": 7, "completion": 7}'::jsonb;

alter table public.job_evidence_policy alter column updated_at set default now();

alter table public.verifier_shares alter column share_kind set default 'evidence'::text;

alter table public.verifier_shares alter column id set default gen_random_uuid();

alter table public.verifier_shares alter column access_token set default encode(gen_random_bytes(24), 'hex'::text);

alter table public.verifier_shares alter column created_at set default now();

alter table public.verifier_shares alter column open_count set default 0;

alter table public.field_identities alter column id set default gen_random_uuid();

alter table public.field_identities alter column verified_at set default now();

alter table public.field_identities alter column created_at set default now();

alter table public.field_identity_codes alter column attempts set default 0;

alter table public.field_identity_codes alter column created_at set default now();

alter table public.field_identity_codes alter column id set default gen_random_uuid();

alter table public.job_party_claims alter column claimed_at set default now();

alter table public.job_party_claims alter column id set default gen_random_uuid();

alter table public.field_sessions alter column created_at set default now();

alter table public.field_sessions alter column id set default gen_random_uuid();

alter table public.job_intake alter column source_detail set default '{}'::jsonb;

alter table public.job_intake alter column entered_at set default now();

alter table public.scope_documents alter column id set default gen_random_uuid();

alter table public.scope_documents alter column created_at set default now();

alter table public.scope_documents alter column status set default 'uploaded'::text;

alter table public.job_proof_segments alter column frame_count set default 0;

alter table public.job_proof_segments alter column id set default gen_random_uuid();

alter table public.job_proof_segments alter column created_at set default now();

alter table public.evidence_download_policy alter column download_fee_cents set default 2500;

alter table public.evidence_download_policy alter column updated_at set default now();

alter table public.evidence_downloads alter column created_at set default now();

alter table public.evidence_downloads alter column id set default gen_random_uuid();

alter table public.evidence_downloads alter column status set default 'pending_payment'::text;

alter table public.org_invites alter column created_at set default now();

alter table public.org_invites alter column status set default 'pending'::text;

alter table public.org_invites alter column role set default 'employee'::text;

alter table public.org_invites alter column id set default gen_random_uuid();

alter table private.ai_model_pricing alter column id set default gen_random_uuid();

alter table private.ai_model_pricing alter column effective_from set default now();

alter table private.ai_model_pricing alter column created_at set default now();

alter table private.ai_model_pricing alter column metadata set default '{}'::jsonb;

alter table private.ai_model_pricing alter column is_active set default true;

alter table private.compute_unit_config alter column is_active set default true;

alter table private.compute_unit_config alter column created_at set default now();

alter table private.compute_unit_config alter column id set default gen_random_uuid();

alter table private.compute_unit_config alter column effective_from set default now();

alter table private.ai_usage_events alter column embedding_tokens set default 0;

alter table private.ai_usage_events alter column other_variable_cost_nanos set default 0;

alter table private.ai_usage_events alter column billable set default true;

alter table private.ai_usage_events alter column metadata set default '{}'::jsonb;

alter table private.ai_usage_events alter column created_at set default now();

alter table private.ai_usage_events alter column id set default gen_random_uuid();

alter table private.ai_usage_events alter column input_tokens set default 0;

alter table private.ai_usage_events alter column output_tokens set default 0;

alter table private.ai_usage_events alter column cached_input_tokens set default 0;

alter table private.ai_usage_events alter column reasoning_tokens set default 0;

alter table private.ai_usage_events alter column image_count set default 0;

alter table private.ai_usage_events alter column video_seconds set default 0;

alter table private.ai_usage_events alter column audio_seconds set default 0;

alter table private.ai_usage_events alter column ocr_pages set default 0;

alter table private.ai_usage_events alter column third_party_cost_nanos set default 0;

alter table public.qualifying_workflow_types alter column created_at set default now();

alter table public.qualifying_workflow_types alter column sort_order set default 100;

alter table public.qualifying_workflow_types alter column is_active set default true;

alter table public.metering_plans alter column is_active set default true;

alter table public.metering_plans alter column sort_order set default 100;

alter table public.metering_plans alter column id set default gen_random_uuid();

alter table public.metering_plans alter column created_at set default now();

alter table public.metering_plan_versions alter column included_compute_units set default 0;

alter table public.metering_plan_versions alter column compute_unit_overage_nanos set default 0;

alter table public.metering_plan_versions alter column effective_from set default now();

alter table public.metering_plan_versions alter column id set default gen_random_uuid();

alter table public.metering_plan_versions alter column billing_period_days set default 30;

alter table public.metering_plan_versions alter column metadata set default '{}'::jsonb;

alter table public.metering_plan_versions alter column created_at set default now();

alter table public.metering_plan_versions alter column included_jobs set default 0;

alter table public.metering_plan_versions alter column additional_job_price_cents set default 0;

alter table public.org_metering alter column period_anchor_day set default 1;

alter table public.org_metering alter column alert_threshold_pct set default 80;

alter table public.org_metering alter column hard_stop_at_limit set default false;

alter table public.org_metering alter column metadata set default '{}'::jsonb;

alter table public.org_metering alter column created_at set default now();

alter table public.org_metering alter column updated_at set default now();

alter table public.billing_period_jobs alter column first_event_at set default now();

alter table public.billing_period_statements alter column created_at set default now();

alter table public.billing_period_statements alter column id set default gen_random_uuid();

alter table public.billing_period_statements alter column status set default 'open'::billing_period_status;

alter table public.billing_period_statements alter column summary set default '{}'::jsonb;

alter table public.metering_alerts alter column created_at set default now();

alter table public.metering_alerts alter column acknowledged set default false;

alter table public.metering_alerts alter column detail set default '{}'::jsonb;

alter table public.metering_alerts alter column severity set default 'warning'::text;

alter table public.metering_alerts alter column id set default gen_random_uuid();

alter table public.job_locations alter column match_traits set default '{}'::text[];

alter table public.job_locations alter column created_at set default now();

alter table public.job_locations alter column id set default gen_random_uuid();

alter table public.verification_videos alter column id set default gen_random_uuid();

alter table public.verification_videos alter column mime_type set default 'video/mp4'::text;

alter table public.verification_videos alter column upload_date set default now();

alter table public.verification_videos alter column device_metadata set default '{}'::jsonb;

alter table public.verification_videos alter column status set default 'uploaded'::verification_video_status;

alter table public.verification_videos alter column created_at set default now();

alter table public.verification_videos alter column updated_at set default now();

alter table public.verification_videos alter column data_owner set default 'customer'::text;

alter table public.verification_videos alter column training_consent set default 'not_asked'::text;

alter table public.verification_videos alter column anonymized_insights_allowed set default false;

alter table public.verification_videos alter column privacy_status set default 'unknown'::privacy_status;

alter table public.video_processing_jobs alter column max_attempts set default 3;

alter table public.video_processing_jobs alter column created_at set default now();

alter table public.video_processing_jobs alter column updated_at set default now();

alter table public.video_processing_jobs alter column pipeline_version set default 'v1'::text;

alter table public.video_processing_jobs alter column id set default gen_random_uuid();

alter table public.video_processing_jobs alter column status set default 'pending'::verification_step_status;

alter table public.video_processing_jobs alter column attempt_count set default 0;

alter table public.video_processing_jobs alter column config set default '{}'::jsonb;

alter table public.video_processing_steps alter column status set default 'pending'::verification_step_status;

alter table public.video_processing_steps alter column id set default gen_random_uuid();

alter table public.video_processing_steps alter column attempt_count set default 0;

alter table public.video_processing_steps alter column output set default '{}'::jsonb;

alter table public.video_processing_steps alter column created_at set default now();

alter table public.video_processing_steps alter column updated_at set default now();

alter table public.verification_scenes alter column room_type set default 'unidentified'::text;

alter table public.verification_scenes alter column id set default gen_random_uuid();

alter table public.verification_scenes alter column created_at set default now();

alter table public.verification_scenes alter column metadata set default '{}'::jsonb;

alter table public.verification_scenes alter column user_corrected set default false;

alter table public.verification_scenes alter column source set default 'auto'::text;

alter table public.verification_scenes alter column updated_at set default now();

alter table public.verification_frames alter column created_at set default now();

alter table public.verification_frames alter column selected_for_analysis set default false;

alter table public.verification_frames alter column is_duplicate set default false;

alter table public.verification_frames alter column id set default gen_random_uuid();

alter table public.ai_analysis_runs alter column id set default gen_random_uuid();

alter table public.ai_analysis_runs alter column created_at set default now();

alter table public.ai_analysis_runs alter column input_frame_ids set default '{}'::uuid[];

alter table public.frame_observations alter column completion_indicators set default '{}'::text[];

alter table public.frame_observations alter column materials_present set default '{}'::text[];

alter table public.frame_observations alter column id set default gen_random_uuid();

alter table public.frame_observations alter column observed_conditions set default '{}'::text[];

alter table public.frame_observations alter column damage_types set default '{}'::text[];

alter table public.frame_observations alter column work_activities set default '{}'::text[];

alter table public.frame_observations alter column created_at set default now();

alter table public.frame_observations alter column evidence_regions set default '[]'::jsonb;

alter table public.frame_observations alter column uncertainty_reasons set default '{}'::text[];

alter table public.frame_observations alter column visible_text set default '{}'::text[];

alter table public.frame_observations alter column safety_issues set default '{}'::text[];

alter table public.frame_observations alter column equipment_present set default '{}'::text[];

alter table public.temporal_change_events alter column before_frame_ids set default '{}'::uuid[];

alter table public.temporal_change_events alter column id set default gen_random_uuid();

alter table public.temporal_change_events alter column candidate_status set default 'proposed'::text;

alter table public.temporal_change_events alter column during_frame_ids set default '{}'::uuid[];

alter table public.temporal_change_events alter column created_at set default now();

alter table public.temporal_change_events alter column verification_status set default 'uncertain'::verification_result_status;

alter table public.temporal_change_events alter column conflicting_evidence set default '[]'::jsonb;

alter table public.temporal_change_events alter column evidence set default '[]'::jsonb;

alter table public.temporal_change_events alter column after_frame_ids set default '{}'::uuid[];

alter table public.verification_rules alter column created_at set default now();

alter table public.verification_rules alter column id set default gen_random_uuid();

alter table public.verification_rules alter column required_observations set default '{}'::text[];

alter table public.verification_rules alter column required_before_states set default '{}'::text[];

alter table public.verification_rules alter column required_after_states set default '{}'::text[];

alter table public.verification_rules alter column min_supporting_frames set default 2;

alter table public.verification_rules alter column min_confidence set default 0.70;

alter table public.verification_rules alter column contradictory_observations set default '{}'::text[];

alter table public.verification_rules alter column allowed_room_types set default '{}'::text[];

alter table public.verification_rules alter column project_requirements set default '{}'::jsonb;

alter table public.verification_rules alter column human_review_triggers set default '{}'::text[];

alter table public.verification_rules alter column is_active set default true;

alter table public.verification_results alter column created_at set default now();

alter table public.verification_results alter column updated_at set default now();

alter table public.verification_results alter column training_consent set default 'not_asked'::text;

alter table public.verification_results alter column privacy_status set default 'unknown'::privacy_status;

alter table public.verification_results alter column id set default gen_random_uuid();

alter table public.verification_results alter column status set default 'uncertain'::verification_result_status;

alter table public.verification_results alter column confidence_breakdown set default '{}'::jsonb;

alter table public.verification_results alter column rules_result set default '{}'::jsonb;

alter table public.verification_evidence alter column created_at set default now();

alter table public.verification_evidence alter column metadata set default '{}'::jsonb;

alter table public.verification_evidence alter column role set default 'supporting'::text;

alter table public.verification_evidence alter column id set default gen_random_uuid();

alter table public.human_review_tasks alter column context set default '{}'::jsonb;

alter table public.human_review_tasks alter column priority set default 'normal'::text;

alter table public.human_review_tasks alter column status set default 'open'::human_review_status;

alter table public.human_review_tasks alter column id set default gen_random_uuid();

alter table public.human_review_tasks alter column updated_at set default now();

alter table public.human_review_tasks alter column created_at set default now();

alter table public.human_review_decisions alter column id set default gen_random_uuid();

alter table public.human_review_decisions alter column additional_frame_ids set default '{}'::uuid[];

alter table public.human_review_decisions alter column created_at set default now();

alter table public.verification_audit_events alter column id set default gen_random_uuid();

alter table public.verification_audit_events alter column payload set default '{}'::jsonb;

alter table public.verification_audit_events alter column created_at set default now();

alter table public.verification_ai_costs alter column estimated_cost_usd set default 0;

alter table public.verification_ai_costs alter column output_tokens set default 0;

alter table public.verification_ai_costs alter column id set default gen_random_uuid();

alter table public.verification_ai_costs alter column created_at set default now();

alter table public.verification_ai_costs alter column input_tokens set default 0;

alter table public.verification_usage_limits alter column updated_at set default now();

alter table public.verification_usage_limits alter column max_frames_per_video set default 120;

alter table public.video_clips alter column reason set default 'change_candidate'::text;

alter table public.video_clips alter column created_at set default now();

alter table public.video_clips alter column id set default gen_random_uuid();

alter table public.video_clips alter column frame_ids set default '{}'::uuid[];

alter table public.llm_verification_runs alter column input_frame_ids set default '{}'::uuid[];

alter table public.llm_verification_runs alter column id set default gen_random_uuid();

alter table public.llm_verification_runs alter column input_clip_ids set default '{}'::uuid[];

alter table public.llm_verification_runs alter column created_at set default now();

alter table public.network_erasures alter column erased_at set default now();

alter table public.work_episodes alter column confidence set default '{}'::jsonb;

alter table public.work_episodes alter column id set default gen_random_uuid();

alter table public.work_episodes alter column ontology_version set default 'v1'::text;

alter table public.work_episodes alter column task_label_source set default 'ai'::text;

alter table public.work_episodes alter column performer_kind set default 'human'::text;

alter table public.work_episodes alter column status set default 'planned'::work_episode_status;

alter table public.work_episodes alter column tier set default 1;

alter table public.work_episodes alter column worker_consent set default 'not_asked'::work_consent_state;

alter table public.work_episodes alter column data_rights set default 'job_only'::work_data_rights;

alter table public.work_episodes alter column created_at set default now();

alter table public.work_episodes alter column updated_at set default now();

alter table public.episode_observations alter column observed_at set default now();

alter table public.episode_observations alter column created_at set default now();

alter table public.episode_observations alter column id set default gen_random_uuid();

alter table public.episode_observations alter column evidence_kind set default 'video'::text;

alter table public.episode_actions alter column id set default gen_random_uuid();

alter table public.episode_actions alter column created_at set default now();

alter table public.episode_actions alter column label_source set default 'ai'::text;

alter table public.episode_resources alter column settings set default '{}'::jsonb;

alter table public.episode_resources alter column created_at set default now();

alter table public.episode_resources alter column id set default gen_random_uuid();

alter table public.episode_resources alter column source set default 'human'::text;

alter table public.episode_verifications alter column created_at set default now();

alter table public.episode_verifications alter column id set default gen_random_uuid();

alter table public.episode_verifications alter column verified_at set default now();

alter table public.episode_outcomes alter column created_at set default now();

alter table public.episode_outcomes alter column observed_at set default now();

alter table public.episode_outcomes alter column id set default gen_random_uuid();

alter table public.episode_economics alter column updated_at set default now();

alter table public.platform_staff alter column scope set default 'support'::platform_staff_scope;

alter table public.platform_staff alter column created_at set default now();

alter table public.platform_admin_audit alter column id set default gen_random_uuid();

alter table public.platform_admin_audit alter column created_at set default now();

alter table public.platform_admin_audit alter column detail set default '{}'::jsonb;

alter table public.internal_staff_totp alter column last_counter set default '-1'::integer;

alter table public.internal_staff_totp alter column updated_at set default now();

alter table public.internal_staff_totp alter column enrolled_at set default now();

alter table public.internal_access_requests alter column last_requested_at set default now();

alter table public.internal_access_requests alter column id set default gen_random_uuid();

alter table public.internal_access_requests alter column status set default 'pending'::text;

alter table public.internal_access_requests alter column requested_at set default now();

alter table public.legal_holds alter column id set default gen_random_uuid();

alter table public.legal_holds alter column received_at set default now();

alter table public.legal_holds alter column status set default 'open'::legal_hold_status;

alter table public.legal_holds alter column created_at set default now();

alter table public.legal_hold_subjects alter column id set default gen_random_uuid();

alter table public.legal_hold_subjects alter column created_at set default now();

alter table public.legal_video_vault alter column id set default gen_random_uuid();

alter table public.legal_video_vault alter column received_at set default now();

alter table public.legal_video_vault alter column metadata set default '{}'::jsonb;

alter table public.legal_video_vault alter column vaulted_at set default now();

alter table public.user_activity_events alter column detail set default '{}'::jsonb;

alter table public.user_activity_events alter column id set default gen_random_uuid();

alter table public.user_activity_events alter column occurred_at set default now();

alter table public.legal_productions alter column activity_count set default 0;

alter table public.legal_productions alter column created_at set default now();

alter table public.legal_productions alter column id set default gen_random_uuid();

alter table public.legal_productions alter column item_count set default 0;

alter table public.episode_world_states alter column source set default 'ai'::text;

alter table public.episode_world_states alter column uncertainties set default '[]'::jsonb;

alter table public.episode_world_states alter column concerns set default '[]'::jsonb;

alter table public.episode_world_states alter column id set default gen_random_uuid();

alter table public.episode_world_states alter column visible_conditions set default '[]'::jsonb;

alter table public.episode_world_states alter column changes set default '[]'::jsonb;

alter table public.episode_world_states alter column updated_at set default now();

alter table public.episode_world_states alter column objects set default '[]'::jsonb;

alter table public.episode_world_states alter column payload set default '{}'::jsonb;

alter table public.episode_world_states alter column created_at set default now();

alter table public.episode_evidence_assets alter column updated_at set default now();

alter table public.episode_evidence_assets alter column created_at set default now();

alter table public.episode_evidence_assets alter column id set default gen_random_uuid();

alter table public.episode_evidence_assets alter column kind set default 'video'::text;

alter table public.episode_annotations alter column payload set default '{}'::jsonb;

alter table public.episode_annotations alter column id set default gen_random_uuid();

alter table public.episode_annotations alter column created_at set default now();

alter table public.episode_immediate_outcomes alter column updated_at set default now();

alter table public.episode_immediate_outcomes alter column scope_verdicts set default '[]'::jsonb;

alter table public.episode_immediate_outcomes alter column source set default 'ai'::text;

alter table public.episode_immediate_outcomes alter column is_ground_truth set default false;

alter table public.episode_immediate_outcomes alter column created_at set default now();

alter table public.token_usage_events alter column cache_tokens set default 0;

alter table public.token_usage_events alter column metadata set default '{}'::jsonb;

alter table public.token_usage_events alter column cache_write_1h_tokens set default 0;

alter table public.token_usage_events alter column created_at set default now();

alter table public.token_usage_events alter column cost_nanos set default 0;

alter table public.token_usage_events alter column cache_read_tokens set default 0;

alter table public.token_usage_events alter column price_nanos set default 0;

alter table public.token_usage_events alter column cache_write_5m_tokens set default 0;

alter table public.token_usage_events alter column id set default gen_random_uuid();

alter table public.token_usage_events alter column pricing_status set default 'priced'::text;

alter table public.token_usage_events alter column input_tokens set default 0;

alter table public.token_usage_events alter column output_tokens set default 0;

alter table public.crm_audit_log alter column changed_at set default now();

alter table public.terms_acceptances alter column accepted_at set default now();

alter table public.terms_acceptances alter column id set default gen_random_uuid();

alter table public.atmosphere_migrations alter column applied_by set default CURRENT_USER;

alter table public.atmosphere_migrations alter column applied_at set default now();

alter table public.atmosphere_migrations alter column baselined set default false;

alter table public.job_progress_grants alter column created_at set default now();

alter table public.job_progress_grants alter column service_role set default 'homeowner'::text;

alter table public.job_progress_grants alter column access_kind set default 'homeowner'::text;

alter table public.job_progress_grants alter column id set default gen_random_uuid();

alter table public.safety_incidents alter column status set default 'open'::safety_incident_status;

alter table public.safety_incidents alter column alert_channels set default '{}'::text[];

alter table public.safety_incidents alter column signals set default '{}'::jsonb;

alter table public.safety_incidents alter column recommended_action set default 'monitor'::safety_recommended_action;

alter table public.safety_incidents alter column created_at set default now();

alter table public.safety_incidents alter column updated_at set default now();

alter table public.safety_incidents alter column id set default gen_random_uuid();

alter table public.wellness_session_state alter column alone_on_site set default true;

alter table public.wellness_session_state alter column last_motion_at set default now();

alter table public.wellness_session_state alter column id set default gen_random_uuid();

alter table public.wellness_session_state alter column last_heartbeat_at set default now();

alter table public.wellness_session_state alter column created_at set default now();

alter table public.wellness_session_state alter column updated_at set default now();

alter table public.wellness_session_state alter column recording_active set default true;

alter table public.daily_job_reports alter column channel set default 'email'::text;

alter table public.daily_job_reports alter column status set default 'pending'::daily_job_report_status;

alter table public.daily_job_reports alter column recipient_phones set default '{}'::text[];

alter table public.daily_job_reports alter column recipient_emails set default '{}'::text[];

alter table public.daily_job_reports alter column updated_at set default now();

alter table public.daily_job_reports alter column created_at set default now();

alter table public.daily_job_reports alter column clip_count set default 0;

alter table public.daily_job_reports alter column summary set default '{}'::jsonb;

alter table public.daily_job_reports alter column id set default gen_random_uuid();

alter table public.trade_playbooks alter column created_at set default now();

alter table public.trade_playbooks alter column step_count set default 0;

alter table public.trade_playbooks alter column skill_tags set default '{}'::text[];

alter table public.trade_playbooks alter column id set default gen_random_uuid();

alter table public.trade_playbooks alter column status set default 'draft'::text;

alter table public.trade_playbooks alter column source_kind set default 'manual'::text;

alter table public.trade_playbooks alter column updated_at set default now();

alter table public.trade_playbook_steps alter column id set default gen_random_uuid();

alter table public.trade_playbook_steps alter column metadata set default '{}'::jsonb;

alter table public.trade_playbook_sources alter column analysis_snapshot set default '{}'::jsonb;

alter table public.trade_playbook_sources alter column created_at set default now();

alter table public.trade_playbook_sources alter column id set default gen_random_uuid();

alter table public.ask_threads alter column title set default 'New chat'::text;

alter table public.ask_threads alter column updated_at set default now();

alter table public.ask_threads alter column summary_turn_count set default 0;

alter table public.ask_threads alter column id set default gen_random_uuid();

alter table public.ask_threads alter column created_at set default now();

alter table public.proof_live_sessions alter column extension set default 'webm'::text;

alter table public.proof_live_sessions alter column updated_at set default now();

alter table public.proof_live_sessions alter column created_at set default now();

alter table public.proof_live_sessions alter column last_part_at set default now();

alter table public.proof_live_sessions alter column started_at set default now();

alter table public.proof_live_sessions alter column last_mint_index set default 0;

alter table public.proof_live_sessions alter column status set default 'live'::text;

alter table public.proof_live_sessions alter column mime_type set default 'video/webm'::text;

alter table public.proof_live_sessions alter column id set default gen_random_uuid();

alter table public.recording_acknowledgments alter column created_at set default now();

alter table public.recording_acknowledgments alter column id set default gen_random_uuid();

alter table public.recording_acknowledgments alter column acknowledged_at set default now();

alter table public.crm_agent_credentials alter column status set default 'connected'::text;

alter table public.crm_agent_credentials alter column connected_at set default now();

alter table public.crm_agent_credentials alter column updated_at set default now();

alter table public.crm_agent_jobs alter column status set default 'queued'::text;

alter table public.crm_agent_jobs alter column created_at set default now();

alter table public.crm_agent_jobs alter column id set default gen_random_uuid();

alter table public.content_mentions alter column id set default gen_random_uuid();

alter table public.content_mentions alter column created_at set default now();

alter table public.ask_job_notes alter column created_at set default now();

alter table public.ask_job_notes alter column id set default gen_random_uuid();

alter table public.ask_transcript_chunks alter column created_at set default now();

alter table public.ask_transcript_chunks alter column id set default gen_random_uuid();

alter table public.voiceprints alter column updated_at set default now();

alter table public.voiceprints alter column id set default gen_random_uuid();

alter table public.voiceprints alter column cross_company_opt_in set default false;

alter table public.voiceprints alter column created_at set default now();

alter table public.voice_consent_events alter column id set default gen_random_uuid();

alter table public.voice_consent_events alter column created_at set default now();

alter table public.voice_enrollment_requests alter column id set default gen_random_uuid();

alter table public.voice_enrollment_requests alter column status set default 'pending'::text;

alter table public.voice_enrollment_requests alter column created_at set default now();

alter table public.speaker_identities alter column updated_at set default now();

alter table public.speaker_identities alter column id set default gen_random_uuid();

alter table public.speaker_identities alter column created_at set default now();

alter table public.speaker_role_guesses alter column status set default 'tentative'::text;

alter table public.speaker_role_guesses alter column id set default gen_random_uuid();

alter table public.speaker_role_guesses alter column updated_at set default now();

alter table public.speaker_role_guesses alter column created_at set default now();

alter table public.clip_room_segments alter column source set default 'analysis'::text;

alter table public.clip_room_segments alter column updated_at set default now();

alter table public.clip_room_segments alter column created_at set default now();

alter table public.clip_room_segments alter column speech set default '[]'::jsonb;

alter table public.clip_room_segments alter column findings set default '[]'::jsonb;

alter table public.clip_room_segments alter column user_corrected set default false;

alter table public.clip_room_segments alter column id set default gen_random_uuid();

alter table public.job_chat_documents alter column doc_kind set default 'other'::text;

alter table public.job_chat_documents alter column status set default 'ready'::text;

alter table public.job_chat_documents alter column relevance set default 'not_related'::text;

alter table public.job_chat_documents alter column key_facts set default '{}'::jsonb;

alter table public.job_chat_documents alter column chunk_index set default '[]'::jsonb;

alter table public.job_chat_documents alter column id set default gen_random_uuid();

alter table public.job_chat_documents alter column macros_ignored set default false;

alter table public.job_chat_documents alter column created_at set default now();

alter table public.ask_document_chunks alter column created_at set default now();

alter table public.ask_document_chunks alter column id set default gen_random_uuid();

alter table public.job_document_rooms alter column created_at set default now();

alter table public.job_document_rooms alter column id set default gen_random_uuid();

alter table public.ai_credit_ledger alter column created_at set default now();

alter table public.ai_credit_ledger alter column id set default gen_random_uuid();

alter table public.ai_usage_allocations alter column created_at set default now();

alter table public.ai_usage_allocations alter column id set default gen_random_uuid();

alter table public.ai_budget_price_spans alter column id set default gen_random_uuid();

alter table public.ai_budget_price_spans alter column created_at set default now();

alter table public.ai_credit_pack_clawbacks alter column amount_refunded_cents set default 0;

alter table public.ai_credit_pack_disputes alter column amount_cents set default 0;

alter table public.capture_upload_attempts alter column started_at set default now();

alter table public.capture_upload_attempts alter column last_attempt_at set default now();

alter table public.capture_upload_attempts alter column attempts set default 1;

alter table public.ask_turn_events alter column created_at set default now();

alter table public.ask_turn_events alter column surface set default 'job'::text;

alter table public.analytics_campaigns alter column id set default gen_random_uuid();

alter table public.analytics_campaigns alter column created_at set default now();

alter table public.analytics_campaigns alter column status set default 'draft'::text;

alter table public.analytics_campaigns alter column audience set default '{}'::jsonb;

alter table public.analytics_campaigns alter column body_markdown set default ''::text;

alter table public.analytics_campaigns alter column subject set default ''::text;

alter table public.analytics_campaigns alter column updated_at set default now();

alter table public.analytics_campaign_sends alter column id set default gen_random_uuid();

alter table public.analytics_campaign_sends alter column status set default 'queued'::text;

alter table public.analytics_campaign_sends alter column unsubscribe_token set default (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text));

alter table public.analytics_campaign_sends alter column created_at set default now();

alter table public.analytics_email_suppressions alter column created_at set default now();

alter table public.ai_credit_auto_recharge_settings alter column updated_at set default now();

alter table public.ai_credit_auto_recharge_settings alter column pack_code set default 'ai_10'::text;

alter table public.ai_credit_auto_recharge_settings alter column enabled set default false;

alter table public.ai_credit_auto_recharges alter column created_at set default now();

alter table public.ai_credit_auto_recharges alter column id set default gen_random_uuid();

alter table public.ai_credit_auto_recharges alter column currency set default 'usd'::text;

alter table public.ai_credit_auto_recharges alter column status set default 'pending'::text;

alter table public.computer_sessions alter column started_at set default now();

alter table public.computer_sessions alter column purpose set default 'task'::text;

alter table public.computer_sessions alter column created_at set default now();

alter table public.computer_sessions alter column status set default 'starting'::text;

alter table public.computer_sessions alter column id set default gen_random_uuid();

alter table public.computer_tasks alter column created_at set default now();

alter table public.computer_tasks alter column id set default gen_random_uuid();

alter table public.computer_tasks alter column job_projection set default '[]'::jsonb;

alter table public.computer_tasks alter column status set default 'queued'::text;

alter table public.computer_tasks alter column step_count set default 0;

alter table public.computer_tasks alter column updated_at set default now();

alter table public.computer_tasks alter column cost_nanos set default 0;

alter table public.computer_approvals alter column fields set default '[]'::jsonb;

alter table public.computer_approvals alter column requested_at set default now();

alter table public.computer_approvals alter column id set default gen_random_uuid();

alter table public.computer_approvals alter column status set default 'pending'::text;

alter table public.computer_audit_events alter column detail set default '{}'::jsonb;

alter table public.computer_audit_events alter column created_at set default now();

alter table public.computer_logins alter column updated_at set default now();

alter table public.computer_logins alter column cookie_domains set default '{}'::text[];

alter table public.computer_logins alter column id set default gen_random_uuid();

alter table public.computer_logins alter column created_at set default now();

alter table public.computer_login_credentials alter column created_at set default now();

alter table public.computer_login_credentials alter column updated_at set default now();

alter table public.computer_login_credentials alter column status set default 'ok'::text;

alter table public.ask_communication_styles alter column updated_at set default now();

alter table public.ask_communication_styles alter column traits set default '{}'::jsonb;

alter table public.ask_communication_styles alter column prompt_summary set default ''::text;

alter table public.ask_communication_styles alter column sample_count set default 0;

alter table public.ask_communication_styles alter column created_at set default now();

alter table public.ask_analysis_chunks alter column id set default gen_random_uuid();

alter table public.ask_analysis_chunks alter column created_at set default now();

alter table public.ask_route_decisions alter column created_at set default now();

alter table public.ask_route_decisions alter column id set default gen_random_uuid();

alter table public.ask_route_decisions alter column unsure set default false;

alter table public.ask_job_context_cache alter column index_meta set default '{}'::jsonb;

alter table public.ask_job_context_cache alter column summary_text set default ''::text;

alter table public.ask_job_context_cache alter column rebuilt_at set default now();

alter table public.ask_org_memory_facts alter column created_at set default now();

alter table public.ask_org_memory_facts alter column id set default gen_random_uuid();

alter table public.ask_org_memory_facts alter column restricted set default false;

alter table public.ask_org_memory_facts alter column source_job_ids set default '{}'::uuid[];

alter table public.ask_org_memory_facts alter column confidence set default 0.6;

alter table public.ask_org_memory_facts alter column updated_at set default now();

alter table public.computer_site_playbooks alter column edit_count set default 0;

alter table public.computer_site_playbooks alter column success_count set default 0;

alter table public.computer_site_playbooks alter column playbook set default '{}'::jsonb;

alter table public.computer_site_playbooks alter column id set default gen_random_uuid();

alter table public.computer_site_playbooks alter column failure_count set default 0;

alter table public.computer_site_playbooks alter column replay_success_count set default 0;

alter table public.computer_site_playbooks alter column source set default 'success'::text;

alter table public.computer_site_playbooks alter column status set default 'active'::text;

alter table public.computer_site_playbooks alter column steps set default '[]'::jsonb;

alter table public.computer_site_playbooks alter column version set default 1;

alter table public.computer_site_playbooks alter column updated_at set default now();

alter table public.computer_site_playbooks alter column created_at set default now();

alter table public.computer_site_playbooks alter column reject_count set default 0;

alter table public.computer_playbook_outcomes alter column id set default gen_random_uuid();

alter table public.computer_playbook_outcomes alter column created_at set default now();

alter table public.computer_supply_orders alter column updated_at set default now();

alter table public.computer_supply_orders alter column created_at set default now();

alter table public.computer_supply_orders alter column detail set default '{}'::jsonb;

alter table public.computer_supply_orders alter column low_confidence_count set default 0;

alter table public.computer_supply_orders alter column has_job_address set default false;

alter table public.computer_supply_orders alter column currency set default 'USD'::text;

alter table public.computer_supply_orders alter column line_count set default 0;

alter table public.computer_supply_orders alter column id set default gen_random_uuid();

alter table public.computer_practice_runs alter column steps set default '[]'::jsonb;

alter table public.computer_practice_runs alter column id set default gen_random_uuid();

alter table public.computer_practice_runs alter column status set default 'running'::text;

alter table public.computer_practice_runs alter column created_at set default now();

alter table public.computer_practice_runs alter column started_at set default now();

alter table public.computer_practice_runs alter column cost_nanos set default 0;

alter table public.computer_practice_runs alter column model_calls set default 0;

alter table public.computer_practice_runs alter column used_playbook set default false;

alter table public.computer_practice_screens alter column created_at set default now();

alter table public.computer_playbook_drafts alter column created_at set default now();

alter table public.computer_playbook_drafts alter column status set default 'pending'::text;

alter table public.computer_playbook_drafts alter column step_count set default 0;

alter table public.computer_playbook_drafts alter column steps set default '[]'::jsonb;

alter table public.computer_playbook_drafts alter column id set default gen_random_uuid();

alter table public.computer_route_decisions alter column created_at set default now();

alter table public.computer_route_decisions alter column id set default gen_random_uuid();

alter table public.ask_answer_feedback alter column id set default gen_random_uuid();

alter table public.ask_answer_feedback alter column created_at set default now();

alter table public.ask_answer_feedback alter column updated_at set default now();

alter table public.ask_pinned_answers alter column created_at set default now();

alter table public.ask_pinned_answers alter column id set default gen_random_uuid();

alter table public.ask_pending_actions alter column expires_at set default (now() + '24:00:00'::interval);

alter table public.ask_pending_actions alter column id set default gen_random_uuid();

alter table public.ask_pending_actions alter column payload set default '{}'::jsonb;

alter table public.ask_pending_actions alter column status set default 'pending'::text;

alter table public.ask_pending_actions alter column created_at set default now();

alter table public.demo_bookings alter column created_at set default now();

alter table public.demo_bookings alter column id set default gen_random_uuid();

alter table public.demo_bookings alter column status set default 'booked'::text;

create or replace view public.job_share_status with (security_invoker=true) as  SELECT p.org_id,
    p.job_id,
    p.id AS party_id,
    p.company,
    p.trade,
    p.role,
    p.invited_at,
    p.last_seen_at,
    p.revoked_at,
    b.revision AS current_revision,
    a.revision AS acknowledged_revision,
    ((a.revision IS NOT NULL) AND (a.revision = b.revision)) AS up_to_date,
    COALESCE(s.proposed, (0)::bigint) AS awaiting_answer,
    COALESCE(s.excluded, (0)::bigint) AS exclusions
   FROM (((job_parties p
     LEFT JOIN LATERAL ( SELECT max(job_briefs.revision) AS revision
           FROM job_briefs
          WHERE (job_briefs.job_id = p.job_id)) b ON (true))
     LEFT JOIN LATERAL ( SELECT max(job_acknowledgements.revision) AS revision
           FROM job_acknowledgements
          WHERE (job_acknowledgements.party_id = p.id)) a ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (job_scope_items.state = 'proposed'::job_scope_state)) AS proposed,
            count(*) FILTER (WHERE (job_scope_items.state = 'excluded'::job_scope_state)) AS excluded
           FROM job_scope_items
          WHERE ((job_scope_items.job_id = p.job_id) AND ((job_scope_items.party_id IS NULL) OR (job_scope_items.party_id = p.id)))) s ON (true));

create or replace view public.job_proof_days with (security_invoker=true) as  SELECT org_id,
    job_id,
    party_id,
    work_date,
    (array_agg(id) FILTER (WHERE (phase = 'before'::job_proof_phase)))[1] AS before_id,
    (array_agg(id) FILTER (WHERE (phase = 'after'::job_proof_phase)))[1] AS after_id,
    max(
        CASE
            WHEN (phase = 'before'::job_proof_phase) THEN captured_at
            ELSE NULL::timestamp with time zone
        END) AS before_at,
    max(
        CASE
            WHEN (phase = 'after'::job_proof_phase) THEN captured_at
            ELSE NULL::timestamp with time zone
        END) AS after_at,
    bool_and((state = 'accepted'::job_proof_state)) AS accepted,
    bool_or((state = 'rejected'::job_proof_state)) AS rejected,
    count(*) AS videos,
    max(ai_summary) FILTER (WHERE (phase = 'after'::job_proof_phase)) AS summary
   FROM job_proofs p
  WHERE (deleted_at IS NULL)
  GROUP BY org_id, job_id, party_id, work_date;

create or replace view public.job_evidence_items with (security_invoker=true) as  SELECT p.id,
    p.org_id,
    p.job_id,
    p.party_id,
    y.company AS party_company,
    y.trade AS party_trade,
    p.work_date,
    p.phase,
    p.category,
    COALESCE(p.title, ((initcap((p.phase)::text) || ' — '::text) || to_char((p.work_date)::timestamp with time zone, 'Mon DD'::text))) AS title,
    p.tags,
    p.duration_seconds,
    p.byte_size,
    p.captured_at,
    p.received_at,
    p.lat,
    p.lon,
    p.state,
    p.checks,
    p.ai_summary,
    p.legal_hold,
    p.retention_until,
    p.content_hash,
    ( SELECT count(*) AS count
           FROM job_evidence_access a
          WHERE ((a.proof_id = p.id) AND (a.action = ANY (ARRAY['viewed'::job_evidence_action, 'downloaded'::job_evidence_action])))) AS view_count,
    ( SELECT max(a.occurred_at) AS max
           FROM job_evidence_access a
          WHERE ((a.proof_id = p.id) AND (a.action = ANY (ARRAY['viewed'::job_evidence_action, 'downloaded'::job_evidence_action])))) AS last_viewed_at
   FROM (job_proofs p
     LEFT JOIN job_parties y ON ((y.id = p.party_id)))
  WHERE (p.deleted_at IS NULL);

create or replace view public.job_memory with (security_invoker=true) as  SELECT id AS job_id,
    org_id,
    job_number,
    title,
    (status)::text AS status,
    priority,
    (work_type)::text AS work_type,
    owner_id,
    claim_number,
    created_at,
    updated_at,
    ( SELECT count(*) AS count
           FROM job_tasks t
          WHERE (t.job_id = j.id)) AS task_count,
    ( SELECT count(*) AS count
           FROM job_tasks t
          WHERE ((t.job_id = j.id) AND (t.status = 'done'::text))) AS tasks_done,
    ( SELECT count(*) AS count
           FROM job_assignments a
          WHERE ((a.job_id = j.id) AND (a.released_at IS NULL))) AS crew_size,
    ( SELECT COALESCE(sum(w.minutes), (0)::bigint) AS "coalesce"
           FROM work_logs w
          WHERE (w.job_id = j.id)) AS minutes_logged,
    ( SELECT count(*) AS count
           FROM memory_events e
          WHERE (e.job_id = j.id)) AS event_count,
    ( SELECT max(e.occurred_at) AS max
           FROM memory_events e
          WHERE (e.job_id = j.id)) AS last_event_at,
    ( SELECT e.summary
           FROM memory_events e
          WHERE (e.job_id = j.id)
          ORDER BY e.seq DESC
         LIMIT 1) AS last_event
   FROM crm_jobs j
  WHERE (deleted_at IS NULL);

create or replace view public.agent_memory with (security_invoker=true) as  SELECT m.org_id,
    m.user_id,
    p.email,
    p.full_name,
    (m.role)::text AS role,
    (m.work_type)::text AS work_type,
    ( SELECT count(*) AS count
           FROM memory_events e
          WHERE ((e.org_id = m.org_id) AND (e.actor_id = m.user_id))) AS event_count,
    ( SELECT count(DISTINCT e.job_id) AS count
           FROM memory_events e
          WHERE ((e.org_id = m.org_id) AND (e.actor_id = m.user_id) AND (e.job_id IS NOT NULL))) AS jobs_touched,
    ( SELECT count(*) AS count
           FROM job_tasks t
          WHERE ((t.org_id = m.org_id) AND (t.assigned_to = m.user_id) AND (t.status <> 'done'::text))) AS open_tasks,
    ( SELECT count(*) AS count
           FROM job_tasks t
          WHERE (t.completed_by = m.user_id)) AS tasks_completed,
    ( SELECT COALESCE(sum(w.minutes), (0)::bigint) AS "coalesce"
           FROM work_logs w
          WHERE ((w.org_id = m.org_id) AND (w.author_id = m.user_id))) AS minutes_logged,
    ( SELECT max(e.occurred_at) AS max
           FROM memory_events e
          WHERE ((e.org_id = m.org_id) AND (e.actor_id = m.user_id))) AS last_active_at
   FROM (org_members m
     LEFT JOIN profiles p ON ((p.id = m.user_id)));

create or replace view public.usage_events with (security_invoker=true) as  SELECT id,
    org_id,
    user_id,
    created_at,
    price_nanos,
    cost_nanos,
    (feature)::text AS feature
   FROM token_usage_events;

create or replace view private.payments_net as  WITH refunds AS (
         SELECT DISTINCT ON (r.stripe_charge_id) r.id,
            r.org_id,
            r.created_at,
            r.amount_cents,
            r.stripe_charge_id,
            r.livemode
           FROM payments r
          WHERE ((r.kind = 'refund'::text) AND (r.status = 'refunded'::text))
          ORDER BY r.stripe_charge_id, r.amount_cents, r.created_at DESC
        )
 SELECT p.id,
    p.org_id,
    p.created_at,
    p.kind,
    ((p.amount_cents - COALESCE(p.tax_cents, 0)))::bigint AS net_cents,
    (COALESCE(p.tax_cents, 0))::bigint AS tax_cents
   FROM payments p
  WHERE ((p.status = 'succeeded'::text) AND (p.kind = ANY (ARRAY['subscription'::text, 'usage'::text, 'credits'::text])) AND (p.livemode IS DISTINCT FROM false))
UNION ALL
 SELECT r.id,
    r.org_id,
    r.created_at,
    'refund'::text AS kind,
    (round(((r.amount_cents)::numeric * ((1)::numeric - COALESCE(( SELECT ((o.tax_cents)::numeric / (NULLIF(o.amount_cents, 0))::numeric)
           FROM payments o
          WHERE ((o.stripe_charge_id = regexp_replace(r.stripe_charge_id, '_refund$'::text, ''::text)) AND (o.status = 'succeeded'::text))
         LIMIT 1), (0)::numeric)))))::bigint AS net_cents,
    (0)::bigint AS tax_cents
   FROM refunds r
  WHERE (r.livemode IS DISTINCT FROM false);

alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);

alter table public.orgs add constraint orgs_pkey PRIMARY KEY (id);

alter table public.orgs add constraint orgs_join_code_key UNIQUE (join_code);

alter table public.org_members add constraint org_members_pkey PRIMARY KEY (id);

alter table public.org_members add constraint org_members_org_id_user_id_key UNIQUE (org_id, user_id);

alter table public.device_credentials add constraint device_credentials_pkey PRIMARY KEY (id);

alter table private.model_costs add constraint model_costs_input_cost_per_mtok_check CHECK ((input_cost_per_mtok >= (0)::numeric));

alter table private.model_costs add constraint model_costs_output_cost_per_mtok_check CHECK ((output_cost_per_mtok >= (0)::numeric));

alter table private.model_costs add constraint model_costs_markup_check CHECK ((markup >= (1)::numeric));

alter table private.model_costs add constraint model_costs_pkey PRIMARY KEY (model_id);

alter table public.billing_plans add constraint billing_plans_monthly_price_cents_check CHECK ((monthly_price_cents >= 0));

alter table public.billing_plans add constraint billing_plans_annual_price_cents_check CHECK ((annual_price_cents >= 0));

alter table public.billing_plans add constraint billing_plans_included_credits_nanos_check CHECK ((included_credits_nanos >= 0));

alter table public.billing_plans add constraint billing_plans_min_seats_check CHECK ((min_seats >= 1));

alter table public.billing_plans add constraint billing_plans_pkey PRIMARY KEY (code);

alter table public.org_billing add constraint org_billing_seats_check CHECK ((seats >= 1));

alter table public.org_billing add constraint org_billing_monthly_spend_limit_nanos_check CHECK ((monthly_spend_limit_nanos >= 0));

alter table public.org_billing add constraint org_billing_pkey PRIMARY KEY (org_id);

alter table public.payments add constraint payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text])));

alter table public.payments add constraint payments_pkey PRIMARY KEY (id);

alter table private.stripe_events add constraint stripe_events_pkey PRIMARY KEY (id);

alter table public.analytics_staff add constraint analytics_staff_pkey PRIMARY KEY (user_id);

alter table public.feature_catalog add constraint feature_catalog_key_check CHECK ((key ~ '^[a-z][a-z0-9_]{1,48}$'::text));

alter table public.feature_catalog add constraint feature_catalog_pkey PRIMARY KEY (key);

alter table public.feature_usage_sessions add constraint feature_usage_sessions_client_check CHECK ((client = ANY (ARRAY['web'::text, 'mobile'::text, 'desktop'::text, 'api'::text])));

alter table public.feature_usage_sessions add constraint feature_usage_sessions_active_ms_check CHECK (((active_ms >= 0) AND (active_ms <= 86400000)));

alter table public.feature_usage_sessions add constraint feature_usage_sessions_interactions_check CHECK ((interactions >= 0));

alter table public.feature_usage_sessions add constraint feature_usage_sessions_pkey PRIMARY KEY (id);

alter table public.feature_usage_daily add constraint feature_usage_daily_pkey PRIMARY KEY (day, org_id, feature_key);

alter table public.org_billing_events add constraint org_billing_events_pkey PRIMARY KEY (id);

alter table public.jobs add constraint jobs_name_check CHECK (((length(btrim(name)) >= 2) AND (length(btrim(name)) <= 160)));

alter table public.jobs add constraint jobs_work_type_check CHECK ((work_type = ANY (ARRAY['mitigation'::text, 'construction'::text])));

alter table public.jobs add constraint jobs_loss_type_check CHECK ((loss_type = ANY (ARRAY['water'::text, 'fire'::text, 'mold'::text, 'storm'::text, 'biohazard'::text, 'other'::text])));

alter table public.jobs add constraint jobs_status_check CHECK ((status = ANY (ARRAY['lead'::text, 'scheduled'::text, 'in_progress'::text, 'on_hold'::text, 'complete'::text, 'invoiced'::text, 'closed'::text, 'cancelled'::text])));

alter table public.jobs add constraint jobs_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));

alter table public.jobs add constraint jobs_pkey PRIMARY KEY (id);

alter table public.jobs add constraint jobs_seq_no_unique UNIQUE (org_id, seq_no);

alter table public.jobs add constraint jobs_number_unique UNIQUE (org_id, job_number);

alter table public.job_tasks add constraint job_tasks_title_check CHECK (((length(btrim(title)) >= 2) AND (length(btrim(title)) <= 200)));

alter table public.job_tasks add constraint job_tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'cancelled'::text])));

alter table public.job_tasks add constraint job_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));

alter table public.job_tasks add constraint job_tasks_pkey PRIMARY KEY (id);

alter table public.job_assignments add constraint job_assignments_role_on_job_check CHECK ((role_on_job = ANY (ARRAY['lead'::text, 'crew'::text, 'estimator'::text, 'supervisor'::text, 'observer'::text])));

alter table public.job_assignments add constraint job_assignments_pkey PRIMARY KEY (id);

alter table public.work_logs add constraint work_logs_kind_check CHECK ((kind = ANY (ARRAY['work'::text, 'note'::text, 'call'::text, 'site_visit'::text, 'photo'::text, 'material'::text, 'issue'::text])));

alter table public.work_logs add constraint work_logs_body_check CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 8000)));

alter table public.work_logs add constraint work_logs_minutes_check CHECK (((minutes >= 0) AND (minutes <= (24 * 60))));

alter table public.work_logs add constraint work_logs_pkey PRIMARY KEY (id);

alter table public.memory_events add constraint memory_events_source_check CHECK ((source = ANY (ARRAY['trigger'::text, 'app'::text])));

alter table public.memory_events add constraint memory_events_pkey PRIMARY KEY (id);

alter table public.orgs add constraint orgs_contractor_type_check CHECK (((contractor_type IS NULL) OR (contractor_type = ANY (ARRAY['restoration'::text, 'roofing'::text, 'general_contractor'::text, 'other'::text]))));

alter table public.schema_migrations add constraint schema_migrations_pkey PRIMARY KEY (name);

alter table public.org_members add constraint org_members_usage_intents_check CHECK ((usage_intents <@ ARRAY['mitigation_estimating'::text, 'construction_estimating'::text, 'project_management'::text, 'crm'::text, 'web_access'::text, 'field_work'::text, 'billing'::text, 'financial'::text, 'exploring'::text]));

alter table public.media_objects add constraint media_objects_duration_seconds_check CHECK (((duration_seconds IS NULL) OR ((duration_seconds > (0)::numeric) AND (duration_seconds <= (86400)::numeric))));

alter table public.media_objects add constraint media_objects_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0)));

alter table public.media_objects add constraint media_objects_pkey PRIMARY KEY (id);

alter table public.media_objects add constraint media_objects_backend_bucket_object_key_key UNIQUE (backend, bucket, object_key);

alter table public.org_media_quotas add constraint org_media_quotas_max_hot_bytes_check CHECK (((max_hot_bytes IS NULL) OR (max_hot_bytes > 0)));

alter table public.org_media_quotas add constraint org_media_quotas_max_total_bytes_check CHECK (((max_total_bytes IS NULL) OR (max_total_bytes > 0)));

alter table public.org_media_quotas add constraint org_media_quotas_max_ingest_seconds_per_day_check CHECK (((max_ingest_seconds_per_day IS NULL) OR (max_ingest_seconds_per_day > 0)));

alter table public.org_media_quotas add constraint org_media_quotas_max_object_bytes_check CHECK (((max_object_bytes IS NULL) OR (max_object_bytes > 0)));

alter table public.org_media_quotas add constraint org_media_quotas_pkey PRIMARY KEY (org_id);

alter table public.media_upload_sessions add constraint media_upload_sessions_pkey PRIMARY KEY (id);

alter table public.crm_counters add constraint crm_counters_pkey PRIMARY KEY (id);

alter table public.crm_counters add constraint crm_counters_org_name_unique UNIQUE (org_id, name);

alter table public.crm_properties add constraint crm_properties_address_line1_check CHECK (((length(btrim(address_line1)) >= 1) AND (length(btrim(address_line1)) <= 200)));

alter table public.crm_properties add constraint crm_properties_year_built_check CHECK (((year_built IS NULL) OR ((year_built >= 1600) AND (year_built <= 2200))));

alter table public.crm_properties add constraint crm_properties_square_feet_check CHECK (((square_feet IS NULL) OR (square_feet >= 0)));

alter table public.crm_properties add constraint crm_properties_pkey PRIMARY KEY (id);

alter table public.crm_jobs add constraint crm_jobs_priority_check CHECK (((priority >= 1) AND (priority <= 5)));

alter table public.crm_jobs add constraint crm_jobs_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 200)));

alter table public.crm_jobs add constraint crm_jobs_deductible_check CHECK (((deductible IS NULL) OR (deductible >= (0)::numeric)));

alter table public.crm_jobs add constraint crm_jobs_contract_amount_check CHECK (((contract_amount IS NULL) OR (contract_amount >= (0)::numeric)));

alter table public.crm_jobs add constraint crm_jobs_invoiced_amount_check CHECK ((invoiced_amount >= (0)::numeric));

alter table public.crm_jobs add constraint crm_jobs_paid_amount_check CHECK ((paid_amount >= (0)::numeric));

alter table public.crm_jobs add constraint crm_jobs_schedule_ordered CHECK (((scheduled_start IS NULL) OR (scheduled_end IS NULL) OR (scheduled_end >= scheduled_start)));

alter table public.crm_jobs add constraint crm_jobs_actuals_ordered CHECK (((actual_start IS NULL) OR (actual_end IS NULL) OR (actual_end >= actual_start)));

alter table public.crm_jobs add constraint crm_jobs_pkey PRIMARY KEY (id);

alter table public.crm_jobs add constraint crm_jobs_number_unique_per_org UNIQUE (org_id, job_number);

alter table public.job_parties add constraint job_parties_company_check CHECK (((length(btrim(company)) >= 1) AND (length(btrim(company)) <= 160)));

alter table public.job_parties add constraint job_parties_trade_check CHECK (((trade IS NULL) OR (length(trade) <= 60)));

alter table public.job_parties add constraint job_parties_role_check CHECK ((role = ANY (ARRAY['general_contractor'::text, 'subcontractor'::text, 'owner'::text, 'adjuster'::text])));

alter table public.job_parties add constraint job_parties_pkey PRIMARY KEY (id);

alter table public.job_briefs add constraint job_briefs_note_check CHECK (((note IS NULL) OR (length(note) <= 2000)));

alter table public.job_briefs add constraint job_briefs_pkey PRIMARY KEY (id);

alter table public.job_briefs add constraint job_briefs_revision_unique UNIQUE (job_id, revision);

alter table public.job_scope_items add constraint job_scope_items_title_check CHECK (((length(btrim(title)) >= 2) AND (length(btrim(title)) <= 200)));

alter table public.job_scope_items add constraint job_scope_items_detail_check CHECK (((detail IS NULL) OR (length(detail) <= 4000)));

alter table public.job_scope_items add constraint job_scope_items_amount_check CHECK (((amount IS NULL) OR (amount >= (0)::numeric)));

alter table public.job_scope_items add constraint job_scope_items_reason_check CHECK (((reason IS NULL) OR (length(reason) <= 1000)));

alter table public.job_scope_items add constraint job_scope_decided_together CHECK (((state = ANY (ARRAY['approved'::job_scope_state, 'declined'::job_scope_state])) = (decided_at IS NOT NULL)));

alter table public.job_scope_items add constraint job_scope_approved_has_amount CHECK (((state <> 'approved'::job_scope_state) OR (amount IS NOT NULL)));

alter table public.job_scope_items add constraint job_scope_items_pkey PRIMARY KEY (id);

alter table public.job_acknowledgements add constraint job_acknowledgements_pkey PRIMARY KEY (id);

alter table public.job_acknowledgements add constraint job_ack_once UNIQUE (party_id, revision);

alter table public.job_messages add constraint job_messages_author_label_check CHECK (((length(btrim(author_label)) >= 1) AND (length(btrim(author_label)) <= 160)));

alter table public.job_messages add constraint job_messages_body_check CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 4000)));

alter table public.job_messages add constraint job_messages_pkey PRIMARY KEY (id);

alter table public.job_proofs add constraint job_proofs_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0)));

alter table public.job_proofs add constraint job_proofs_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= (0)::numeric)));

alter table public.job_proofs add constraint job_proofs_lat_check CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision))));

alter table public.job_proofs add constraint job_proofs_lon_check CHECK (((lon IS NULL) OR ((lon >= ('-180'::integer)::double precision) AND (lon <= (180)::double precision))));

alter table public.job_proofs add constraint job_proofs_accuracy_m_check CHECK (((accuracy_m IS NULL) OR (accuracy_m >= (0)::double precision)));

alter table public.job_proofs add constraint job_proofs_decided_note_check CHECK (((decided_note IS NULL) OR (length(decided_note) <= 1000)));

alter table public.job_proofs add constraint job_proofs_decided_together CHECK (((state = ANY (ARRAY['accepted'::job_proof_state, 'rejected'::job_proof_state])) = (decided_at IS NOT NULL)));

alter table public.job_proofs add constraint job_proofs_pkey PRIMARY KEY (id);

alter table public.job_proof_frames add constraint job_proof_frames_at_seconds_check CHECK ((at_seconds >= (0)::numeric));

alter table public.job_proof_frames add constraint job_proof_frames_pkey PRIMARY KEY (id);

alter table public.job_proof_frames add constraint job_proof_frames_once UNIQUE (proof_id, at_seconds);

alter table public.job_proof_questions add constraint job_proof_questions_question_check CHECK (((length(btrim(question)) >= 3) AND (length(btrim(question)) <= 1000)));

alter table public.job_proof_questions add constraint job_proof_questions_pkey PRIMARY KEY (id);

alter table public.job_evidence_access add constraint job_evidence_access_detail_check CHECK (((detail IS NULL) OR (length(detail) <= 500)));

alter table public.job_evidence_access add constraint job_evidence_access_pkey PRIMARY KEY (id);

alter table public.job_evidence_policy add constraint job_evidence_policy_pkey PRIMARY KEY (org_id);

alter table public.job_proofs add constraint job_proofs_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'skipped'::text, 'failed'::text])));

alter table public.job_proofs add constraint job_proofs_ai_material_change_check CHECK ((ai_material_change = ANY (ARRAY['significant'::text, 'minor'::text, 'none'::text, 'unclear'::text])));

alter table public.verifier_shares add constraint verifier_shares_label_check CHECK (((length(btrim(label)) >= 2) AND (length(btrim(label)) <= 200)));

alter table public.verifier_shares add constraint verifier_shares_pkey PRIMARY KEY (id);

alter table public.verifier_shares add constraint verifier_shares_access_token_key UNIQUE (access_token);

alter table public.job_proofs add constraint job_proofs_narration_status_check CHECK (((narration_status IS NULL) OR (narration_status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'skipped'::text, 'failed'::text]))));

alter table public.field_identities add constraint field_identities_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])));

alter table public.field_identities add constraint field_identities_address_check CHECK (((length(btrim(address)) >= 3) AND (length(btrim(address)) <= 254)));

alter table public.field_identities add constraint field_identities_pkey PRIMARY KEY (id);

alter table public.field_identities add constraint field_identities_channel_address_unique UNIQUE (channel, address);

alter table public.field_identity_codes add constraint field_identity_codes_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])));

alter table public.field_identity_codes add constraint field_identity_codes_code_hash_check CHECK ((length(code_hash) = 64));

alter table public.field_identity_codes add constraint field_identity_codes_attempts_check CHECK ((attempts >= 0));

alter table public.field_identity_codes add constraint field_identity_codes_pkey PRIMARY KEY (id);

alter table public.job_party_claims add constraint job_party_claims_pkey PRIMARY KEY (id);

alter table public.job_party_claims add constraint job_party_claims_one_per_party UNIQUE (party_id);

alter table public.field_sessions add constraint field_sessions_token_hash_check CHECK ((length(token_hash) = 64));

alter table public.field_sessions add constraint field_sessions_pkey PRIMARY KEY (id);

alter table public.field_sessions add constraint field_sessions_token_unique UNIQUE (token_hash);

alter table public.job_intake add constraint job_intake_source_check CHECK ((source = ANY (ARRAY['crm_sync'::text, 'scope_document'::text, 'manual'::text])));

alter table public.job_intake add constraint job_intake_pkey PRIMARY KEY (job_id);

alter table public.scope_documents add constraint scope_documents_filename_check CHECK (((length(btrim(filename)) >= 1) AND (length(btrim(filename)) <= 200)));

alter table public.scope_documents add constraint scope_documents_media_type_check CHECK ((media_type = ANY (ARRAY['application/pdf'::text, 'text/plain'::text])));

alter table public.scope_documents add constraint scope_documents_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size >= 0)));

alter table public.scope_documents add constraint scope_documents_confirmed_pair CHECK (((status = 'confirmed'::text) = ((confirmed_by IS NOT NULL) AND (confirmed_at IS NOT NULL))));

alter table public.scope_documents add constraint scope_documents_pkey PRIMARY KEY (id);

alter table public.job_proof_segments add constraint job_proof_segments_idx_check CHECK ((idx >= 0));

alter table public.job_proof_segments add constraint job_proof_segments_start_seconds_check CHECK ((start_seconds >= (0)::numeric));

alter table public.job_proof_segments add constraint job_proof_segments_check CHECK ((end_seconds >= start_seconds));

alter table public.job_proof_segments add constraint job_proof_segments_frame_count_check CHECK ((frame_count >= 0));

alter table public.job_proof_segments add constraint job_proof_segments_pkey PRIMARY KEY (id);

alter table public.job_proof_segments add constraint job_proof_segments_one_window UNIQUE (proof_id, idx);

alter table public.verifier_shares add constraint verifier_shares_recipient_email_check CHECK (((recipient_email IS NULL) OR (POSITION(('@'::text) IN (recipient_email)) > 1)));

alter table public.evidence_download_policy add constraint evidence_download_policy_download_fee_cents_check CHECK (((download_fee_cents >= 0) AND (download_fee_cents <= 100000)));

alter table public.evidence_download_policy add constraint evidence_download_policy_pkey PRIMARY KEY (org_id);

alter table public.evidence_downloads add constraint evidence_downloads_fee_cents_check CHECK ((fee_cents >= 0));

alter table public.evidence_downloads add constraint evidence_downloads_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'waived'::text])));

alter table public.evidence_downloads add constraint evidence_download_paid_is_stamped CHECK (((status = 'pending_payment'::text) OR ((paid_at IS NOT NULL) AND (paid_via IS NOT NULL))));

alter table public.evidence_downloads add constraint evidence_downloads_pkey PRIMARY KEY (id);

alter table public.org_invites add constraint org_invites_email_check CHECK ((POSITION(('@'::text) IN (email)) > 1));

alter table public.org_invites add constraint org_invites_note_check CHECK (((note IS NULL) OR (length(note) <= 500)));

alter table public.org_invites add constraint org_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'joined'::text, 'revoked'::text])));

alter table public.org_invites add constraint org_invites_pkey PRIMARY KEY (id);

alter table private.ai_model_pricing add constraint ai_model_pricing_input_token_price_usd_check CHECK ((input_token_price_usd >= (0)::numeric));

alter table private.ai_model_pricing add constraint ai_model_pricing_output_token_price_usd_check CHECK ((output_token_price_usd >= (0)::numeric));

alter table private.ai_model_pricing add constraint ai_model_pricing_window CHECK (((effective_to IS NULL) OR (effective_to > effective_from)));

alter table private.ai_model_pricing add constraint ai_model_pricing_pkey PRIMARY KEY (id);

alter table private.compute_unit_config add constraint compute_unit_config_usd_per_compute_unit_check CHECK ((usd_per_compute_unit > (0)::numeric));

alter table private.compute_unit_config add constraint compute_unit_config_window CHECK (((effective_to IS NULL) OR (effective_to > effective_from)));

alter table private.compute_unit_config add constraint compute_unit_config_pkey PRIMARY KEY (id);

alter table private.ai_usage_events add constraint ai_usage_events_input_tokens_check CHECK ((input_tokens >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_output_tokens_check CHECK ((output_tokens >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_cached_input_tokens_check CHECK ((cached_input_tokens >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_reasoning_tokens_check CHECK ((reasoning_tokens >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_image_count_check CHECK ((image_count >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_video_seconds_check CHECK ((video_seconds >= (0)::numeric));

alter table private.ai_usage_events add constraint ai_usage_events_audio_seconds_check CHECK ((audio_seconds >= (0)::numeric));

alter table private.ai_usage_events add constraint ai_usage_events_ocr_pages_check CHECK ((ocr_pages >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_embedding_tokens_check CHECK ((embedding_tokens >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_third_party_cost_nanos_check CHECK ((third_party_cost_nanos >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_other_variable_cost_nanos_check CHECK ((other_variable_cost_nanos >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_estimated_provider_cost_nanos_check CHECK ((estimated_provider_cost_nanos >= 0));

alter table private.ai_usage_events add constraint ai_usage_events_compute_units_check CHECK ((compute_units >= (0)::numeric));

alter table private.ai_usage_events add constraint ai_usage_events_pkey PRIMARY KEY (id);

alter table private.ai_usage_events add constraint ai_usage_events_idempotency UNIQUE (org_id, idempotency_key);

alter table public.qualifying_workflow_types add constraint qualifying_workflow_types_pkey PRIMARY KEY (code);

alter table public.metering_plans add constraint metering_plans_pkey PRIMARY KEY (id);

alter table public.metering_plans add constraint metering_plans_code_key UNIQUE (code);

alter table public.metering_plan_versions add constraint metering_plan_versions_version_check CHECK ((version > 0));

alter table public.metering_plan_versions add constraint metering_plan_versions_base_monthly_fee_cents_check CHECK ((base_monthly_fee_cents >= 0));

alter table public.metering_plan_versions add constraint metering_plan_versions_included_jobs_check CHECK ((included_jobs >= 0));

alter table public.metering_plan_versions add constraint metering_plan_versions_additional_job_price_cents_check CHECK ((additional_job_price_cents >= 0));

alter table public.metering_plan_versions add constraint metering_plan_versions_included_compute_units_check CHECK ((included_compute_units >= (0)::numeric));

alter table public.metering_plan_versions add constraint metering_plan_versions_compute_unit_overage_nanos_check CHECK ((compute_unit_overage_nanos >= 0));

alter table public.metering_plan_versions add constraint metering_plan_versions_video_hour_price_cents_check CHECK (((video_hour_price_cents IS NULL) OR (video_hour_price_cents >= 0)));

alter table public.metering_plan_versions add constraint metering_plan_versions_billing_period_days_check CHECK (((billing_period_days >= 1) AND (billing_period_days <= 366)));

alter table public.metering_plan_versions add constraint metering_plan_versions_window CHECK (((effective_to IS NULL) OR (effective_to > effective_from)));

alter table public.metering_plan_versions add constraint metering_plan_versions_pkey PRIMARY KEY (id);

alter table public.metering_plan_versions add constraint metering_plan_versions_plan_id_version_key UNIQUE (plan_id, version);

alter table public.org_metering add constraint org_metering_override_base_monthly_fee_cents_check CHECK (((override_base_monthly_fee_cents IS NULL) OR (override_base_monthly_fee_cents >= 0)));

alter table public.org_metering add constraint org_metering_override_included_jobs_check CHECK (((override_included_jobs IS NULL) OR (override_included_jobs >= 0)));

alter table public.org_metering add constraint org_metering_override_additional_job_price_cents_check CHECK (((override_additional_job_price_cents IS NULL) OR (override_additional_job_price_cents >= 0)));

alter table public.org_metering add constraint org_metering_override_included_compute_units_check CHECK (((override_included_compute_units IS NULL) OR (override_included_compute_units >= (0)::numeric)));

alter table public.org_metering add constraint org_metering_override_compute_unit_overage_nanos_check CHECK (((override_compute_unit_overage_nanos IS NULL) OR (override_compute_unit_overage_nanos >= 0)));

alter table public.org_metering add constraint org_metering_override_video_hour_price_cents_check CHECK (((override_video_hour_price_cents IS NULL) OR (override_video_hour_price_cents >= 0)));

alter table public.org_metering add constraint org_metering_period_anchor_day_check CHECK (((period_anchor_day >= 1) AND (period_anchor_day <= 28)));

alter table public.org_metering add constraint org_metering_usage_limit_jobs_check CHECK (((usage_limit_jobs IS NULL) OR (usage_limit_jobs > 0)));

alter table public.org_metering add constraint org_metering_usage_limit_compute_units_check CHECK (((usage_limit_compute_units IS NULL) OR (usage_limit_compute_units > (0)::numeric)));

alter table public.org_metering add constraint org_metering_alert_threshold_pct_check CHECK (((alert_threshold_pct >= (0)::numeric) AND (alert_threshold_pct <= (100)::numeric)));

alter table public.org_metering add constraint org_metering_margin_alert_pct_check CHECK (((margin_alert_pct IS NULL) OR ((margin_alert_pct >= (0)::numeric) AND (margin_alert_pct <= (100)::numeric))));

alter table public.org_metering add constraint org_metering_pkey PRIMARY KEY (org_id);

alter table public.billing_period_jobs add constraint billing_period_jobs_pkey PRIMARY KEY (org_id, period_start, job_id);

alter table public.billing_period_jobs add constraint billing_period_jobs_idempotency UNIQUE (org_id, idempotency_key);

alter table public.billing_period_statements add constraint billing_period_statements_pkey PRIMARY KEY (id);

alter table public.billing_period_statements add constraint billing_period_statements_org_id_period_start_key UNIQUE (org_id, period_start);

alter table public.metering_alerts add constraint metering_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));

alter table public.metering_alerts add constraint metering_alerts_pkey PRIMARY KEY (id);

alter table public.job_locations add constraint job_locations_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)));

alter table public.job_locations add constraint job_locations_detail_check CHECK (((detail IS NULL) OR (length(detail) <= 200)));

alter table public.job_locations add constraint job_locations_model_source_check CHECK (((model_source IS NULL) OR (length(model_source) <= 40)));

alter table public.job_locations add constraint job_locations_pkey PRIMARY KEY (id);

alter table public.verification_videos add constraint verification_videos_file_name_check CHECK (((length(btrim(file_name)) >= 1) AND (length(btrim(file_name)) <= 260)));

alter table public.verification_videos add constraint verification_videos_file_size_check CHECK (((file_size IS NULL) OR (file_size > 0)));

alter table public.verification_videos add constraint verification_videos_mime_type_check CHECK ((mime_type = ANY (ARRAY['video/mp4'::text, 'video/quicktime'::text, 'video/webm'::text, 'video/x-msvideo'::text])));

alter table public.verification_videos add constraint verification_videos_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= (0)::numeric)));

alter table public.verification_videos add constraint verification_videos_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))));

alter table public.verification_videos add constraint verification_videos_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))));

alter table public.verification_videos add constraint verification_videos_pkey PRIMARY KEY (id);

alter table public.verification_videos add constraint verification_videos_proof_unique UNIQUE (proof_id);

alter table public.video_processing_jobs add constraint video_processing_jobs_attempt_count_check CHECK ((attempt_count >= 0));

alter table public.video_processing_jobs add constraint video_processing_jobs_max_attempts_check CHECK ((max_attempts >= 1));

alter table public.video_processing_jobs add constraint video_processing_jobs_pkey PRIMARY KEY (id);

alter table public.video_processing_jobs add constraint video_processing_jobs_idempotent UNIQUE (org_id, idempotency_key);

alter table public.video_processing_steps add constraint video_processing_steps_attempt_count_check CHECK ((attempt_count >= 0));

alter table public.video_processing_steps add constraint video_processing_steps_pkey PRIMARY KEY (id);

alter table public.video_processing_steps add constraint video_processing_steps_once UNIQUE (processing_job_id, stage);

alter table public.verification_scenes add constraint verification_scenes_sequence_index_check CHECK ((sequence_index >= 0));

alter table public.verification_scenes add constraint verification_scenes_room_type_check CHECK (((length(btrim(room_type)) >= 1) AND (length(btrim(room_type)) <= 80)));

alter table public.verification_scenes add constraint verification_scenes_label_check CHECK (((label IS NULL) OR (length(label) <= 120)));

alter table public.verification_scenes add constraint verification_scenes_start_seconds_check CHECK ((start_seconds >= (0)::numeric));

alter table public.verification_scenes add constraint verification_scenes_check CHECK ((end_seconds >= start_seconds));

alter table public.verification_scenes add constraint verification_scenes_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));

alter table public.verification_scenes add constraint verification_scenes_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'user'::text, 'floor_plan'::text, 'gps'::text, 'mixed'::text])));

alter table public.verification_scenes add constraint verification_scenes_pkey PRIMARY KEY (id);

alter table public.verification_scenes add constraint verification_scenes_seq UNIQUE (video_id, sequence_index);

alter table public.verification_frames add constraint verification_frames_timestamp_seconds_check CHECK ((timestamp_seconds >= (0)::numeric));

alter table public.verification_frames add constraint verification_frames_sequence_number_check CHECK ((sequence_number >= 0));

alter table public.verification_frames add constraint verification_frames_width_check CHECK (((width IS NULL) OR (width > 0)));

alter table public.verification_frames add constraint verification_frames_height_check CHECK (((height IS NULL) OR (height > 0)));

alter table public.verification_frames add constraint verification_frames_quality_score_check CHECK (((quality_score IS NULL) OR ((quality_score >= (0)::numeric) AND (quality_score <= (1)::numeric))));

alter table public.verification_frames add constraint verification_frames_blur_score_check CHECK (((blur_score IS NULL) OR ((blur_score >= (0)::numeric) AND (blur_score <= (1)::numeric))));

alter table public.verification_frames add constraint verification_frames_brightness_score_check CHECK (((brightness_score IS NULL) OR ((brightness_score >= (0)::numeric) AND (brightness_score <= (1)::numeric))));

alter table public.verification_frames add constraint verification_frames_motion_score_check CHECK (((motion_score IS NULL) OR ((motion_score >= (0)::numeric) AND (motion_score <= (1)::numeric))));

alter table public.verification_frames add constraint verification_frames_pkey PRIMARY KEY (id);

alter table public.verification_frames add constraint verification_frames_seq UNIQUE (video_id, sequence_number);

alter table public.verification_frames add constraint verification_frames_ts UNIQUE (video_id, timestamp_seconds);

alter table public.ai_analysis_runs add constraint ai_analysis_runs_purpose_check CHECK ((purpose = ANY (ARRAY['frame_analysis'::text, 'sequence_analysis'::text, 'comparison'::text, 'escalation'::text, 'cache_hit'::text])));

alter table public.ai_analysis_runs add constraint ai_analysis_runs_input_tokens_check CHECK (((input_tokens IS NULL) OR (input_tokens >= 0)));

alter table public.ai_analysis_runs add constraint ai_analysis_runs_output_tokens_check CHECK (((output_tokens IS NULL) OR (output_tokens >= 0)));

alter table public.ai_analysis_runs add constraint ai_analysis_runs_estimated_cost_usd_check CHECK (((estimated_cost_usd IS NULL) OR (estimated_cost_usd >= (0)::numeric)));

alter table public.ai_analysis_runs add constraint ai_analysis_runs_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)));

alter table public.ai_analysis_runs add constraint ai_analysis_runs_pkey PRIMARY KEY (id);

alter table public.frame_observations add constraint frame_observations_model_confidence_check CHECK (((model_confidence IS NULL) OR ((model_confidence >= (0)::numeric) AND (model_confidence <= (1)::numeric))));

alter table public.frame_observations add constraint frame_observations_pkey PRIMARY KEY (id);

alter table public.frame_observations add constraint frame_observations_once UNIQUE (analysis_run_id, frame_id);

alter table public.temporal_change_events add constraint temporal_change_events_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));

alter table public.temporal_change_events add constraint temporal_change_events_pkey PRIMARY KEY (id);

alter table public.verification_rules add constraint verification_rules_min_supporting_frames_check CHECK ((min_supporting_frames >= 1));

alter table public.verification_rules add constraint verification_rules_min_confidence_check CHECK (((min_confidence >= (0)::numeric) AND (min_confidence <= (1)::numeric)));

alter table public.verification_rules add constraint verification_rules_pkey PRIMARY KEY (id);

alter table public.verification_results add constraint verification_results_model_confidence_check CHECK (((model_confidence IS NULL) OR ((model_confidence >= (0)::numeric) AND (model_confidence <= (1)::numeric))));

alter table public.verification_results add constraint verification_results_system_confidence_check CHECK (((system_confidence IS NULL) OR ((system_confidence >= (0)::numeric) AND (system_confidence <= (1)::numeric))));

alter table public.verification_results add constraint verification_results_pkey PRIMARY KEY (id);

alter table public.verification_evidence add constraint verification_evidence_role_check CHECK ((role = ANY (ARRAY['supporting'::text, 'contradicting'::text, 'before'::text, 'after'::text, 'context'::text])));

alter table public.verification_evidence add constraint verification_evidence_pkey PRIMARY KEY (id);

alter table public.human_review_tasks add constraint human_review_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'critical'::text])));

alter table public.human_review_tasks add constraint human_review_tasks_pkey PRIMARY KEY (id);

alter table public.human_review_decisions add constraint human_review_decisions_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text, 'edit_activity'::text, 'adjust_room'::text, 'add_evidence'::text, 'request_reanalysis'::text, 'comment'::text])));

alter table public.human_review_decisions add constraint human_review_decisions_comment_check CHECK (((comment IS NULL) OR (length(comment) <= 4000)));

alter table public.human_review_decisions add constraint human_review_decisions_pkey PRIMARY KEY (id);

alter table public.verification_audit_events add constraint verification_audit_events_pkey PRIMARY KEY (id);

alter table public.verification_ai_costs add constraint verification_ai_costs_pkey PRIMARY KEY (id);

alter table public.verification_usage_limits add constraint verification_usage_limits_monthly_budget_usd_check CHECK (((monthly_budget_usd IS NULL) OR (monthly_budget_usd >= (0)::numeric)));

alter table public.verification_usage_limits add constraint verification_usage_limits_monthly_video_limit_check CHECK (((monthly_video_limit IS NULL) OR (monthly_video_limit >= 0)));

alter table public.verification_usage_limits add constraint verification_usage_limits_max_frames_per_video_check CHECK (((max_frames_per_video >= 1) AND (max_frames_per_video <= 2000)));

alter table public.verification_usage_limits add constraint verification_usage_limits_pkey PRIMARY KEY (org_id);

alter table public.video_clips add constraint video_clips_start_seconds_check CHECK ((start_seconds >= (0)::numeric));

alter table public.video_clips add constraint video_clips_check CHECK ((end_seconds > start_seconds));

alter table public.video_clips add constraint video_clips_pkey PRIMARY KEY (id);

alter table public.llm_verification_runs add constraint llm_verification_runs_purpose_check CHECK ((purpose = ANY (ARRAY['primary'::text, 'escalation'::text, 'reevaluation'::text])));

alter table public.llm_verification_runs add constraint llm_verification_runs_pkey PRIMARY KEY (id);

alter table public.verification_videos add constraint verification_videos_data_owner_check CHECK ((data_owner = ANY (ARRAY['customer'::text, 'atmosphere'::text, 'shared'::text])));

alter table public.verification_videos add constraint verification_videos_training_consent_check CHECK ((training_consent = ANY (ARRAY['granted'::text, 'declined'::text, 'not_asked'::text])));

alter table public.verification_results add constraint verification_results_completion_state_check CHECK (((completion_state IS NULL) OR (completion_state = ANY (ARRAY['not_started'::text, 'started'::text, 'partial'::text, 'complete'::text, 'unknown'::text]))));

alter table public.verification_results add constraint verification_results_training_consent_check CHECK ((training_consent = ANY (ARRAY['granted'::text, 'declined'::text, 'not_asked'::text])));

alter table public.temporal_change_events add constraint temporal_change_events_candidate_status_check CHECK ((candidate_status = ANY (ARRAY['proposed'::text, 'llm_reviewed'::text, 'accepted'::text, 'rejected'::text, 'superseded'::text])));

alter table public.network_erasures add constraint network_erasures_pkey PRIMARY KEY (email);

alter table public.orgs add constraint orgs_location_retention_bounds CHECK (((location_retention_hours >= 1) AND (location_retention_hours <= 168)));

alter table public.verifier_shares add constraint verifier_shares_share_kind_check CHECK ((share_kind = ANY (ARRAY['evidence'::text, 'progress'::text])));

alter table public.work_episodes add constraint work_episodes_intent_note_check CHECK (((intent_note IS NULL) OR (length(intent_note) <= 2000)));

alter table public.work_episodes add constraint work_episodes_task_label_source_check CHECK ((task_label_source = ANY (ARRAY['ai'::text, 'human'::text, 'rule'::text])));

alter table public.work_episodes add constraint work_episodes_performer_label_check CHECK (((performer_label IS NULL) OR (length(performer_label) <= 160)));

alter table public.work_episodes add constraint work_episodes_performer_kind_check CHECK ((performer_kind = ANY (ARRAY['human'::text, 'machine'::text, 'mixed'::text])));

alter table public.work_episodes add constraint work_episode_time_order CHECK (((started_at IS NULL) OR (ended_at IS NULL) OR (ended_at >= started_at)));

alter table public.work_episodes add constraint work_episodes_completion_note_check CHECK (((completion_note IS NULL) OR (length(completion_note) <= 2000)));

alter table public.work_episodes add constraint work_episodes_tier_check CHECK (((tier >= 1) AND (tier <= 5)));

alter table public.work_episodes add constraint work_episode_rights_attributed CHECK (((data_rights = 'job_only'::work_data_rights) OR ((rights_set_by IS NOT NULL) AND (rights_set_at IS NOT NULL))));

alter table public.work_episodes add constraint work_episode_licensable_needs_consent CHECK (((data_rights <> 'licensable'::work_data_rights) OR (worker_consent = 'granted'::work_consent_state)));

alter table public.work_episodes add constraint work_episodes_pkey PRIMARY KEY (id);

alter table public.episode_observations add constraint episode_observations_evidence_kind_check CHECK ((evidence_kind = ANY (ARRAY['video'::text, 'photo'::text, 'audio'::text, 'depth_scan'::text, 'measurement'::text, 'sensor'::text, 'document'::text, 'note'::text])));

alter table public.episode_observations add constraint episode_observations_reading_name_check CHECK (((reading_name IS NULL) OR (length(reading_name) <= 80)));

alter table public.episode_observations add constraint episode_observations_reading_unit_check CHECK (((reading_unit IS NULL) OR (length(reading_unit) <= 20)));

alter table public.episode_observations add constraint episode_observations_note_check CHECK (((note IS NULL) OR (length(note) <= 2000)));

alter table public.episode_observations add constraint episode_observation_has_substance CHECK (((proof_id IS NOT NULL) OR (reading_value IS NOT NULL) OR (note IS NOT NULL)));

alter table public.episode_observations add constraint episode_observations_pkey PRIMARY KEY (id);

alter table public.episode_actions add constraint episode_actions_action_check CHECK (((length(btrim(action)) >= 2) AND (length(btrim(action)) <= 40)));

alter table public.episode_actions add constraint episode_actions_purpose_check CHECK (((purpose IS NULL) OR (length(purpose) <= 500)));

alter table public.episode_actions add constraint episode_actions_result_check CHECK (((result IS NULL) OR (length(result) <= 500)));

alter table public.episode_actions add constraint episode_actions_label_source_check CHECK ((label_source = ANY (ARRAY['ai'::text, 'human'::text, 'tool'::text])));

alter table public.episode_actions add constraint episode_actions_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));

alter table public.episode_actions add constraint episode_action_time_order CHECK (((started_at IS NULL) OR (ended_at IS NULL) OR (ended_at >= started_at)));

alter table public.episode_actions add constraint episode_actions_pkey PRIMARY KEY (id);

alter table public.episode_actions add constraint episode_actions_episode_id_sequence_key UNIQUE (episode_id, sequence);

alter table public.episode_resources add constraint episode_resources_kind_check CHECK ((kind = ANY (ARRAY['tool'::text, 'material'::text])));

alter table public.episode_resources add constraint episode_resources_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)));

alter table public.episode_resources add constraint episode_resources_source_check CHECK ((source = ANY (ARRAY['human'::text, 'ai'::text, 'purchase_order'::text, 'telemetry'::text])));

alter table public.episode_resources add constraint episode_resources_pkey PRIMARY KEY (id);

alter table public.episode_verifications add constraint episode_verifications_kind_check CHECK ((kind = ANY (ARRAY['ai_analysis'::text, 'gc_acceptance'::text, 'owner_acceptance'::text, 'code_inspection'::text, 'engineer_review'::text, 'pressure_test'::text, 'electrical_test'::text, 'moisture_reading'::text, 'thermal_scan'::text, 'punch_list'::text, 'third_party_test'::text])));

alter table public.episode_verifications add constraint episode_verifications_result_check CHECK ((result = ANY (ARRAY['pass'::text, 'fail'::text, 'inconclusive'::text])));

alter table public.episode_verifications add constraint episode_verifications_verifier_label_check CHECK (((verifier_label IS NULL) OR (length(verifier_label) <= 200)));

alter table public.episode_verifications add constraint episode_verifications_tolerance_note_check CHECK (((tolerance_note IS NULL) OR (length(tolerance_note) <= 500)));

alter table public.episode_verifications add constraint episode_verifications_detail_check CHECK (((detail IS NULL) OR (length(detail) <= 2000)));

alter table public.episode_verifications add constraint episode_verifications_pkey PRIMARY KEY (id);

alter table public.episode_outcomes add constraint episode_outcomes_kind_check CHECK ((kind = ANY (ARRAY['no_failure_observed'::text, 'leak'::text, 'crack'::text, 'electrical_fault'::text, 'water_intrusion'::text, 'mold'::text, 'material_failure'::text, 'callback'::text, 'warranty_claim'::text, 'insurance_claim'::text, 'customer_complaint'::text, 'rework_ordered'::text, 'litigation'::text])));

alter table public.episode_outcomes add constraint episode_outcomes_detail_check CHECK (((detail IS NULL) OR (length(detail) <= 2000)));

alter table public.episode_outcomes add constraint episode_outcomes_cost_amount_check CHECK (((cost_amount IS NULL) OR (cost_amount >= (0)::numeric)));

alter table public.episode_outcomes add constraint episode_outcomes_pkey PRIMARY KEY (id);

alter table public.episode_economics add constraint episode_economics_labor_hours_check CHECK (((labor_hours IS NULL) OR (labor_hours >= (0)::numeric)));

alter table public.episode_economics add constraint episode_economics_delay_days_check CHECK (((delay_days IS NULL) OR (delay_days >= 0)));

alter table public.episode_economics add constraint episode_economics_note_check CHECK (((note IS NULL) OR (length(note) <= 1000)));

alter table public.episode_economics add constraint episode_economics_pkey PRIMARY KEY (episode_id);

alter table public.media_objects add constraint media_objects_av_kinds_audio CHECK (((kind <> ALL (ARRAY['field_day_video'::media_kind, 'proof_video'::media_kind])) OR (state <> 'ready'::media_state) OR (has_audio IS DISTINCT FROM false)));

alter table public.platform_staff add constraint platform_staff_pkey PRIMARY KEY (user_id);

alter table public.platform_admin_audit add constraint platform_admin_audit_pkey PRIMARY KEY (id);

alter table public.job_proofs add constraint job_proofs_actions_is_array CHECK ((jsonb_typeof(actions) = 'array'::text));

alter table public.internal_staff_totp add constraint internal_staff_totp_pkey PRIMARY KEY (email);

alter table public.internal_access_requests add constraint internal_access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])));

alter table public.internal_access_requests add constraint internal_access_requests_pkey PRIMARY KEY (id);

alter table public.legal_holds add constraint legal_holds_case_number_check CHECK (((length(case_number) >= 1) AND (length(case_number) <= 120)));

alter table public.legal_holds add constraint legal_holds_title_check CHECK (((length(title) >= 1) AND (length(title) <= 240)));

alter table public.legal_holds add constraint legal_holds_reason_check CHECK (((length(reason) >= 1) AND (length(reason) <= 4000)));

alter table public.legal_holds add constraint legal_holds_counsel_name_check CHECK (((counsel_name IS NULL) OR (length(counsel_name) <= 200)));

alter table public.legal_holds add constraint legal_holds_release_reason_check CHECK (((release_reason IS NULL) OR (length(release_reason) <= 2000)));

alter table public.legal_holds add constraint legal_holds_release_together CHECK (((status = 'released'::legal_hold_status) = (released_at IS NOT NULL)));

alter table public.legal_holds add constraint legal_holds_pkey PRIMARY KEY (id);

alter table public.legal_hold_subjects add constraint legal_hold_subjects_pkey PRIMARY KEY (id);

alter table public.legal_hold_subjects add constraint legal_hold_subjects_hold_id_subject_type_subject_id_key UNIQUE (hold_id, subject_type, subject_id);

alter table public.legal_video_vault add constraint legal_video_vault_pkey PRIMARY KEY (id);

alter table public.legal_video_vault add constraint legal_video_vault_source_kind_source_id_key UNIQUE (source_kind, source_id);

alter table public.user_activity_events add constraint user_activity_events_action_check CHECK (((length(action) >= 1) AND (length(action) <= 120)));

alter table public.user_activity_events add constraint user_activity_events_pkey PRIMARY KEY (id);

alter table public.legal_productions add constraint legal_productions_note_check CHECK (((note IS NULL) OR (length(note) <= 2000)));

alter table public.legal_productions add constraint legal_productions_pkey PRIMARY KEY (id);

alter table public.episode_world_states add constraint episode_world_states_kind_check CHECK ((kind = ANY (ARRAY['before'::text, 'after'::text])));

alter table public.episode_world_states add constraint episode_world_states_summary_check CHECK (((summary IS NULL) OR (length(summary) <= 2000)));

alter table public.episode_world_states add constraint episode_world_states_opening_check CHECK (((opening IS NULL) OR (length(opening) <= 40)));

alter table public.episode_world_states add constraint episode_world_states_source_check CHECK ((source = ANY (ARRAY['ai'::text, 'human'::text, 'derived'::text])));

alter table public.episode_world_states add constraint episode_world_states_pkey PRIMARY KEY (id);

alter table public.episode_world_states add constraint episode_world_states_episode_id_kind_key UNIQUE (episode_id, kind);

alter table public.episode_evidence_assets add constraint episode_evidence_assets_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'photo'::text, 'audio'::text, 'transcript'::text, 'document'::text, 'note'::text, 'frame'::text])));

alter table public.episode_evidence_assets add constraint episode_evidence_assets_pkey PRIMARY KEY (id);

alter table public.episode_evidence_assets add constraint episode_evidence_assets_episode_id_proof_id_kind_key UNIQUE (episode_id, proof_id, kind);

alter table public.episode_annotations add constraint episode_annotations_kind_check CHECK ((kind = ANY (ARRAY['ai_world_state'::text, 'ai_actions'::text, 'ai_immediate_outcome'::text, 'ai_resources'::text, 'human'::text])));

alter table public.episode_annotations add constraint episode_annotations_pkey PRIMARY KEY (id);

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_status_check CHECK ((status = ANY (ARRAY['appears_complete'::text, 'in_progress'::text, 'not_visible'::text, 'mixed'::text, 'changed'::text, 'unknown'::text])));

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_summary_check CHECK (((summary IS NULL) OR (length(summary) <= 2000)));

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_source_check CHECK ((source = ANY (ARRAY['ai'::text, 'human'::text, 'derived'::text])));

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcome_not_truth CHECK ((is_ground_truth = false));

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_pkey PRIMARY KEY (episode_id);

alter table public.job_proofs add constraint job_proofs_transcript_status_check CHECK ((transcript_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text, 'done'::text, 'skipped'::text, 'failed'::text])));

alter table public.token_usage_events add constraint token_usage_events_input_tokens_check CHECK ((input_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_output_tokens_check CHECK ((output_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_cache_tokens_check CHECK ((cache_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_price_nanos_check CHECK ((price_nanos >= 0));

alter table public.token_usage_events add constraint token_usage_events_pkey PRIMARY KEY (id);

alter table public.token_usage_events add constraint token_usage_events_idempotency UNIQUE (org_id, request_id);

alter table public.crm_audit_log add constraint crm_audit_log_op_check CHECK ((op = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])));

alter table public.crm_audit_log add constraint crm_audit_log_pkey PRIMARY KEY (id);

alter table public.token_usage_events add constraint token_usage_events_cost_nanos_check CHECK ((cost_nanos >= 0));

alter table public.org_billing add constraint org_billing_extra_fc_seats_check CHECK ((extra_fc_seats >= 0));

alter table public.terms_acceptances add constraint terms_acceptances_pkey PRIMARY KEY (id);

alter table public.terms_acceptances add constraint terms_acceptances_user_id_terms_version_key UNIQUE (user_id, terms_version);

alter table public.atmosphere_migrations add constraint atmosphere_migrations_pkey PRIMARY KEY (version);

alter table public.org_billing add constraint org_billing_included_fc_seats_check CHECK ((included_fc_seats >= 0));

alter table public.job_progress_grants add constraint job_progress_grants_pkey PRIMARY KEY (id);

alter table public.job_progress_grants add constraint job_progress_grants_job_user UNIQUE (job_id, user_id);

alter table public.orgs add constraint orgs_safety_alert_webhook_url_check CHECK (((safety_alert_webhook_url IS NULL) OR ((length(safety_alert_webhook_url) >= 8) AND (length(safety_alert_webhook_url) <= 2000))));

alter table public.safety_incidents add constraint safety_incidents_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));

alter table public.safety_incidents add constraint safety_incidents_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200)));

alter table public.safety_incidents add constraint safety_incidents_description_check CHECK (((length(description) >= 1) AND (length(description) <= 4000)));

alter table public.safety_incidents add constraint safety_incidents_location_label_check CHECK (((location_label IS NULL) OR (length(location_label) <= 400)));

alter table public.safety_incidents add constraint safety_incidents_dismiss_reason_check CHECK (((dismiss_reason IS NULL) OR (length(dismiss_reason) <= 1000)));

alter table public.safety_incidents add constraint safety_incidents_pkey PRIMARY KEY (id);

alter table public.profiles add constraint profiles_service_role_check CHECK (((service_role IS NULL) OR (service_role = ANY (ARRAY['homeowner'::text, 'adjuster'::text, 'estimator'::text, 'project_manager'::text, 'electrician'::text, 'plumber'::text, 'roofer'::text, 'technician'::text, 'crew'::text, 'inspector'::text, 'other'::text]))));

alter table public.profiles add constraint profiles_service_role_custom_check CHECK (((service_role_custom IS NULL) OR ((length(btrim(service_role_custom)) >= 1) AND (length(btrim(service_role_custom)) <= 60))));

alter table public.job_parties add constraint job_parties_service_role_check CHECK (((service_role IS NULL) OR (service_role = ANY (ARRAY['homeowner'::text, 'adjuster'::text, 'estimator'::text, 'project_manager'::text, 'electrician'::text, 'plumber'::text, 'roofer'::text, 'technician'::text, 'crew'::text, 'inspector'::text, 'other'::text]))));

alter table public.job_parties add constraint job_parties_service_role_custom_check CHECK (((service_role_custom IS NULL) OR ((length(btrim(service_role_custom)) >= 1) AND (length(btrim(service_role_custom)) <= 60))));

alter table public.job_progress_grants add constraint job_progress_grants_service_role_check CHECK ((service_role = 'homeowner'::text));

alter table public.org_invites add constraint org_invites_service_role_check CHECK (((service_role IS NULL) OR (service_role = ANY (ARRAY['homeowner'::text, 'adjuster'::text, 'estimator'::text, 'project_manager'::text, 'electrician'::text, 'plumber'::text, 'roofer'::text, 'technician'::text, 'crew'::text, 'inspector'::text, 'other'::text]))));

alter table public.org_invites add constraint org_invites_service_role_custom_check CHECK (((service_role_custom IS NULL) OR ((length(btrim(service_role_custom)) >= 1) AND (length(btrim(service_role_custom)) <= 60))));

alter table public.orgs add constraint orgs_wellness_no_motion_seconds_check CHECK (((wellness_no_motion_seconds >= 60) AND (wellness_no_motion_seconds <= 7200)));

alter table public.orgs add constraint orgs_wellness_critical_after_seconds_check CHECK (((wellness_critical_after_seconds >= 60) AND (wellness_critical_after_seconds <= 14400)));

alter table public.wellness_session_state add constraint wellness_session_state_person_count_estimate_check CHECK (((person_count_estimate IS NULL) OR ((person_count_estimate >= 0) AND (person_count_estimate <= 50))));

alter table public.wellness_session_state add constraint wellness_session_state_location_label_check CHECK (((location_label IS NULL) OR (length(location_label) <= 400)));

alter table public.wellness_session_state add constraint wellness_session_state_pkey PRIMARY KEY (id);

alter table public.orgs add constraint orgs_daily_job_report_timezone_check CHECK (((length(btrim(daily_job_report_timezone)) >= 1) AND (length(btrim(daily_job_report_timezone)) <= 64)));

alter table public.orgs add constraint orgs_daily_job_report_channel_check CHECK ((daily_job_report_channel = ANY (ARRAY['email'::text, 'sms'::text, 'email_and_sms'::text])));

alter table public.orgs add constraint orgs_daily_job_report_send_hour_check CHECK (((daily_job_report_send_hour >= 0) AND (daily_job_report_send_hour <= 23)));

alter table public.daily_job_reports add constraint daily_job_reports_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'email_and_sms'::text])));

alter table public.daily_job_reports add constraint daily_job_reports_clip_count_check CHECK ((clip_count >= 0));

alter table public.daily_job_reports add constraint daily_job_reports_pkey PRIMARY KEY (id);

alter table public.daily_job_reports add constraint daily_job_reports_org_id_job_id_local_day_key UNIQUE (org_id, job_id, local_day);

alter table public.trade_playbooks add constraint trade_playbooks_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200)));

alter table public.trade_playbooks add constraint trade_playbooks_trade_check CHECK (((trade IS NULL) OR ((length(trade) >= 1) AND (length(trade) <= 80))));

alter table public.trade_playbooks add constraint trade_playbooks_summary_check CHECK (((summary IS NULL) OR (length(summary) <= 4000)));

alter table public.trade_playbooks add constraint trade_playbooks_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])));

alter table public.trade_playbooks add constraint trade_playbooks_source_kind_check CHECK ((source_kind = ANY (ARRAY['job_analysis'::text, 'manual'::text, 'seeded'::text])));

alter table public.trade_playbooks add constraint trade_playbooks_step_count_check CHECK ((step_count >= 0));

alter table public.trade_playbooks add constraint trade_playbooks_pkey PRIMARY KEY (id);

alter table public.trade_playbook_steps add constraint trade_playbook_steps_position_check CHECK (("position" >= 0));

alter table public.trade_playbook_steps add constraint trade_playbook_steps_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200)));

alter table public.trade_playbook_steps add constraint trade_playbook_steps_instruction_check CHECK (((instruction IS NULL) OR (length(instruction) <= 4000)));

alter table public.trade_playbook_steps add constraint trade_playbook_steps_skill_key_check CHECK (((skill_key IS NULL) OR ((length(skill_key) >= 1) AND (length(skill_key) <= 64))));

alter table public.trade_playbook_steps add constraint trade_playbook_steps_evidence_hint_check CHECK (((evidence_hint IS NULL) OR (length(evidence_hint) <= 1000)));

alter table public.trade_playbook_steps add constraint trade_playbook_steps_pkey PRIMARY KEY (id);

alter table public.trade_playbook_steps add constraint trade_playbook_steps_playbook_id_position_key UNIQUE (playbook_id, "position");

alter table public.trade_playbook_sources add constraint trade_playbook_sources_pkey PRIMARY KEY (id);

alter table public.ask_threads add constraint ask_threads_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 200)));

alter table public.ask_threads add constraint ask_threads_owner_xor CHECK ((((owner_user_id IS NOT NULL) AND (share_id IS NULL)) OR ((owner_user_id IS NULL) AND (share_id IS NOT NULL))));

alter table public.ask_threads add constraint ask_threads_pkey PRIMARY KEY (id);

alter table public.proof_live_sessions add constraint proof_live_sessions_clip_id_check CHECK ((clip_id ~ '^[a-zA-Z0-9_-]{6,64}$'::text));

alter table public.proof_live_sessions add constraint proof_live_sessions_storage_path_check CHECK (((length(storage_path) >= 1) AND (length(storage_path) <= 500)));

alter table public.proof_live_sessions add constraint proof_live_sessions_phase_check CHECK ((phase = ANY (ARRAY['before'::text, 'after'::text])));

alter table public.proof_live_sessions add constraint proof_live_sessions_extension_check CHECK ((extension ~ '^[a-z0-9]{2,5}$'::text));

alter table public.proof_live_sessions add constraint proof_live_sessions_mime_type_check CHECK (((length(mime_type) >= 1) AND (length(mime_type) <= 80)));

alter table public.proof_live_sessions add constraint proof_live_sessions_status_check CHECK ((status = ANY (ARRAY['live'::text, 'ended'::text])));

alter table public.proof_live_sessions add constraint proof_live_sessions_last_mint_index_check CHECK (((last_mint_index >= 0) AND (last_mint_index < 128)));

alter table public.proof_live_sessions add constraint proof_live_sessions_pkey PRIMARY KEY (id);

alter table public.recording_acknowledgments add constraint recording_acknowledgments_disclosure_version_check CHECK (((char_length(disclosure_version) >= 1) AND (char_length(disclosure_version) <= 64)));

alter table public.recording_acknowledgments add constraint recording_acknowledgments_pkey PRIMARY KEY (id);

alter table public.recording_acknowledgments add constraint recording_acknowledgments_job_id_actor_user_id_work_date_di_key UNIQUE (job_id, actor_user_id, work_date, disclosure_version);

alter table public.crm_agent_credentials add constraint crm_agent_credentials_system_check CHECK ((system = ANY (ARRAY['jobnimbus'::text, 'acculynx'::text, 'salesforce'::text, 'servicetitan'::text])));

alter table public.crm_agent_credentials add constraint crm_agent_credentials_username_check CHECK (((length(btrim(username)) >= 1) AND (length(btrim(username)) <= 320)));

alter table public.crm_agent_credentials add constraint crm_agent_credentials_notes_check CHECK (((notes IS NULL) OR (length(notes) <= 2000)));

alter table public.crm_agent_credentials add constraint crm_agent_credentials_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'pending_verify'::text, 'error'::text])));

alter table public.crm_agent_credentials add constraint crm_agent_credentials_pkey PRIMARY KEY (org_id, system);

alter table public.crm_agent_jobs add constraint crm_agent_jobs_system_check CHECK ((system = ANY (ARRAY['jobnimbus'::text, 'acculynx'::text, 'salesforce'::text, 'servicetitan'::text])));

alter table public.crm_agent_jobs add constraint crm_agent_jobs_kind_check CHECK ((kind = ANY (ARRAY['verify_login'::text, 'pull'::text, 'push_update'::text, 'search'::text])));

alter table public.crm_agent_jobs add constraint crm_agent_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text])));

alter table public.crm_agent_jobs add constraint crm_agent_jobs_pkey PRIMARY KEY (id);

alter table public.job_proofs add constraint job_proofs_custom_title_len CHECK (((custom_title IS NULL) OR ((char_length(btrim(custom_title)) >= 1) AND (char_length(btrim(custom_title)) <= 80))));

alter table public.profiles add constraint profiles_handle_format CHECK (((handle IS NULL) OR (handle ~ '^[a-z0-9][a-z0-9_]{1,31}$'::text)));

alter table public.content_mentions add constraint content_mentions_handle_check CHECK ((handle ~ '^[a-z0-9][a-z0-9_]{1,31}$'::text));

alter table public.content_mentions add constraint content_mentions_source_check CHECK ((source = ANY (ARRAY['job_message'::text, 'work_log'::text, 'job_proof'::text, 'ask_question'::text])));

alter table public.content_mentions add constraint content_mentions_pkey PRIMARY KEY (id);

alter table public.ask_job_notes add constraint ask_job_notes_note_check CHECK (((length(btrim(note)) >= 1) AND (length(btrim(note)) <= 400)));

alter table public.ask_job_notes add constraint ask_job_notes_owner_xor CHECK ((((owner_user_id IS NOT NULL) AND (share_id IS NULL)) OR ((owner_user_id IS NULL) AND (share_id IS NOT NULL))));

alter table public.ask_job_notes add constraint ask_job_notes_pkey PRIMARY KEY (id);

alter table public.job_proofs add constraint job_proofs_summary_status_check CHECK (((summary_status IS NULL) OR (summary_status = ANY (ARRAY['stale'::text, 'queued'::text, 'running'::text, 'done'::text, 'failed'::text]))));

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_seq_check CHECK ((seq >= 0));

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_text_check CHECK (((length(text) >= 1) AND (length(text) <= 4000)));

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_pkey PRIMARY KEY (id);

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_proof_seq_key UNIQUE (proof_id, seq);

alter table public.voiceprints add constraint voiceprints_consent_text_check CHECK (((length(btrim(consent_text)) >= 20) AND (length(btrim(consent_text)) <= 4000)));

alter table public.voiceprints add constraint voiceprints_pkey PRIMARY KEY (id);

alter table public.voiceprints add constraint voiceprints_user_id_key UNIQUE (user_id);

alter table public.voiceprint_embeddings add constraint voiceprint_embeddings_dimension_check CHECK (((dimension > 0) AND (dimension <= 512)));

alter table public.voiceprint_embeddings add constraint voiceprint_embeddings_pkey PRIMARY KEY (voiceprint_id);

alter table public.voice_consent_events add constraint voice_consent_events_action_check CHECK ((action = ANY (ARRAY['granted'::text, 'revoked'::text])));

alter table public.voice_consent_events add constraint voice_consent_events_pkey PRIMARY KEY (id);

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'declined'::text, 'cancelled'::text])));

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_check CHECK ((requester_user_id <> subject_user_id));

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_pkey PRIMARY KEY (id);

alter table public.speaker_identities add constraint speaker_identities_speaker_label_check CHECK (((length(btrim(speaker_label)) >= 1) AND (length(btrim(speaker_label)) <= 80)));

alter table public.speaker_identities add constraint speaker_identities_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])));

alter table public.speaker_identities add constraint speaker_identities_method_check CHECK ((method = ANY (ARRAY['name_pickup'::text, 'voice_high'::text, 'voice_medium'::text, 'user'::text])));

alter table public.speaker_identities add constraint speaker_identities_pkey PRIMARY KEY (id);

alter table public.speaker_identities add constraint speaker_identities_proof_id_speaker_label_method_key UNIQUE (proof_id, speaker_label, method);

alter table public.speaker_role_guesses add constraint speaker_role_guesses_speaker_label_check CHECK (((length(btrim(speaker_label)) >= 1) AND (length(btrim(speaker_label)) <= 80)));

alter table public.speaker_role_guesses add constraint speaker_role_guesses_role_check CHECK ((role = ANY (ARRAY['homeowner'::text, 'subcontractor'::text, 'crew'::text, 'adjuster'::text, 'other'::text])));

alter table public.speaker_role_guesses add constraint speaker_role_guesses_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));

alter table public.speaker_role_guesses add constraint speaker_role_guesses_source_quote_check CHECK (((length(btrim(source_quote)) >= 1) AND (length(btrim(source_quote)) <= 500)));

alter table public.speaker_role_guesses add constraint speaker_role_guesses_status_check CHECK ((status = ANY (ARRAY['tentative'::text, 'confirmed'::text, 'corrected'::text, 'dismissed'::text])));

alter table public.speaker_role_guesses add constraint speaker_role_guesses_pkey PRIMARY KEY (id);

alter table public.speaker_role_guesses add constraint speaker_role_guesses_proof_id_speaker_label_key UNIQUE (proof_id, speaker_label);

alter table public.job_locations add constraint job_locations_room_key_len CHECK (((room_key IS NULL) OR ((length(btrim(room_key)) >= 1) AND (length(btrim(room_key)) <= 80))));

alter table public.clip_room_segments add constraint clip_room_segments_sequence_index_check CHECK ((sequence_index >= 0));

alter table public.clip_room_segments add constraint clip_room_segments_room_name_check CHECK (((length(btrim(room_name)) >= 1) AND (length(btrim(room_name)) <= 80)));

alter table public.clip_room_segments add constraint clip_room_segments_room_key_check CHECK (((length(btrim(room_key)) >= 1) AND (length(btrim(room_key)) <= 80)));

alter table public.clip_room_segments add constraint clip_room_segments_start_seconds_check CHECK ((start_seconds >= (0)::numeric));

alter table public.clip_room_segments add constraint clip_room_segments_check CHECK ((end_seconds >= start_seconds));

alter table public.clip_room_segments add constraint clip_room_segments_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));

alter table public.clip_room_segments add constraint clip_room_segments_source_check CHECK ((source = ANY (ARRAY['analysis'::text, 'backfill'::text, 'user'::text])));

alter table public.clip_room_segments add constraint clip_room_segments_pkey PRIMARY KEY (id);

alter table public.clip_room_segments add constraint clip_room_segments_proof_seq_key UNIQUE (proof_id, sequence_index);

alter table public.job_chat_documents add constraint job_chat_documents_filename_check CHECK (((length(btrim(filename)) >= 1) AND (length(btrim(filename)) <= 200)));

alter table public.job_chat_documents add constraint job_chat_documents_media_type_check CHECK (((length(media_type) >= 1) AND (length(media_type) <= 160)));

alter table public.job_chat_documents add constraint job_chat_documents_byte_size_check CHECK (((byte_size >= 0) AND (byte_size <= 26214400)));

alter table public.job_chat_documents add constraint job_chat_documents_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'failed'::text])));

alter table public.job_chat_documents add constraint job_chat_documents_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['estimate'::text, 'invoice'::text, 'contract'::text, 'change_order'::text, 'insurance_claim'::text, 'scope'::text, 'sketch'::text, 'floor_plan'::text, 'permit'::text, 'photo'::text, 'other'::text])));

alter table public.job_chat_documents add constraint job_chat_documents_relevance_check CHECK ((relevance = ANY (ARRAY['related'::text, 'not_related'::text, 'pending_confirm'::text])));

alter table public.job_chat_documents add constraint job_chat_documents_attach_pair CHECK (((attached_at IS NULL) = (job_id IS NULL)));

alter table public.job_chat_documents add constraint job_chat_documents_pkey PRIMARY KEY (id);

alter table public.ask_document_chunks add constraint ask_document_chunks_seq_check CHECK ((seq >= 0));

alter table public.ask_document_chunks add constraint ask_document_chunks_location_check CHECK (((length(location) >= 1) AND (length(location) <= 80)));

alter table public.ask_document_chunks add constraint ask_document_chunks_text_check CHECK (((length(text) >= 1) AND (length(text) <= 4000)));

alter table public.ask_document_chunks add constraint ask_document_chunks_pkey PRIMARY KEY (id);

alter table public.ask_document_chunks add constraint ask_document_chunks_document_seq_key UNIQUE (document_id, seq);

alter table public.job_document_rooms add constraint job_document_rooms_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80)));

alter table public.job_document_rooms add constraint job_document_rooms_pkey PRIMARY KEY (id);

alter table public.ai_credit_ledger add constraint ai_credit_ledger_kind_check CHECK ((kind = ANY (ARRAY['purchase'::text, 'admin_grant'::text, 'consume'::text, 'refund'::text, 'adjustment'::text])));

alter table public.ai_credit_ledger add constraint ai_credit_ledger_pkey PRIMARY KEY (id);

alter table public.ai_usage_allocations add constraint ai_usage_allocations_cost_nanos_check CHECK ((cost_nanos >= 0));

alter table public.ai_usage_allocations add constraint ai_usage_allocations_allowance_nanos_check CHECK ((allowance_nanos >= 0));

alter table public.ai_usage_allocations add constraint ai_usage_allocations_credit_nanos_check CHECK ((credit_nanos >= 0));

alter table public.ai_usage_allocations add constraint ai_usage_allocations_pkey PRIMARY KEY (id);

alter table public.ai_usage_allocations add constraint ai_usage_allocations_org_id_request_id_key UNIQUE (org_id, request_id);

alter table public.ai_budget_price_spans add constraint ai_budget_price_spans_amount_cents_check CHECK ((amount_cents >= 0));

alter table public.ai_budget_price_spans add constraint ai_budget_price_spans_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['month'::text, 'year'::text])));

alter table public.ai_budget_price_spans add constraint ai_budget_price_spans_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)));

alter table public.ai_budget_price_spans add constraint ai_budget_price_spans_pkey PRIMARY KEY (id);

alter table public.scope_documents add constraint scope_documents_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'extracting'::text, 'extracted'::text, 'failed'::text, 'confirmed'::text, 'budget_hold'::text])));

alter table public.ai_credit_pack_clawbacks add constraint ai_credit_pack_clawbacks_granted_nanos_check CHECK ((granted_nanos >= 0));

alter table public.ai_credit_pack_clawbacks add constraint ai_credit_pack_clawbacks_charge_amount_cents_check CHECK ((charge_amount_cents >= 0));

alter table public.ai_credit_pack_clawbacks add constraint ai_credit_pack_clawbacks_amount_refunded_cents_check CHECK ((amount_refunded_cents >= 0));

alter table public.ai_credit_pack_clawbacks add constraint ai_credit_pack_clawbacks_pkey PRIMARY KEY (org_id, stripe_charge_id);

alter table public.ai_credit_pack_disputes add constraint ai_credit_pack_disputes_amount_cents_check CHECK ((amount_cents >= 0));

alter table public.ai_credit_pack_disputes add constraint ai_credit_pack_disputes_standing_check CHECK ((standing = ANY (ARRAY['open'::text, 'lost'::text, 'won'::text])));

alter table public.ai_credit_pack_disputes add constraint ai_credit_pack_disputes_pkey PRIMARY KEY (org_id, stripe_dispute_id);

alter table public.capture_upload_attempts add constraint capture_upload_attempts_upload_key_check CHECK (((char_length(upload_key) >= 1) AND (char_length(upload_key) <= 500)));

alter table public.capture_upload_attempts add constraint capture_upload_attempts_attempts_check CHECK ((attempts >= 1));

alter table public.capture_upload_attempts add constraint capture_upload_attempts_last_error_code_check CHECK (((last_error_code IS NULL) OR (char_length(last_error_code) <= 64)));

alter table public.capture_upload_attempts add constraint capture_upload_attempts_pkey PRIMARY KEY (org_id, upload_key);

alter table public.ask_turn_events add constraint ask_turn_events_surface_check CHECK ((surface = ANY (ARRAY['job'::text, 'progress_share'::text])));

alter table public.ask_turn_events add constraint ask_turn_events_outcome_check CHECK ((outcome = ANY (ARRAY['answered'::text, 'error'::text, 'refused'::text, 'stopped'::text])));

alter table public.ask_turn_events add constraint ask_turn_events_error_code_check CHECK (((error_code IS NULL) OR (char_length(error_code) <= 64)));

alter table public.ask_turn_events add constraint ask_turn_events_total_ms_check CHECK ((total_ms >= 0));

alter table public.ask_turn_events add constraint ask_turn_events_ttft_ms_check CHECK (((ttft_ms IS NULL) OR (ttft_ms >= 0)));

alter table public.ask_turn_events add constraint ask_turn_events_model_check CHECK (((model IS NULL) OR (char_length(model) <= 80)));

alter table public.ask_turn_events add constraint ask_turn_events_pkey PRIMARY KEY (id);

alter table public.analytics_campaigns add constraint analytics_campaigns_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)));

alter table public.analytics_campaigns add constraint analytics_campaigns_subject_check CHECK ((char_length(subject) <= 200));

alter table public.analytics_campaigns add constraint analytics_campaigns_body_markdown_check CHECK ((char_length(body_markdown) <= 50000));

alter table public.analytics_campaigns add constraint analytics_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'sent'::text, 'failed'::text])));

alter table public.analytics_campaigns add constraint analytics_campaigns_pkey PRIMARY KEY (id);

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 320)));

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text])));

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_error_check CHECK (((error IS NULL) OR (char_length(error) <= 500)));

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_pkey PRIMARY KEY (id);

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_unsubscribe_token_key UNIQUE (unsubscribe_token);

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_campaign_id_email_key UNIQUE (campaign_id, email);

alter table public.analytics_email_suppressions add constraint analytics_email_suppressions_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 320)));

alter table public.analytics_email_suppressions add constraint analytics_email_suppressions_reason_check CHECK ((reason = ANY (ARRAY['unsubscribe'::text, 'bounce'::text, 'complaint'::text, 'manual'::text])));

alter table public.analytics_email_suppressions add constraint analytics_email_suppressions_pkey PRIMARY KEY (email);

alter table public.token_usage_events add constraint token_usage_events_cache_read_tokens_check CHECK ((cache_read_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_cache_write_5m_tokens_check CHECK ((cache_write_5m_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_cache_write_1h_tokens_check CHECK ((cache_write_1h_tokens >= 0));

alter table public.token_usage_events add constraint token_usage_events_pricing_status_check CHECK ((pricing_status = ANY (ARRAY['priced'::text, 'unpriced'::text, 'repriced_conservative'::text, 'legacy'::text])));

alter table public.ai_credit_auto_recharge_settings add constraint ai_credit_auto_recharge_settings_pack_code_check CHECK ((pack_code = ANY (ARRAY['ai_10'::text, 'ai_25'::text, 'ai_50'::text])));

alter table public.ai_credit_auto_recharge_settings add constraint ai_credit_auto_recharge_settings_pkey PRIMARY KEY (org_id);

alter table public.ai_credit_auto_recharges add constraint ai_credit_auto_recharges_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents > 0)));

alter table public.ai_credit_auto_recharges add constraint ai_credit_auto_recharges_credit_nanos_check CHECK (((credit_nanos IS NULL) OR (credit_nanos >= 0)));

alter table public.ai_credit_auto_recharges add constraint ai_credit_auto_recharges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])));

alter table public.ai_credit_auto_recharges add constraint ai_credit_auto_recharges_pkey PRIMARY KEY (id);

alter table public.safety_incidents add constraint safety_incidents_reality_check CHECK (((reality IS NULL) OR (reality = ANY (ARRAY['real'::text, 'joking'::text, 'staged'::text, 'media_playback'::text, 'unclear'::text]))));

alter table public.safety_incidents add constraint safety_incidents_confirmation_check CHECK (((confirmation IS NULL) OR (confirmation = ANY (ARRAY['confirmed'::text, 'unconfirmed'::text]))));

alter table public.safety_incidents add constraint safety_incidents_dismiss_category_check CHECK (((dismiss_category IS NULL) OR (dismiss_category = ANY (ARRAY['false_alarm_media'::text, 'joking'::text, 'staged'::text, 'not_an_emergency'::text, 'handled'::text, 'duplicate'::text, 'other'::text]))));

alter table public.computer_sessions add constraint computer_sessions_status_check CHECK ((status = ANY (ARRAY['starting'::text, 'active'::text, 'ended'::text, 'failed'::text])));

alter table public.computer_sessions add constraint computer_sessions_browser_seconds_check CHECK (((browser_seconds IS NULL) OR (browser_seconds >= 0)));

alter table public.computer_sessions add constraint computer_sessions_pkey PRIMARY KEY (id);

alter table public.computer_tasks add constraint computer_tasks_instructions_check CHECK (((length(btrim(instructions)) >= 1) AND (length(btrim(instructions)) <= 4000)));

alter table public.computer_tasks add constraint computer_tasks_start_url_check CHECK (((start_url IS NULL) OR (length(start_url) <= 2048)));

alter table public.computer_tasks add constraint computer_tasks_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_approval'::text, 'needs_you'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text])));

alter table public.computer_tasks add constraint computer_tasks_status_detail_check CHECK (((status_detail IS NULL) OR (length(status_detail) <= 500)));

alter table public.computer_tasks add constraint computer_tasks_step_count_check CHECK ((step_count >= 0));

alter table public.computer_tasks add constraint computer_tasks_max_steps_check CHECK (((max_steps >= 1) AND (max_steps <= 500)));

alter table public.computer_tasks add constraint computer_tasks_budget_nanos_check CHECK ((budget_nanos > 0));

alter table public.computer_tasks add constraint computer_tasks_cost_nanos_check CHECK ((cost_nanos >= 0));

alter table public.computer_tasks add constraint computer_tasks_last_action_check CHECK (((last_action IS NULL) OR (length(last_action) <= 300)));

alter table public.computer_tasks add constraint computer_tasks_current_url_check CHECK (((current_url IS NULL) OR (length(current_url) <= 2048)));

alter table public.computer_tasks add constraint computer_tasks_result_summary_check CHECK (((result_summary IS NULL) OR (length(result_summary) <= 4000)));

alter table public.computer_tasks add constraint computer_tasks_error_check CHECK (((error IS NULL) OR (length(error) <= 1000)));

alter table public.computer_tasks add constraint computer_tasks_pkey PRIMARY KEY (id);

alter table public.computer_approvals add constraint computer_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'canceled'::text, 'expired'::text, 'consumed'::text])));

alter table public.computer_approvals add constraint computer_approvals_action_kind_check CHECK ((action_kind = ANY (ARRAY['submit'::text, 'send'::text, 'pay'::text, 'delete'::text, 'sign'::text, 'accept_terms'::text, 'upload'::text])));

alter table public.computer_approvals add constraint computer_approvals_button_label_check CHECK (((length(btrim(button_label)) >= 1) AND (length(btrim(button_label)) <= 200)));

alter table public.computer_approvals add constraint computer_approvals_summary_check CHECK (((length(btrim(summary)) >= 1) AND (length(btrim(summary)) <= 1000)));

alter table public.computer_approvals add constraint computer_approvals_page_url_check CHECK (((page_url IS NULL) OR (length(page_url) <= 2048)));

alter table public.computer_approvals add constraint computer_approvals_page_origin_check CHECK (((page_origin IS NULL) OR (length(page_origin) <= 300)));

alter table public.computer_approvals add constraint computer_approvals_pkey PRIMARY KEY (id);

alter table public.computer_audit_events add constraint computer_audit_events_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));

alter table public.computer_audit_events add constraint computer_audit_events_event_check CHECK (((length(btrim(event)) >= 1) AND (length(btrim(event)) <= 80)));

alter table public.computer_audit_events add constraint computer_audit_events_pkey PRIMARY KEY (id);

alter table public.computer_logins add constraint computer_logins_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 80)));

alter table public.computer_logins add constraint computer_logins_url_check CHECK (((url ~* '^https?://'::text) AND (char_length(url) <= 2048)));

alter table public.computer_logins add constraint computer_logins_host_check CHECK (((char_length(host) >= 1) AND (char_length(host) <= 253)));

alter table public.computer_logins add constraint computer_logins_pkey PRIMARY KEY (id);

alter table public.computer_sessions add constraint computer_sessions_target_url_check CHECK (((target_url IS NULL) OR ((target_url ~* '^https?://'::text) AND (char_length(target_url) <= 2048))));

alter table public.computer_login_credentials add constraint computer_login_credentials_username_sealed_check CHECK (((username_sealed ~~ 'v1.%'::text) AND (char_length(username_sealed) <= 2048)));

alter table public.computer_login_credentials add constraint computer_login_credentials_password_sealed_check CHECK (((password_sealed ~~ 'v1.%'::text) AND (char_length(password_sealed) <= 2048)));

alter table public.computer_login_credentials add constraint computer_login_credentials_key_fingerprint_check CHECK (((char_length(key_fingerprint) >= 8) AND (char_length(key_fingerprint) <= 64)));

alter table public.computer_login_credentials add constraint computer_login_credentials_login_url_check CHECK (((login_url IS NULL) OR ((login_url ~* '^https?://'::text) AND (char_length(login_url) <= 2048))));

alter table public.computer_login_credentials add constraint computer_login_credentials_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'needs_attention'::text])));

alter table public.computer_login_credentials add constraint computer_login_credentials_attention_reason_check CHECK (((attention_reason IS NULL) OR (char_length(attention_reason) <= 300)));

alter table public.computer_login_credentials add constraint computer_login_credentials_pkey PRIMARY KEY (login_id);

alter table public.ask_communication_styles add constraint ask_communication_styles_prompt_summary_check CHECK ((char_length(prompt_summary) <= 800));

alter table public.ask_communication_styles add constraint ask_communication_styles_sample_count_check CHECK ((sample_count >= 0));

alter table public.ask_communication_styles add constraint ask_communication_styles_pkey PRIMARY KEY (user_id);

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_seq_check CHECK ((seq >= 0));

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_kind_check CHECK ((kind = ANY (ARRAY['summary'::text, 'findings'::text, 'dictation'::text, 'action'::text])));

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_text_check CHECK (((length(text) >= 1) AND (length(text) <= 4000)));

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_pkey PRIMARY KEY (id);

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_proof_seq_kind_key UNIQUE (proof_id, kind, seq);

alter table public.ask_route_decisions add constraint ask_route_decisions_question_check CHECK (((length(question) >= 1) AND (length(question) <= 2000)));

alter table public.ask_route_decisions add constraint ask_route_decisions_pkey PRIMARY KEY (id);

alter table public.ask_job_context_cache add constraint ask_job_context_cache_pkey PRIMARY KEY (job_id);

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_kind_check CHECK ((kind = ANY (ARRAY['adjuster'::text, 'carrier'::text, 'pricing'::text, 'preference'::text, 'contact'::text, 'other'::text])));

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_label_check CHECK (((length(label) >= 1) AND (length(label) <= 200)));

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_detail_check CHECK (((length(detail) >= 1) AND (length(detail) <= 2000)));

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)));

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_pkey PRIMARY KEY (id);

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_label_kind_org UNIQUE (org_id, kind, label);

alter table public.ask_route_decisions add constraint ask_route_decisions_route_check CHECK ((route = ANY (ARRAY['fast'::text, 'deep'::text, 'skipped'::text])));

alter table public.computer_site_playbooks add constraint computer_site_playbooks_pkey PRIMARY KEY (id);

alter table public.computer_site_playbooks add constraint computer_site_playbooks_site_task UNIQUE (site, task_type);

alter table public.computer_playbook_outcomes add constraint computer_playbook_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['approve'::text, 'edit'::text, 'reject'::text])));

alter table public.computer_playbook_outcomes add constraint computer_playbook_outcomes_pkey PRIMARY KEY (id);

alter table public.computer_supply_orders add constraint computer_supply_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'awaiting_approval'::text, 'approved'::text, 'placed'::text, 'canceled'::text, 'failed'::text])));

alter table public.computer_supply_orders add constraint computer_supply_orders_pkey PRIMARY KEY (id);

alter table public.computer_supply_orders add constraint computer_supply_orders_order_key_unique UNIQUE (org_id, task_id, order_key_hash);

alter table public.computer_site_playbooks add constraint computer_site_playbooks_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])));

alter table public.computer_site_playbooks add constraint computer_site_playbooks_source_check CHECK ((source = ANY (ARRAY['success'::text, 'demonstration'::text, 'handoff'::text])));

alter table public.computer_site_playbooks add constraint computer_site_playbooks_version_check CHECK ((version >= 1));

alter table public.computer_practice_runs add constraint computer_practice_runs_site_check CHECK (((length(btrim(site)) >= 1) AND (length(btrim(site)) <= 120)));

alter table public.computer_practice_runs add constraint computer_practice_runs_task_key_check CHECK (((length(btrim(task_key)) >= 1) AND (length(btrim(task_key)) <= 80)));

alter table public.computer_practice_runs add constraint computer_practice_runs_task_type_check CHECK (((length(btrim(task_type)) >= 1) AND (length(btrim(task_type)) <= 60)));

alter table public.computer_practice_runs add constraint computer_practice_runs_mode_check CHECK ((mode = ANY (ARRAY['read_only'::text, 'stop_before_submit'::text])));

alter table public.computer_practice_runs add constraint computer_practice_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'needs_login'::text, 'skipped'::text])));

alter table public.computer_practice_runs add constraint computer_practice_runs_failed_step_check CHECK (((failed_step IS NULL) OR (failed_step >= 0)));

alter table public.computer_practice_runs add constraint computer_practice_runs_failure_reason_check CHECK (((failure_reason IS NULL) OR (length(failure_reason) <= 500)));

alter table public.computer_practice_runs add constraint computer_practice_runs_model_calls_check CHECK ((model_calls >= 0));

alter table public.computer_practice_runs add constraint computer_practice_runs_cost_nanos_check CHECK ((cost_nanos >= 0));

alter table public.computer_practice_runs add constraint computer_practice_runs_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0)));

alter table public.computer_practice_runs add constraint computer_practice_runs_pkey PRIMARY KEY (id);

alter table public.computer_practice_runs add constraint computer_practice_runs_once_per_day UNIQUE (org_id, run_date, task_key);

alter table public.computer_practice_screens add constraint computer_practice_screens_step_index_check CHECK ((step_index >= 0));

alter table public.computer_practice_screens add constraint computer_practice_screens_label_check CHECK (((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 200)));

alter table public.computer_practice_screens add constraint computer_practice_screens_jpeg_b64_check CHECK ((length(jpeg_b64) <= 600000));

alter table public.computer_practice_screens add constraint computer_practice_screens_pkey PRIMARY KEY (id);

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_site_check CHECK (((length(btrim(site)) >= 1) AND (length(btrim(site)) <= 120)));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_task_type_check CHECK (((length(btrim(task_type)) >= 1) AND (length(btrim(task_type)) <= 60)));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_source_check CHECK ((source = ANY (ARRAY['demonstration'::text, 'handoff'::text])));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_step_count_check CHECK ((step_count >= 0));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_review_note_check CHECK (((review_note IS NULL) OR (length(review_note) <= 500)));

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_pkey PRIMARY KEY (id);

alter table public.computer_route_decisions add constraint computer_route_decisions_step_check CHECK ((step >= 0));

alter table public.computer_route_decisions add constraint computer_route_decisions_route_check CHECK ((route = ANY (ARRAY['fast'::text, 'strong'::text, 'verify'::text, 'fallback'::text, 'replay'::text])));

alter table public.computer_route_decisions add constraint computer_route_decisions_model_check CHECK (((length(btrim(model)) >= 1) AND (length(btrim(model)) <= 120)));

alter table public.computer_route_decisions add constraint computer_route_decisions_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 200)));

alter table public.computer_route_decisions add constraint computer_route_decisions_pkey PRIMARY KEY (id);

alter table public.computer_sessions add constraint computer_sessions_purpose_check CHECK ((purpose = ANY (ARRAY['task'::text, 'login'::text, 'logout'::text, 'verify'::text])));

alter table public.org_billing add constraint org_billing_stripe_mrr_cents_check CHECK (((stripe_mrr_cents IS NULL) OR (stripe_mrr_cents >= 0)));

alter table public.org_billing add constraint org_billing_stripe_interval_check CHECK (((stripe_interval IS NULL) OR (stripe_interval = ANY (ARRAY['month'::text, 'year'::text]))));

alter table public.payments add constraint payments_kind_check CHECK ((kind = ANY (ARRAY['subscription'::text, 'credits'::text, 'refund'::text, 'usage'::text])));

alter table public.ask_answer_feedback add constraint ask_answer_feedback_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 1])));

alter table public.ask_answer_feedback add constraint ask_answer_feedback_reason_check CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['wrong'::text, 'incomplete'::text, 'not_on_file'::text, 'unclear'::text, 'other'::text]))));

alter table public.ask_answer_feedback add constraint ask_answer_feedback_comment_check CHECK (((comment IS NULL) OR (length(comment) <= 1000)));

alter table public.ask_answer_feedback add constraint ask_answer_feedback_pkey PRIMARY KEY (id);

alter table public.ask_answer_feedback add constraint ask_answer_feedback_one_per_person UNIQUE (question_id, user_id);

alter table public.ask_pinned_answers add constraint ask_pinned_answers_pkey PRIMARY KEY (id);

alter table public.ask_pinned_answers add constraint ask_pinned_answers_once UNIQUE (question_id);

alter table public.computer_sessions add constraint computer_sessions_provider_check CHECK ((provider = ANY (ARRAY['browserbase'::text, 'windows'::text, 'mock'::text])));

alter table public.ask_pending_actions add constraint ask_pending_actions_kind_check CHECK ((kind = ANY (ARRAY['send_job_sms'::text, 'revoke_access'::text])));

alter table public.ask_pending_actions add constraint ask_pending_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text, 'failed'::text])));

alter table public.ask_pending_actions add constraint ask_pending_actions_pkey PRIMARY KEY (id);

alter table public.job_progress_grants add constraint job_progress_grants_access_kind_check CHECK ((access_kind = ANY (ARRAY['homeowner'::text, 'subcontractor'::text])));

alter table public.computer_login_credentials add constraint computer_login_credentials_company_id_sealed_check CHECK (((company_id_sealed IS NULL) OR ((company_id_sealed ~~ 'v1.%'::text) AND (char_length(company_id_sealed) <= 2048))));

alter table public.demo_bookings add constraint demo_bookings_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'cancelled'::text])));

alter table public.demo_bookings add constraint demo_bookings_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)));

alter table public.demo_bookings add constraint demo_bookings_email_check CHECK (((char_length(email) >= 3) AND (char_length(email) <= 320)));

alter table public.demo_bookings add constraint demo_bookings_company_check CHECK (((char_length(company) >= 1) AND (char_length(company) <= 200)));

alter table public.demo_bookings add constraint demo_bookings_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));

alter table public.demo_bookings add constraint demo_bookings_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000)));

alter table public.demo_bookings add constraint demo_bookings_guest_time_zone_check CHECK (((guest_time_zone IS NULL) OR (char_length(guest_time_zone) <= 64)));

alter table public.demo_bookings add constraint demo_bookings_client_ip_check CHECK (((client_ip IS NULL) OR (char_length(client_ip) <= 128)));

alter table public.demo_bookings add constraint demo_bookings_pkey PRIMARY KEY (id);

alter table public.org_invites add constraint org_invites_phone_e164 CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)));

alter table public.org_invites add constraint org_invites_email_or_phone CHECK (((email IS NOT NULL) OR (phone IS NOT NULL)));

alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.orgs add constraint orgs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.org_members add constraint org_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.org_members add constraint org_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.device_credentials add constraint device_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.org_billing add constraint org_billing_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.org_billing add constraint org_billing_plan_code_fkey FOREIGN KEY (plan_code) REFERENCES billing_plans(code);

alter table public.payments add constraint payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.analytics_staff add constraint analytics_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.analytics_staff add constraint analytics_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table public.feature_usage_sessions add constraint feature_usage_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.feature_usage_sessions add constraint feature_usage_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.feature_usage_sessions add constraint feature_usage_sessions_feature_key_fkey FOREIGN KEY (feature_key) REFERENCES feature_catalog(key) ON UPDATE CASCADE;

alter table public.feature_usage_daily add constraint feature_usage_daily_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.feature_usage_daily add constraint feature_usage_daily_feature_key_fkey FOREIGN KEY (feature_key) REFERENCES feature_catalog(key) ON UPDATE CASCADE;

alter table public.org_billing_events add constraint org_billing_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.jobs add constraint jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id);

alter table public.jobs add constraint jobs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES auth.users(id);

alter table public.jobs add constraint jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table public.job_tasks add constraint job_tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id);

alter table public.job_tasks add constraint job_tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table public.job_tasks add constraint job_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);

alter table public.job_tasks add constraint job_tasks_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id);

alter table public.job_tasks add constraint job_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table public.job_assignments add constraint job_assignments_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id);

alter table public.job_assignments add constraint job_assignments_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table public.job_assignments add constraint job_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table public.job_assignments add constraint job_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);

alter table public.work_logs add constraint work_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id);

alter table public.work_logs add constraint work_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);

alter table public.work_logs add constraint work_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES job_tasks(id);

alter table public.work_logs add constraint work_logs_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);

alter table public.memory_events add constraint memory_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id);

alter table public.memory_events add constraint memory_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table public.media_objects add constraint media_objects_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.org_media_quotas add constraint org_media_quotas_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.media_upload_sessions add constraint media_upload_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.media_upload_sessions add constraint media_upload_sessions_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_objects(id) ON DELETE CASCADE;

alter table public.crm_counters add constraint crm_counters_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.crm_properties add constraint crm_properties_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.crm_properties add constraint crm_properties_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.crm_jobs add constraint crm_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.crm_jobs add constraint crm_jobs_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE SET NULL;

alter table public.crm_jobs add constraint crm_jobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.crm_jobs add constraint crm_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_parties add constraint job_parties_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_parties add constraint job_parties_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_parties add constraint job_parties_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_briefs add constraint job_briefs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_briefs add constraint job_briefs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_briefs add constraint job_briefs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_scope_items add constraint job_scope_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_scope_items add constraint job_scope_items_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_scope_items add constraint job_scope_items_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE CASCADE;

alter table public.job_scope_items add constraint job_scope_items_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_scope_items add constraint job_scope_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_acknowledgements add constraint job_acknowledgements_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_acknowledgements add constraint job_acknowledgements_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_acknowledgements add constraint job_acknowledgements_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE CASCADE;

alter table public.job_messages add constraint job_messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_messages add constraint job_messages_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_messages add constraint job_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_messages add constraint job_messages_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE SET NULL;

alter table public.job_messages add constraint job_messages_scope_item_id_fkey FOREIGN KEY (scope_item_id) REFERENCES job_scope_items(id) ON DELETE SET NULL;

alter table public.job_proofs add constraint job_proofs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_proofs add constraint job_proofs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_proofs add constraint job_proofs_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE CASCADE;

alter table public.job_proofs add constraint job_proofs_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_proof_frames add constraint job_proof_frames_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_proof_frames add constraint job_proof_frames_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.job_proof_questions add constraint job_proof_questions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_proof_questions add constraint job_proof_questions_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_proof_questions add constraint job_proof_questions_asked_by_fkey FOREIGN KEY (asked_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_evidence_access add constraint job_evidence_access_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_evidence_access add constraint job_evidence_access_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_evidence_access add constraint job_evidence_access_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.job_evidence_access add constraint job_evidence_access_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_evidence_access add constraint job_evidence_access_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE SET NULL;

alter table public.job_evidence_policy add constraint job_evidence_policy_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verifier_shares add constraint verifier_shares_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verifier_shares add constraint verifier_shares_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.verifier_shares add constraint verifier_shares_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.field_identity_codes add constraint field_identity_codes_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE CASCADE;

alter table public.job_party_claims add constraint job_party_claims_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_party_claims add constraint job_party_claims_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE CASCADE;

alter table public.job_party_claims add constraint job_party_claims_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES field_identities(id) ON DELETE CASCADE;

alter table public.field_sessions add constraint field_sessions_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES field_identities(id) ON DELETE CASCADE;

alter table public.job_intake add constraint job_intake_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_intake add constraint job_intake_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_intake add constraint job_intake_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.scope_documents add constraint scope_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.scope_documents add constraint scope_documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.scope_documents add constraint scope_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.scope_documents add constraint scope_documents_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_scope_items add constraint job_scope_items_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES scope_documents(id) ON DELETE SET NULL;

alter table public.job_proof_segments add constraint job_proof_segments_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_proof_segments add constraint job_proof_segments_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.evidence_download_policy add constraint evidence_download_policy_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.evidence_downloads add constraint evidence_downloads_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.evidence_downloads add constraint evidence_downloads_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.evidence_downloads add constraint evidence_downloads_share_id_fkey FOREIGN KEY (share_id) REFERENCES verifier_shares(id) ON DELETE SET NULL;

alter table public.evidence_downloads add constraint evidence_downloads_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.org_invites add constraint org_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.org_invites add constraint org_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table private.ai_usage_events add constraint ai_usage_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table private.ai_usage_events add constraint ai_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.metering_plan_versions add constraint metering_plan_versions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES metering_plans(id) ON DELETE CASCADE;

alter table public.org_metering add constraint org_metering_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.org_metering add constraint org_metering_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES metering_plan_versions(id);

alter table public.billing_period_jobs add constraint billing_period_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.billing_period_jobs add constraint billing_period_jobs_workflow_type_fkey FOREIGN KEY (workflow_type) REFERENCES qualifying_workflow_types(code);

alter table public.billing_period_statements add constraint billing_period_statements_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.metering_alerts add constraint metering_alerts_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_locations add constraint job_locations_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_locations add constraint job_locations_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_locations add constraint job_locations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES job_locations(id) ON DELETE CASCADE;

alter table public.verification_videos add constraint verification_videos_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_videos add constraint verification_videos_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.verification_videos add constraint verification_videos_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.verification_videos add constraint verification_videos_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE SET NULL;

alter table public.verification_videos add constraint verification_videos_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.video_processing_jobs add constraint video_processing_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.video_processing_jobs add constraint video_processing_jobs_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.video_processing_jobs add constraint video_processing_jobs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.video_processing_steps add constraint video_processing_steps_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.video_processing_steps add constraint video_processing_steps_processing_job_id_fkey FOREIGN KEY (processing_job_id) REFERENCES video_processing_jobs(id) ON DELETE CASCADE;

alter table public.video_processing_steps add constraint video_processing_steps_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.verification_scenes add constraint verification_scenes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_scenes add constraint verification_scenes_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.verification_scenes add constraint verification_scenes_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.verification_scenes add constraint verification_scenes_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.verification_frames add constraint verification_frames_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_frames add constraint verification_frames_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.verification_frames add constraint verification_frames_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES verification_scenes(id) ON DELETE SET NULL;

alter table public.verification_frames add constraint verification_frames_proof_frame_id_fkey FOREIGN KEY (proof_frame_id) REFERENCES job_proof_frames(id) ON DELETE SET NULL;

alter table public.verification_frames add constraint verification_frames_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES verification_frames(id) ON DELETE SET NULL;

alter table public.ai_analysis_runs add constraint ai_analysis_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_analysis_runs add constraint ai_analysis_runs_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.ai_analysis_runs add constraint ai_analysis_runs_processing_job_id_fkey FOREIGN KEY (processing_job_id) REFERENCES video_processing_jobs(id) ON DELETE SET NULL;

alter table public.frame_observations add constraint frame_observations_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.frame_observations add constraint frame_observations_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.frame_observations add constraint frame_observations_frame_id_fkey FOREIGN KEY (frame_id) REFERENCES verification_frames(id) ON DELETE CASCADE;

alter table public.frame_observations add constraint frame_observations_analysis_run_id_fkey FOREIGN KEY (analysis_run_id) REFERENCES ai_analysis_runs(id) ON DELETE CASCADE;

alter table public.frame_observations add constraint frame_observations_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES verification_scenes(id) ON DELETE SET NULL;

alter table public.temporal_change_events add constraint temporal_change_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.temporal_change_events add constraint temporal_change_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.temporal_change_events add constraint temporal_change_events_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES verification_scenes(id) ON DELETE SET NULL;

alter table public.temporal_change_events add constraint temporal_change_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.temporal_change_events add constraint temporal_change_events_before_video_id_fkey FOREIGN KEY (before_video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.temporal_change_events add constraint temporal_change_events_after_video_id_fkey FOREIGN KEY (after_video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.verification_rules add constraint verification_rules_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_results add constraint verification_results_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_results add constraint verification_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.verification_results add constraint verification_results_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.verification_results add constraint verification_results_change_event_id_fkey FOREIGN KEY (change_event_id) REFERENCES temporal_change_events(id) ON DELETE SET NULL;

alter table public.verification_results add constraint verification_results_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES verification_rules(id) ON DELETE SET NULL;

alter table public.verification_evidence add constraint verification_evidence_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_evidence add constraint verification_evidence_result_id_fkey FOREIGN KEY (result_id) REFERENCES verification_results(id) ON DELETE CASCADE;

alter table public.verification_evidence add constraint verification_evidence_frame_id_fkey FOREIGN KEY (frame_id) REFERENCES verification_frames(id) ON DELETE SET NULL;

alter table public.verification_evidence add constraint verification_evidence_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.verification_evidence add constraint verification_evidence_analysis_run_id_fkey FOREIGN KEY (analysis_run_id) REFERENCES ai_analysis_runs(id) ON DELETE SET NULL;

alter table public.human_review_tasks add constraint human_review_tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.human_review_tasks add constraint human_review_tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.human_review_tasks add constraint human_review_tasks_result_id_fkey FOREIGN KEY (result_id) REFERENCES verification_results(id) ON DELETE SET NULL;

alter table public.human_review_tasks add constraint human_review_tasks_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.human_review_tasks add constraint human_review_tasks_change_event_id_fkey FOREIGN KEY (change_event_id) REFERENCES temporal_change_events(id) ON DELETE SET NULL;

alter table public.human_review_tasks add constraint human_review_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.human_review_decisions add constraint human_review_decisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.human_review_decisions add constraint human_review_decisions_task_id_fkey FOREIGN KEY (task_id) REFERENCES human_review_tasks(id) ON DELETE CASCADE;

alter table public.human_review_decisions add constraint human_review_decisions_result_id_fkey FOREIGN KEY (result_id) REFERENCES verification_results(id) ON DELETE SET NULL;

alter table public.human_review_decisions add constraint human_review_decisions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public.verification_audit_events add constraint verification_audit_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_audit_events add constraint verification_audit_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.verification_audit_events add constraint verification_audit_events_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.verification_audit_events add constraint verification_audit_events_result_id_fkey FOREIGN KEY (result_id) REFERENCES verification_results(id) ON DELETE SET NULL;

alter table public.verification_audit_events add constraint verification_audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.verification_ai_costs add constraint verification_ai_costs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.verification_ai_costs add constraint verification_ai_costs_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.verification_ai_costs add constraint verification_ai_costs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.verification_ai_costs add constraint verification_ai_costs_analysis_run_id_fkey FOREIGN KEY (analysis_run_id) REFERENCES ai_analysis_runs(id) ON DELETE SET NULL;

alter table public.verification_usage_limits add constraint verification_usage_limits_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.video_clips add constraint video_clips_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.video_clips add constraint video_clips_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE CASCADE;

alter table public.video_clips add constraint video_clips_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.video_clips add constraint video_clips_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES verification_scenes(id) ON DELETE SET NULL;

alter table public.video_clips add constraint video_clips_change_event_id_fkey FOREIGN KEY (change_event_id) REFERENCES temporal_change_events(id) ON DELETE SET NULL;

alter table public.llm_verification_runs add constraint llm_verification_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.llm_verification_runs add constraint llm_verification_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.llm_verification_runs add constraint llm_verification_runs_video_id_fkey FOREIGN KEY (video_id) REFERENCES verification_videos(id) ON DELETE SET NULL;

alter table public.llm_verification_runs add constraint llm_verification_runs_change_event_id_fkey FOREIGN KEY (change_event_id) REFERENCES temporal_change_events(id) ON DELETE SET NULL;

alter table public.llm_verification_runs add constraint llm_verification_runs_result_id_fkey FOREIGN KEY (result_id) REFERENCES verification_results(id) ON DELETE SET NULL;

alter table public.llm_verification_runs add constraint llm_verification_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES llm_verification_runs(id) ON DELETE SET NULL;

alter table public.llm_verification_runs add constraint llm_verification_runs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES verification_rules(id) ON DELETE SET NULL;

alter table public.verification_videos add constraint verification_videos_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE SET NULL;

alter table public.verification_results add constraint verification_results_llm_run_id_fkey FOREIGN KEY (llm_run_id) REFERENCES llm_verification_runs(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.work_episodes add constraint work_episodes_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.work_episodes add constraint work_episodes_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_scope_item_id_fkey FOREIGN KEY (scope_item_id) REFERENCES job_scope_items(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_party_id_fkey FOREIGN KEY (party_id) REFERENCES job_parties(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_performer_id_fkey FOREIGN KEY (performer_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_rights_set_by_fkey FOREIGN KEY (rights_set_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.work_episodes add constraint work_episodes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_observations add constraint episode_observations_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_observations add constraint episode_observations_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_observations add constraint episode_observations_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.episode_observations add constraint episode_observations_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.episode_observations add constraint episode_observations_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_actions add constraint episode_actions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_actions add constraint episode_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_actions add constraint episode_actions_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.episode_actions add constraint episode_actions_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.episode_actions add constraint episode_actions_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_resources add constraint episode_resources_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_resources add constraint episode_resources_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_verifications add constraint episode_verifications_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_verifications add constraint episode_verifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_verifications add constraint episode_verifications_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_outcomes add constraint episode_outcomes_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_outcomes add constraint episode_outcomes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_outcomes add constraint episode_outcomes_responsible_party_id_fkey FOREIGN KEY (responsible_party_id) REFERENCES job_parties(id) ON DELETE SET NULL;

alter table public.episode_outcomes add constraint episode_outcomes_corrected_by_episode_id_fkey FOREIGN KEY (corrected_by_episode_id) REFERENCES work_episodes(id) ON DELETE SET NULL;

alter table public.episode_outcomes add constraint episode_outcomes_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_economics add constraint episode_economics_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_economics add constraint episode_economics_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.platform_staff add constraint platform_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.platform_staff add constraint platform_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table public.platform_admin_audit add constraint platform_admin_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);

alter table public.platform_admin_audit add constraint platform_admin_audit_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;

alter table public.internal_access_requests add constraint internal_access_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.internal_access_requests add constraint internal_access_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.job_proofs add constraint job_proofs_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.media_objects add constraint media_objects_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.legal_holds add constraint legal_holds_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.legal_holds add constraint legal_holds_released_by_fkey FOREIGN KEY (released_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.legal_hold_subjects add constraint legal_hold_subjects_hold_id_fkey FOREIGN KEY (hold_id) REFERENCES legal_holds(id) ON DELETE RESTRICT;

alter table public.legal_video_vault add constraint legal_video_vault_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT;

alter table public.legal_productions add constraint legal_productions_hold_id_fkey FOREIGN KEY (hold_id) REFERENCES legal_holds(id) ON DELETE RESTRICT;

alter table public.legal_productions add constraint legal_productions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.episode_world_states add constraint episode_world_states_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_world_states add constraint episode_world_states_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_world_states add constraint episode_world_states_source_proof_id_fkey FOREIGN KEY (source_proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.episode_evidence_assets add constraint episode_evidence_assets_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_evidence_assets add constraint episode_evidence_assets_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_evidence_assets add constraint episode_evidence_assets_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.episode_annotations add constraint episode_annotations_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_annotations add constraint episode_annotations_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES work_episodes(id) ON DELETE CASCADE;

alter table public.episode_immediate_outcomes add constraint episode_immediate_outcomes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.token_usage_events add constraint token_usage_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.token_usage_events add constraint token_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.verification_ai_costs add constraint verification_ai_costs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.crm_jobs add constraint crm_jobs_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.terms_acceptances add constraint terms_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.job_progress_grants add constraint job_progress_grants_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_progress_grants add constraint job_progress_grants_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_progress_grants add constraint job_progress_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.job_progress_grants add constraint job_progress_grants_share_id_fkey FOREIGN KEY (share_id) REFERENCES verifier_shares(id) ON DELETE SET NULL;

alter table public.safety_incidents add constraint safety_incidents_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.safety_incidents add constraint safety_incidents_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.safety_incidents add constraint safety_incidents_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.safety_incidents add constraint safety_incidents_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.safety_incidents add constraint safety_incidents_dismissed_by_fkey FOREIGN KEY (dismissed_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.wellness_session_state add constraint wellness_session_state_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.wellness_session_state add constraint wellness_session_state_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.daily_job_reports add constraint daily_job_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.daily_job_reports add constraint daily_job_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.trade_playbooks add constraint trade_playbooks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.trade_playbooks add constraint trade_playbooks_source_job_id_fkey FOREIGN KEY (source_job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.trade_playbooks add constraint trade_playbooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.trade_playbook_steps add constraint trade_playbook_steps_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES trade_playbooks(id) ON DELETE CASCADE;

alter table public.trade_playbook_sources add constraint trade_playbook_sources_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES trade_playbooks(id) ON DELETE CASCADE;

alter table public.trade_playbook_sources add constraint trade_playbook_sources_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.trade_playbook_sources add constraint trade_playbook_sources_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.ask_threads add constraint ask_threads_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_threads add constraint ask_threads_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_threads add constraint ask_threads_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.ask_threads add constraint ask_threads_share_id_fkey FOREIGN KEY (share_id) REFERENCES verifier_shares(id) ON DELETE CASCADE;

alter table public.job_proof_questions add constraint job_proof_questions_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES ask_threads(id) ON DELETE SET NULL;

alter table public.proof_live_sessions add constraint proof_live_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.proof_live_sessions add constraint proof_live_sessions_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.recording_acknowledgments add constraint recording_acknowledgments_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.recording_acknowledgments add constraint recording_acknowledgments_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.recording_acknowledgments add constraint recording_acknowledgments_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE SET NULL;

alter table public.recording_acknowledgments add constraint recording_acknowledgments_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.crm_agent_credentials add constraint crm_agent_credentials_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.crm_agent_credentials add constraint crm_agent_credentials_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.crm_agent_jobs add constraint crm_agent_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.crm_agent_jobs add constraint crm_agent_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.content_mentions add constraint content_mentions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.content_mentions add constraint content_mentions_mentioned_user_id_fkey FOREIGN KEY (mentioned_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.content_mentions add constraint content_mentions_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_job_notes add constraint ask_job_notes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_job_notes add constraint ask_job_notes_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_job_notes add constraint ask_job_notes_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES ask_threads(id) ON DELETE CASCADE;

alter table public.ask_job_notes add constraint ask_job_notes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.ask_job_notes add constraint ask_job_notes_share_id_fkey FOREIGN KEY (share_id) REFERENCES verifier_shares(id) ON DELETE CASCADE;

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_transcript_chunks add constraint ask_transcript_chunks_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.voiceprints add constraint voiceprints_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.voiceprints add constraint voiceprints_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.voiceprint_embeddings add constraint voiceprint_embeddings_voiceprint_id_fkey FOREIGN KEY (voiceprint_id) REFERENCES voiceprints(id) ON DELETE CASCADE;

alter table public.voice_consent_events add constraint voice_consent_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.voice_consent_events add constraint voice_consent_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.voice_enrollment_requests add constraint voice_enrollment_requests_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.speaker_identities add constraint speaker_identities_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.speaker_identities add constraint speaker_identities_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.speaker_identities add constraint speaker_identities_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.speaker_identities add constraint speaker_identities_voiceprint_id_fkey FOREIGN KEY (voiceprint_id) REFERENCES voiceprints(id) ON DELETE SET NULL;

alter table public.speaker_role_guesses add constraint speaker_role_guesses_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.speaker_role_guesses add constraint speaker_role_guesses_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.speaker_role_guesses add constraint speaker_role_guesses_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.clip_room_segments add constraint clip_room_segments_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.clip_room_segments add constraint clip_room_segments_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.clip_room_segments add constraint clip_room_segments_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.clip_room_segments add constraint clip_room_segments_location_id_fkey FOREIGN KEY (location_id) REFERENCES job_locations(id) ON DELETE SET NULL;

alter table public.job_chat_documents add constraint job_chat_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_chat_documents add constraint job_chat_documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_chat_documents add constraint job_chat_documents_context_job_id_fkey FOREIGN KEY (context_job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.job_chat_documents add constraint job_chat_documents_suggested_job_id_fkey FOREIGN KEY (suggested_job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.job_chat_documents add constraint job_chat_documents_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE SET NULL;

alter table public.job_chat_documents add constraint job_chat_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.ask_document_chunks add constraint ask_document_chunks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_document_chunks add constraint ask_document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES job_chat_documents(id) ON DELETE CASCADE;

alter table public.ask_document_chunks add constraint ask_document_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_document_rooms add constraint job_document_rooms_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.job_document_rooms add constraint job_document_rooms_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.job_document_rooms add constraint job_document_rooms_document_id_fkey FOREIGN KEY (document_id) REFERENCES job_chat_documents(id) ON DELETE CASCADE;

alter table public.ai_credit_ledger add constraint ai_credit_ledger_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_usage_allocations add constraint ai_usage_allocations_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_budget_price_spans add constraint ai_budget_price_spans_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_credit_pack_clawbacks add constraint ai_credit_pack_clawbacks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_credit_pack_disputes add constraint ai_credit_pack_disputes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.capture_upload_attempts add constraint capture_upload_attempts_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_turn_events add constraint ask_turn_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.analytics_campaign_sends add constraint analytics_campaign_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES analytics_campaigns(id) ON DELETE CASCADE;

alter table public.analytics_email_suppressions add constraint analytics_email_suppressions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES analytics_campaigns(id) ON DELETE SET NULL;

alter table public.ai_credit_auto_recharge_settings add constraint ai_credit_auto_recharge_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ai_credit_auto_recharges add constraint ai_credit_auto_recharges_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_sessions add constraint computer_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_tasks add constraint computer_tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_tasks add constraint computer_tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.computer_tasks add constraint computer_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_tasks add constraint computer_tasks_human_control_by_fkey FOREIGN KEY (human_control_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_tasks add constraint computer_tasks_session_id_fkey FOREIGN KEY (session_id) REFERENCES computer_sessions(id) ON DELETE SET NULL;

alter table public.computer_approvals add constraint computer_approvals_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_approvals add constraint computer_approvals_task_id_fkey FOREIGN KEY (task_id) REFERENCES computer_tasks(id) ON DELETE CASCADE;

alter table public.computer_approvals add constraint computer_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_audit_events add constraint computer_audit_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_logins add constraint computer_logins_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_logins add constraint computer_logins_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_logins add constraint computer_logins_last_signed_in_by_fkey FOREIGN KEY (last_signed_in_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_sessions add constraint computer_sessions_login_id_fkey FOREIGN KEY (login_id) REFERENCES computer_logins(id) ON DELETE SET NULL;

alter table public.computer_sessions add constraint computer_sessions_started_by_fkey FOREIGN KEY (started_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_login_credentials add constraint computer_login_credentials_login_id_fkey FOREIGN KEY (login_id) REFERENCES computer_logins(id) ON DELETE CASCADE;

alter table public.computer_login_credentials add constraint computer_login_credentials_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_login_credentials add constraint computer_login_credentials_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.computer_login_credentials add constraint computer_login_credentials_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.ask_communication_styles add constraint ask_communication_styles_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_analysis_chunks add constraint ask_analysis_chunks_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES job_proofs(id) ON DELETE CASCADE;

alter table public.ask_route_decisions add constraint ask_route_decisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;

alter table public.ask_route_decisions add constraint ask_route_decisions_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.ask_job_context_cache add constraint ask_job_context_cache_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_job_context_cache add constraint ask_job_context_cache_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_org_memory_facts add constraint ask_org_memory_facts_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_playbook_outcomes add constraint computer_playbook_outcomes_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_playbook_outcomes add constraint computer_playbook_outcomes_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES computer_site_playbooks(id) ON DELETE SET NULL;

alter table public.computer_supply_orders add constraint computer_supply_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_supply_orders add constraint computer_supply_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE SET NULL;

alter table public.computer_practice_runs add constraint computer_practice_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_practice_runs add constraint computer_practice_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES computer_tasks(id) ON DELETE SET NULL;

alter table public.computer_practice_runs add constraint computer_practice_runs_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES computer_site_playbooks(id) ON DELETE SET NULL;

alter table public.computer_practice_screens add constraint computer_practice_screens_run_id_fkey FOREIGN KEY (run_id) REFERENCES computer_practice_runs(id) ON DELETE CASCADE;

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_task_id_fkey FOREIGN KEY (task_id) REFERENCES computer_tasks(id) ON DELETE SET NULL;

alter table public.computer_playbook_drafts add constraint computer_playbook_drafts_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES computer_site_playbooks(id) ON DELETE SET NULL;

alter table public.computer_route_decisions add constraint computer_route_decisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;

alter table public.computer_route_decisions add constraint computer_route_decisions_task_id_fkey FOREIGN KEY (task_id) REFERENCES computer_tasks(id) ON DELETE CASCADE;

alter table public.job_proof_questions add constraint job_proof_questions_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES job_proof_questions(id) ON DELETE SET NULL;

alter table public.ask_answer_feedback add constraint ask_answer_feedback_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_answer_feedback add constraint ask_answer_feedback_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_answer_feedback add constraint ask_answer_feedback_question_id_fkey FOREIGN KEY (question_id) REFERENCES job_proof_questions(id) ON DELETE CASCADE;

alter table public.ask_answer_feedback add constraint ask_answer_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.ask_pinned_answers add constraint ask_pinned_answers_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_pinned_answers add constraint ask_pinned_answers_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_pinned_answers add constraint ask_pinned_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES job_proof_questions(id) ON DELETE CASCADE;

alter table public.ask_pinned_answers add constraint ask_pinned_answers_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.ask_pending_actions add constraint ask_pending_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

alter table public.ask_pending_actions add constraint ask_pending_actions_job_id_fkey FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE;

alter table public.ask_pending_actions add constraint ask_pending_actions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.ask_pending_actions add constraint ask_pending_actions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table public.job_progress_grants add constraint job_progress_grants_grantee_org_id_fkey FOREIGN KEY (grantee_org_id) REFERENCES orgs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_members_org_id_idx ON public.org_members USING btree (org_id);

CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON public.org_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS device_credentials_user_id_idx ON public.device_credentials USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS org_billing_stripe_customer ON public.org_billing USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS org_billing_stripe_subscription ON public.org_billing USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS payments_org_time ON public.payments USING btree (org_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS payments_payment_intent ON public.payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS payments_invoice ON public.payments USING btree (stripe_invoice_id) WHERE (stripe_invoice_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS feature_usage_sessions_started_idx ON public.feature_usage_sessions USING btree (started_at DESC);

CREATE INDEX IF NOT EXISTS feature_usage_sessions_org_idx ON public.feature_usage_sessions USING btree (org_id, started_at DESC);

CREATE INDEX IF NOT EXISTS feature_usage_sessions_feature_idx ON public.feature_usage_sessions USING btree (feature_key, started_at DESC);

CREATE INDEX IF NOT EXISTS feature_usage_sessions_user_idx ON public.feature_usage_sessions USING btree (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS feature_usage_daily_feature_idx ON public.feature_usage_daily USING btree (feature_key, day DESC);

CREATE INDEX IF NOT EXISTS org_billing_events_org_idx ON public.org_billing_events USING btree (org_id, effective_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS org_billing_events_at_idx ON public.org_billing_events USING btree (effective_at DESC);

CREATE INDEX IF NOT EXISTS jobs_org_status_idx ON public.jobs USING btree (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_org_lead_idx ON public.jobs USING btree (org_id, lead_id);

CREATE INDEX IF NOT EXISTS job_tasks_job_idx ON public.job_tasks USING btree (job_id, "position", created_at);

CREATE INDEX IF NOT EXISTS job_tasks_assignee_idx ON public.job_tasks USING btree (org_id, assigned_to, status);

CREATE UNIQUE INDEX IF NOT EXISTS job_assignments_active_unique ON public.job_assignments USING btree (job_id, user_id) WHERE (released_at IS NULL);

CREATE INDEX IF NOT EXISTS job_assignments_user_idx ON public.job_assignments USING btree (org_id, user_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS work_logs_job_idx ON public.work_logs USING btree (job_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS work_logs_author_idx ON public.work_logs USING btree (org_id, author_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS memory_events_feed_idx ON public.memory_events USING btree (org_id, seq DESC);

CREATE INDEX IF NOT EXISTS memory_events_job_idx ON public.memory_events USING btree (org_id, job_id, seq DESC);

CREATE INDEX IF NOT EXISTS memory_events_actor_idx ON public.memory_events USING btree (org_id, actor_id, seq DESC);

CREATE INDEX IF NOT EXISTS memory_events_type_idx ON public.memory_events USING btree (org_id, event_type, seq DESC);

CREATE INDEX IF NOT EXISTS memory_events_entity_idx ON public.memory_events USING btree (entity_type, entity_id, seq DESC);

CREATE INDEX IF NOT EXISTS memory_events_time_idx ON public.memory_events USING btree (org_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS media_objects_org_created_idx ON public.media_objects USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_objects_org_tier_idx ON public.media_objects USING btree (org_id, tier) WHERE (state = 'ready'::media_state);

CREATE INDEX IF NOT EXISTS media_objects_ref_idx ON public.media_objects USING btree (org_id, ref_type, ref_id) WHERE (ref_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS media_upload_sessions_org_idx ON public.media_upload_sessions USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS crm_properties_org_idx ON public.crm_properties USING btree (org_id, is_archived, postal_code);

CREATE INDEX IF NOT EXISTS crm_jobs_org_status_idx ON public.crm_jobs USING btree (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS crm_jobs_owner_idx ON public.crm_jobs USING btree (org_id, owner_id) WHERE (owner_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS crm_jobs_property_idx ON public.crm_jobs USING btree (property_id) WHERE (property_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS crm_jobs_claim_idx ON public.crm_jobs USING btree (org_id, claim_number) WHERE (claim_number IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS job_parties_token_unique ON public.job_parties USING btree (access_token);

CREATE INDEX IF NOT EXISTS job_parties_job_idx ON public.job_parties USING btree (job_id, created_at);

CREATE INDEX IF NOT EXISTS job_parties_org_idx ON public.job_parties USING btree (org_id, job_id);

CREATE INDEX IF NOT EXISTS job_briefs_job_idx ON public.job_briefs USING btree (job_id, revision DESC);

CREATE INDEX IF NOT EXISTS job_scope_job_idx ON public.job_scope_items USING btree (job_id, state, created_at);

CREATE INDEX IF NOT EXISTS job_scope_party_idx ON public.job_scope_items USING btree (party_id, state);

CREATE INDEX IF NOT EXISTS job_ack_job_idx ON public.job_acknowledgements USING btree (job_id, revision DESC);

CREATE INDEX IF NOT EXISTS job_messages_job_idx ON public.job_messages USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_messages_scope_idx ON public.job_messages USING btree (scope_item_id, created_at);

CREATE INDEX IF NOT EXISTS job_proofs_job_idx ON public.job_proofs USING btree (job_id, work_date DESC);

CREATE INDEX IF NOT EXISTS job_proofs_party_idx ON public.job_proofs USING btree (party_id, work_date DESC);

CREATE INDEX IF NOT EXISTS job_proofs_hash_idx ON public.job_proofs USING btree (job_id, content_hash) WHERE (content_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS job_proof_frames_proof_idx ON public.job_proof_frames USING btree (proof_id, at_seconds);

CREATE INDEX IF NOT EXISTS job_proof_questions_job_idx ON public.job_proof_questions USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_category_idx ON public.job_proofs USING btree (org_id, category, work_date DESC);

CREATE INDEX IF NOT EXISTS job_proofs_hold_idx ON public.job_proofs USING btree (org_id) WHERE legal_hold;

CREATE INDEX IF NOT EXISTS job_evidence_access_proof_idx ON public.job_evidence_access USING btree (proof_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS job_evidence_access_job_idx ON public.job_evidence_access USING btree (job_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_analysis_pending_idx ON public.job_proofs USING btree (org_id, work_date DESC) WHERE (analysis_status = ANY (ARRAY['queued'::text, 'failed'::text]));

CREATE INDEX IF NOT EXISTS verifier_shares_job_idx ON public.verifier_shares USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_narration_pending_idx ON public.job_proofs USING btree (org_id) WHERE (narration_status = ANY (ARRAY['queued'::text, 'failed'::text]));

CREATE INDEX IF NOT EXISTS field_identity_codes_lookup ON public.field_identity_codes USING btree (party_id, address, created_at DESC) WHERE (consumed_at IS NULL);

CREATE INDEX IF NOT EXISTS job_party_claims_identity_idx ON public.job_party_claims USING btree (identity_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS job_party_claims_org_idx ON public.job_party_claims USING btree (org_id);

CREATE INDEX IF NOT EXISTS field_sessions_identity_idx ON public.field_sessions USING btree (identity_id) WHERE (revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS job_intake_org_source_idx ON public.job_intake USING btree (org_id, source);

CREATE INDEX IF NOT EXISTS scope_documents_job_idx ON public.scope_documents USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proof_segments_proof_idx ON public.job_proof_segments USING btree (proof_id, idx);

CREATE INDEX IF NOT EXISTS evidence_downloads_proof_idx ON public.evidence_downloads USING btree (proof_id, created_at DESC);

CREATE INDEX IF NOT EXISTS evidence_downloads_requester_idx ON public.evidence_downloads USING btree (requested_by, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS org_invites_live_unique ON public.org_invites USING btree (org_id, lower(email)) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS org_invites_org_idx ON public.org_invites USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_labels_idx ON public.job_proofs USING gin (labels);

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_pricing_provider_model_from ON private.ai_model_pricing USING btree (provider, model, effective_from);

CREATE INDEX IF NOT EXISTS ai_model_pricing_lookup ON private.ai_model_pricing USING btree (provider, model, effective_from DESC) WHERE is_active;

CREATE INDEX IF NOT EXISTS compute_unit_config_active ON private.compute_unit_config USING btree (effective_from DESC) WHERE is_active;

CREATE INDEX IF NOT EXISTS ai_usage_events_org_time ON private.ai_usage_events USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_events_org_job ON private.ai_usage_events USING btree (org_id, job_id, created_at DESC) WHERE (job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_usage_events_org_workflow ON private.ai_usage_events USING btree (org_id, workflow_id, created_at DESC) WHERE (workflow_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_usage_events_org_agent ON private.ai_usage_events USING btree (org_id, agent_type, created_at DESC) WHERE (agent_type IS NOT NULL);

CREATE INDEX IF NOT EXISTS billing_period_jobs_org_period ON public.billing_period_jobs USING btree (org_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS metering_alerts_org_open ON public.metering_alerts USING btree (org_id, created_at DESC) WHERE (NOT acknowledged);

CREATE INDEX IF NOT EXISTS job_locations_job_idx ON public.job_locations USING btree (job_id, kind);

CREATE INDEX IF NOT EXISTS job_locations_parent_idx ON public.job_locations USING btree (parent_id);

CREATE INDEX IF NOT EXISTS verification_videos_org_idx ON public.verification_videos USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_videos_job_idx ON public.verification_videos USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_videos_status_idx ON public.verification_videos USING btree (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_videos_hash_idx ON public.verification_videos USING btree (org_id, content_hash) WHERE (content_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS video_processing_jobs_video_idx ON public.video_processing_jobs USING btree (video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS video_processing_jobs_status_idx ON public.video_processing_jobs USING btree (org_id, status, created_at DESC) WHERE (status = ANY (ARRAY['pending'::verification_step_status, 'running'::verification_step_status, 'failed'::verification_step_status]));

CREATE INDEX IF NOT EXISTS video_processing_steps_job_idx ON public.video_processing_steps USING btree (processing_job_id, stage);

CREATE INDEX IF NOT EXISTS video_processing_steps_status_idx ON public.video_processing_steps USING btree (org_id, status) WHERE (status = ANY (ARRAY['pending'::verification_step_status, 'running'::verification_step_status, 'failed'::verification_step_status]));

CREATE INDEX IF NOT EXISTS verification_scenes_video_idx ON public.verification_scenes USING btree (video_id, sequence_index);

CREATE INDEX IF NOT EXISTS verification_scenes_job_room_idx ON public.verification_scenes USING btree (job_id, room_type);

CREATE INDEX IF NOT EXISTS verification_frames_video_idx ON public.verification_frames USING btree (video_id, timestamp_seconds);

CREATE INDEX IF NOT EXISTS verification_frames_selected_idx ON public.verification_frames USING btree (video_id) WHERE (selected_for_analysis = true);

CREATE INDEX IF NOT EXISTS verification_frames_phash_idx ON public.verification_frames USING btree (org_id, perceptual_hash) WHERE (perceptual_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS verification_frames_scene_idx ON public.verification_frames USING btree (scene_id) WHERE (scene_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_analysis_runs_video_idx ON public.ai_analysis_runs USING btree (video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_analysis_runs_cache_idx ON public.ai_analysis_runs USING btree (org_id, input_digest) WHERE ((input_digest IS NOT NULL) AND (schema_valid = true));

CREATE INDEX IF NOT EXISTS ai_analysis_runs_org_cost_idx ON public.ai_analysis_runs USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS frame_observations_video_idx ON public.frame_observations USING btree (video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS frame_observations_frame_idx ON public.frame_observations USING btree (frame_id);

CREATE INDEX IF NOT EXISTS frame_observations_activities_idx ON public.frame_observations USING gin (work_activities);

CREATE INDEX IF NOT EXISTS temporal_change_events_job_idx ON public.temporal_change_events USING btree (job_id, first_observed_at);

CREATE INDEX IF NOT EXISTS temporal_change_events_activity_idx ON public.temporal_change_events USING btree (org_id, inferred_activity);

CREATE INDEX IF NOT EXISTS temporal_change_events_status_idx ON public.temporal_change_events USING btree (job_id, verification_status);

CREATE UNIQUE INDEX IF NOT EXISTS verification_rules_version_uidx ON public.verification_rules USING btree (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), activity_type, version);

CREATE INDEX IF NOT EXISTS verification_rules_activity_idx ON public.verification_rules USING btree (activity_type, is_active);

CREATE INDEX IF NOT EXISTS verification_results_job_idx ON public.verification_results USING btree (job_id, observed_at);

CREATE INDEX IF NOT EXISTS verification_results_status_idx ON public.verification_results USING btree (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_results_video_idx ON public.verification_results USING btree (video_id) WHERE (video_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS verification_evidence_result_idx ON public.verification_evidence USING btree (result_id);

CREATE INDEX IF NOT EXISTS verification_evidence_frame_idx ON public.verification_evidence USING btree (frame_id) WHERE (frame_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS human_review_tasks_org_status_idx ON public.human_review_tasks USING btree (org_id, status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS human_review_tasks_job_idx ON public.human_review_tasks USING btree (job_id, status);

CREATE INDEX IF NOT EXISTS human_review_decisions_task_idx ON public.human_review_decisions USING btree (task_id, created_at);

CREATE INDEX IF NOT EXISTS verification_audit_events_org_idx ON public.verification_audit_events USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_audit_events_video_idx ON public.verification_audit_events USING btree (video_id, created_at) WHERE (video_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS verification_audit_events_result_idx ON public.verification_audit_events USING btree (result_id, created_at) WHERE (result_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS verification_ai_costs_org_month_idx ON public.verification_ai_costs USING btree (org_id, period_month);

CREATE INDEX IF NOT EXISTS verification_ai_costs_video_idx ON public.verification_ai_costs USING btree (video_id) WHERE (video_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS video_clips_video_idx ON public.video_clips USING btree (video_id, start_seconds);

CREATE INDEX IF NOT EXISTS video_clips_job_idx ON public.video_clips USING btree (job_id);

CREATE INDEX IF NOT EXISTS llm_verification_runs_job_idx ON public.llm_verification_runs USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_verification_runs_change_idx ON public.llm_verification_runs USING btree (change_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_verification_runs_digest_idx ON public.llm_verification_runs USING btree (org_id, input_digest) WHERE ((input_digest IS NOT NULL) AND (schema_valid = true));

CREATE INDEX IF NOT EXISTS work_episodes_job_idx ON public.work_episodes USING btree (job_id, work_date DESC);

CREATE INDEX IF NOT EXISTS work_episodes_task_idx ON public.work_episodes USING btree (org_id, trade, task_key);

CREATE INDEX IF NOT EXISTS work_episodes_tier_idx ON public.work_episodes USING btree (org_id, tier DESC, data_rights);

CREATE INDEX IF NOT EXISTS episode_observations_episode_idx ON public.episode_observations USING btree (episode_id, phase, observed_at);

CREATE INDEX IF NOT EXISTS episode_actions_episode_idx ON public.episode_actions USING btree (episode_id, sequence);

CREATE INDEX IF NOT EXISTS episode_resources_episode_idx ON public.episode_resources USING btree (episode_id, kind);

CREATE INDEX IF NOT EXISTS episode_verifications_episode_idx ON public.episode_verifications USING btree (episode_id, verified_at);

CREATE INDEX IF NOT EXISTS episode_outcomes_episode_idx ON public.episode_outcomes USING btree (episode_id, observed_at);

CREATE INDEX IF NOT EXISTS episode_outcomes_kind_idx ON public.episode_outcomes USING btree (org_id, kind);

CREATE INDEX IF NOT EXISTS platform_admin_audit_created_at_idx ON public.platform_admin_audit USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS platform_admin_audit_actor_idx ON public.platform_admin_audit USING btree (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_admin_audit_org_idx ON public.platform_admin_audit USING btree (org_id, created_at DESC) WHERE (org_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS internal_access_requests_email_key ON public.internal_access_requests USING btree (lower(email));

CREATE INDEX IF NOT EXISTS internal_access_requests_status_idx ON public.internal_access_requests USING btree (status, last_requested_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_deleted_idx ON public.job_proofs USING btree (org_id, deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS media_objects_deleted_idx ON public.media_objects USING btree (org_id, deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS legal_holds_case_number_idx ON public.legal_holds USING btree (lower(case_number));

CREATE INDEX IF NOT EXISTS legal_holds_status_idx ON public.legal_holds USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS legal_hold_subjects_lookup_idx ON public.legal_hold_subjects USING btree (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS legal_video_vault_org_idx ON public.legal_video_vault USING btree (org_id, vaulted_at DESC);

CREATE INDEX IF NOT EXISTS legal_video_vault_job_idx ON public.legal_video_vault USING btree (job_id) WHERE (job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS legal_video_vault_deleted_idx ON public.legal_video_vault USING btree (org_id) WHERE (user_deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS user_activity_events_actor_idx ON public.user_activity_events USING btree (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS user_activity_events_org_idx ON public.user_activity_events USING btree (org_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS user_activity_events_action_idx ON public.user_activity_events USING btree (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS user_activity_events_resource_idx ON public.user_activity_events USING btree (resource_type, resource_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS legal_productions_hold_idx ON public.legal_productions USING btree (hold_id, created_at DESC);

CREATE INDEX IF NOT EXISTS episode_world_states_episode_idx ON public.episode_world_states USING btree (episode_id, kind);

CREATE INDEX IF NOT EXISTS episode_evidence_assets_episode_idx ON public.episode_evidence_assets USING btree (episode_id, kind);

CREATE UNIQUE INDEX IF NOT EXISTS episode_annotations_dedup ON public.episode_annotations USING btree (episode_id, kind, payload_hash);

CREATE INDEX IF NOT EXISTS episode_annotations_episode_idx ON public.episode_annotations USING btree (episode_id, created_at);

CREATE INDEX IF NOT EXISTS token_usage_events_org_time ON public.token_usage_events USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS token_usage_events_org_user_time ON public.token_usage_events USING btree (org_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS token_usage_events_org_feature_time ON public.token_usage_events USING btree (org_id, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS verification_ai_costs_org_user_idx ON public.verification_ai_costs USING btree (org_id, user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS crm_jobs_deleted_idx ON public.crm_jobs USING btree (org_id, deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS crm_audit_log_org_time_idx ON public.crm_audit_log USING btree (org_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS crm_audit_log_row_idx ON public.crm_audit_log USING btree (table_name, row_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS crm_audit_log_time_idx ON public.crm_audit_log USING btree (changed_at);

CREATE INDEX IF NOT EXISTS video_processing_jobs_lease_idx ON public.video_processing_jobs USING btree (status, lease_until) WHERE (status = ANY (ARRAY['pending'::verification_step_status, 'running'::verification_step_status]));

CREATE INDEX IF NOT EXISTS job_proofs_analysis_lease_idx ON public.job_proofs USING btree (analysis_status, analysis_lease_until) WHERE ((deleted_at IS NULL) AND (analysis_status = ANY (ARRAY['queued'::text, 'running'::text, 'failed'::text])));

CREATE INDEX IF NOT EXISTS terms_acceptances_user_idx ON public.terms_acceptances USING btree (user_id, accepted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS job_proofs_org_clip_id_uidx ON public.job_proofs USING btree (org_id, clip_id) WHERE (clip_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS job_proofs_clip_id_idx ON public.job_proofs USING btree (clip_id) WHERE (clip_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS job_progress_grants_user_idx ON public.job_progress_grants USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_progress_grants_org_idx ON public.job_progress_grants USING btree (org_id, job_id);

CREATE INDEX IF NOT EXISTS job_proofs_scheduled_purge_idx ON public.job_proofs USING btree (scheduled_purge_at) WHERE (scheduled_purge_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS job_progress_grants_last_accessed_idx ON public.job_progress_grants USING btree (job_id, last_accessed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS token_usage_events_created_at ON public.token_usage_events USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS safety_incidents_org_open_idx ON public.safety_incidents USING btree (org_id, status, created_at DESC) WHERE (status = 'open'::safety_incident_status);

CREATE INDEX IF NOT EXISTS safety_incidents_job_idx ON public.safety_incidents USING btree (job_id, created_at DESC) WHERE (job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS safety_incidents_proof_idx ON public.safety_incidents USING btree (proof_id) WHERE (proof_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS safety_incidents_org_created_idx ON public.safety_incidents USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS safety_incidents_rate_idx ON public.safety_incidents USING btree (org_id, job_id, category, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS wellness_session_state_job_clip_uidx ON public.wellness_session_state USING btree (org_id, job_id, clip_id) WHERE (clip_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS wellness_session_state_job_noclip_uidx ON public.wellness_session_state USING btree (org_id, job_id) WHERE (clip_id IS NULL);

CREATE INDEX IF NOT EXISTS wellness_session_state_org_job_idx ON public.wellness_session_state USING btree (org_id, job_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS daily_job_reports_org_day_idx ON public.daily_job_reports USING btree (org_id, local_day DESC);

CREATE INDEX IF NOT EXISTS daily_job_reports_status_idx ON public.daily_job_reports USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::daily_job_report_status, 'failed'::daily_job_report_status]));

CREATE INDEX IF NOT EXISTS trade_playbooks_org_updated_idx ON public.trade_playbooks USING btree (org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS trade_playbooks_org_trade_status_idx ON public.trade_playbooks USING btree (org_id, trade, status);

CREATE INDEX IF NOT EXISTS trade_playbooks_source_job_idx ON public.trade_playbooks USING btree (source_job_id) WHERE (source_job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS trade_playbook_steps_playbook_idx ON public.trade_playbook_steps USING btree (playbook_id, "position");

CREATE INDEX IF NOT EXISTS trade_playbook_sources_playbook_idx ON public.trade_playbook_sources USING btree (playbook_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trade_playbook_sources_job_idx ON public.trade_playbook_sources USING btree (job_id) WHERE (job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ask_threads_user_job_idx ON public.ask_threads USING btree (owner_user_id, job_id, last_message_at DESC NULLS LAST, created_at DESC) WHERE (owner_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ask_threads_share_job_idx ON public.ask_threads USING btree (share_id, job_id, last_message_at DESC NULLS LAST, created_at DESC) WHERE (share_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ask_threads_job_idx ON public.ask_threads USING btree (job_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS job_proof_questions_thread_idx ON public.job_proof_questions USING btree (thread_id, created_at) WHERE (thread_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS proof_live_sessions_org_job_clip_uidx ON public.proof_live_sessions USING btree (org_id, job_id, clip_id);

CREATE INDEX IF NOT EXISTS proof_live_sessions_job_live_idx ON public.proof_live_sessions USING btree (org_id, job_id, status, last_part_at DESC);

CREATE INDEX IF NOT EXISTS recording_acknowledgments_job_day_idx ON public.recording_acknowledgments USING btree (job_id, work_date, disclosure_version);

CREATE INDEX IF NOT EXISTS recording_acknowledgments_party_day_idx ON public.recording_acknowledgments USING btree (job_id, actor_party_id, work_date, disclosure_version) WHERE (actor_party_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS recording_acknowledgments_org_idx ON public.recording_acknowledgments USING btree (org_id, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS crm_agent_jobs_org_queued_idx ON public.crm_agent_jobs USING btree (org_id, status, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX IF NOT EXISTS crm_agent_jobs_org_system_idx ON public.crm_agent_jobs USING btree (org_id, system, created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_handle_idx ON public.profiles USING btree (handle) WHERE (handle IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS content_mentions_once ON public.content_mentions USING btree (source, source_id, mentioned_user_id);

CREATE INDEX IF NOT EXISTS content_mentions_person_idx ON public.content_mentions USING btree (org_id, mentioned_user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ask_job_notes_owner_note_idx ON public.ask_job_notes USING btree (job_id, owner_user_id, lower(btrim(note))) WHERE (owner_user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ask_job_notes_share_note_idx ON public.ask_job_notes USING btree (job_id, share_id, lower(btrim(note))) WHERE (share_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ask_job_notes_thread_idx ON public.ask_job_notes USING btree (thread_id, created_at);

CREATE INDEX IF NOT EXISTS job_proofs_summary_pending_idx ON public.job_proofs USING btree (received_at) WHERE ((deleted_at IS NULL) AND (summary_status = ANY (ARRAY['stale'::text, 'queued'::text, 'running'::text])));

CREATE INDEX IF NOT EXISTS ask_transcript_chunks_job_idx ON public.ask_transcript_chunks USING btree (org_id, job_id);

CREATE INDEX IF NOT EXISTS ask_transcript_chunks_proof_idx ON public.ask_transcript_chunks USING btree (proof_id, start_sec);

CREATE INDEX IF NOT EXISTS ask_transcript_chunks_fts_idx ON public.ask_transcript_chunks USING gin (fts);

CREATE INDEX IF NOT EXISTS voice_consent_events_user_idx ON public.voice_consent_events USING btree (org_id, user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS voice_enrollment_requests_one_pending_idx ON public.voice_enrollment_requests USING btree (subject_user_id) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS speaker_identities_job_idx ON public.speaker_identities USING btree (job_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS job_locations_room_key_idx ON public.job_locations USING btree (job_id, room_key) WHERE (room_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS clip_room_segments_job_idx ON public.clip_room_segments USING btree (job_id, room_key);

CREATE INDEX IF NOT EXISTS clip_room_segments_location_idx ON public.clip_room_segments USING btree (location_id) WHERE (location_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS job_chat_documents_job_idx ON public.job_chat_documents USING btree (org_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_chat_documents_context_idx ON public.job_chat_documents USING btree (org_id, context_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_document_chunks_job_idx ON public.ask_document_chunks USING btree (org_id, job_id);

CREATE INDEX IF NOT EXISTS ask_document_chunks_fts_idx ON public.ask_document_chunks USING gin (fts);

CREATE INDEX IF NOT EXISTS job_document_rooms_document_idx ON public.job_document_rooms USING btree (document_id);

CREATE INDEX IF NOT EXISTS job_document_rooms_job_idx ON public.job_document_rooms USING btree (org_id, job_id);

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_stripe_event_uidx ON public.ai_credit_ledger USING btree (stripe_event_id) WHERE (stripe_event_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_request_uidx ON public.ai_credit_ledger USING btree (org_id, request_id) WHERE (request_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_credit_ledger_org_idx ON public.ai_credit_ledger USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_allocations_org_created_idx ON public.ai_usage_allocations USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_budget_price_spans_org_idx ON public.ai_budget_price_spans USING btree (org_id, effective_from);

CREATE INDEX IF NOT EXISTS job_proofs_ai_budget_hold_idx ON public.job_proofs USING btree (org_id, received_at) WHERE ((ai_budget_hold = true) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_price_spans_one_open_idx ON public.ai_budget_price_spans USING btree (org_id) WHERE (effective_to IS NULL);

CREATE INDEX IF NOT EXISTS ai_credit_ledger_charge_idx ON public.ai_credit_ledger USING btree (org_id, stripe_charge_id) WHERE (stripe_charge_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_credit_pack_disputes_charge_idx ON public.ai_credit_pack_disputes USING btree (org_id, stripe_charge_id);

CREATE INDEX IF NOT EXISTS capture_upload_attempts_started_idx ON public.capture_upload_attempts USING btree (started_at);

CREATE INDEX IF NOT EXISTS ask_turn_events_created_idx ON public.ask_turn_events USING btree (created_at);

CREATE INDEX IF NOT EXISTS analytics_campaign_sends_campaign_idx ON public.analytics_campaign_sends USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS token_usage_events_unpriced ON public.token_usage_events USING btree (created_at DESC) WHERE ((cost_nanos = 0) AND (total_tokens > 0));

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_auto_recharges_idem_uidx ON public.ai_credit_auto_recharges USING btree (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_auto_recharges_pi_uidx ON public.ai_credit_auto_recharges USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_auto_recharges_pending_uidx ON public.ai_credit_auto_recharges USING btree (org_id) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS ai_credit_auto_recharges_org_idx ON public.ai_credit_auto_recharges USING btree (org_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS computer_sessions_one_live_per_org ON public.computer_sessions USING btree (org_id) WHERE (status = ANY (ARRAY['starting'::text, 'active'::text]));

CREATE INDEX IF NOT EXISTS computer_sessions_org_context_idx ON public.computer_sessions USING btree (org_id, provider, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS computer_tasks_one_active_per_org ON public.computer_tasks USING btree (org_id) WHERE (status = ANY (ARRAY['running'::text, 'awaiting_approval'::text, 'needs_you'::text]));

CREATE INDEX IF NOT EXISTS computer_tasks_queue_idx ON public.computer_tasks USING btree (created_at) WHERE (status = 'queued'::text);

CREATE INDEX IF NOT EXISTS computer_tasks_org_job_idx ON public.computer_tasks USING btree (org_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS computer_approvals_task_idx ON public.computer_approvals USING btree (task_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS computer_audit_events_task_idx ON public.computer_audit_events USING btree (task_id, id);

CREATE INDEX IF NOT EXISTS computer_audit_events_org_idx ON public.computer_audit_events USING btree (org_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS computer_logins_org_host_key ON public.computer_logins USING btree (org_id, lower(host));

CREATE INDEX IF NOT EXISTS computer_login_credentials_org_idx ON public.computer_login_credentials USING btree (org_id);

CREATE INDEX IF NOT EXISTS ask_communication_styles_updated_idx ON public.ask_communication_styles USING btree (updated_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_narration_lease_idx ON public.job_proofs USING btree (narration_status, narration_lease_until) WHERE ((deleted_at IS NULL) AND ((narration_status IS NULL) OR (narration_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text]))));

CREATE INDEX IF NOT EXISTS job_proofs_transcript_lease_idx ON public.job_proofs USING btree (transcript_status, transcript_lease_until) WHERE ((deleted_at IS NULL) AND ((transcript_status IS NULL) OR (transcript_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text]))));

CREATE INDEX IF NOT EXISTS ask_analysis_chunks_job_idx ON public.ask_analysis_chunks USING btree (org_id, job_id);

CREATE INDEX IF NOT EXISTS ask_analysis_chunks_fts_idx ON public.ask_analysis_chunks USING gin (fts);

CREATE INDEX IF NOT EXISTS ask_transcript_chunks_embedding_idx ON public.ask_transcript_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS ask_analysis_chunks_embedding_idx ON public.ask_analysis_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS ask_route_decisions_job_idx ON public.ask_route_decisions USING btree (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_route_decisions_org_idx ON public.ask_route_decisions USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_job_context_cache_org_idx ON public.ask_job_context_cache USING btree (org_id, rebuilt_at DESC);

CREATE INDEX IF NOT EXISTS ask_org_memory_facts_org_kind_idx ON public.ask_org_memory_facts USING btree (org_id, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS ask_org_memory_facts_org_updated_idx ON public.ask_org_memory_facts USING btree (org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS computer_site_playbooks_site_idx ON public.computer_site_playbooks USING btree (site);

CREATE INDEX IF NOT EXISTS computer_playbook_outcomes_org_idx ON public.computer_playbook_outcomes USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS computer_supply_orders_org_created_idx ON public.computer_supply_orders USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS computer_supply_orders_job_idx ON public.computer_supply_orders USING btree (job_id);

CREATE INDEX IF NOT EXISTS computer_practice_runs_date_idx ON public.computer_practice_runs USING btree (run_date DESC, site, task_key);

CREATE INDEX IF NOT EXISTS computer_practice_screens_run_idx ON public.computer_practice_screens USING btree (run_id, step_index);

CREATE INDEX IF NOT EXISTS computer_playbook_drafts_status_idx ON public.computer_playbook_drafts USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS computer_route_decisions_task_idx ON public.computer_route_decisions USING btree (task_id, step);

CREATE INDEX IF NOT EXISTS computer_route_decisions_org_idx ON public.computer_route_decisions USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proof_questions_supersedes_idx ON public.job_proof_questions USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ask_answer_feedback_org_idx ON public.ask_answer_feedback USING btree (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_pinned_answers_job_idx ON public.ask_pinned_answers USING btree (org_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_pending_actions_job_idx ON public.ask_pending_actions USING btree (org_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_progress_grants_grantee_org_idx ON public.job_progress_grants USING btree (grantee_org_id) WHERE (grantee_org_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_slot_booked_uniq ON public.demo_bookings USING btree (slot_start) WHERE (status = 'booked'::text);

CREATE UNIQUE INDEX IF NOT EXISTS org_invites_live_phone_unique ON public.org_invites USING btree (org_id, phone) WHERE ((status = 'pending'::text) AND (phone IS NOT NULL));

CREATE TRIGGER model_costs_touch BEFORE UPDATE ON private.model_costs FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER org_billing_touch BEFORE UPDATE ON public.org_billing FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER jobs_assign_number BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION memory.assign_job_number();

CREATE TRIGGER jobs_stamp_lifecycle BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION memory.stamp_job_lifecycle();

CREATE TRIGGER jobs_touch BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION memory.touch_updated_at();

CREATE TRIGGER jobs_capture AFTER INSERT OR DELETE OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION memory.capture('job');

CREATE TRIGGER feature_usage_rollup AFTER INSERT OR UPDATE OF active_ms, interactions ON public.feature_usage_sessions FOR EACH ROW EXECUTE FUNCTION private.rollup_feature_usage();

CREATE TRIGGER org_billing_history AFTER INSERT OR UPDATE ON public.org_billing FOR EACH ROW EXECUTE FUNCTION private.record_billing_event();

CREATE TRIGGER orgs_ensure_metering AFTER INSERT ON public.orgs FOR EACH ROW EXECUTE FUNCTION private.ensure_org_metering();

CREATE TRIGGER llm_verification_runs_immutable BEFORE DELETE OR UPDATE ON public.llm_verification_runs FOR EACH ROW EXECUTE FUNCTION private.llm_verification_runs_append_only();

CREATE TRIGGER crm_jobs_assign_number BEFORE INSERT ON public.crm_jobs FOR EACH ROW EXECUTE FUNCTION private.assign_job_number();

CREATE TRIGGER crm_properties_touch BEFORE UPDATE ON public.crm_properties FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER crm_properties_freeze BEFORE UPDATE ON public.crm_properties FOR EACH ROW EXECUTE FUNCTION private.freeze_ownership();

CREATE TRIGGER crm_jobs_touch BEFORE UPDATE ON public.crm_jobs FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER crm_jobs_freeze BEFORE UPDATE ON public.crm_jobs FOR EACH ROW EXECUTE FUNCTION private.freeze_ownership();

CREATE TRIGGER job_tasks_stamp_completion BEFORE UPDATE ON public.job_tasks FOR EACH ROW EXECUTE FUNCTION memory.stamp_task_completion();

CREATE TRIGGER job_tasks_touch BEFORE UPDATE ON public.job_tasks FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER job_assignments_touch BEFORE UPDATE ON public.job_assignments FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER work_logs_touch BEFORE UPDATE ON public.work_logs FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER memory_events_immutable BEFORE DELETE OR UPDATE ON public.memory_events FOR EACH ROW EXECUTE FUNCTION memory.reject_mutation();

CREATE TRIGGER memory_events_no_truncate BEFORE TRUNCATE ON public.memory_events FOR EACH STATEMENT EXECUTE FUNCTION memory.reject_mutation();

CREATE TRIGGER job_briefs_number BEFORE INSERT ON public.job_briefs FOR EACH ROW EXECUTE FUNCTION private.job_brief_next_revision();

CREATE TRIGGER job_briefs_immutable BEFORE DELETE OR UPDATE ON public.job_briefs FOR EACH ROW EXECUTE FUNCTION private.job_briefs_append_only();

CREATE TRIGGER job_messages_immutable BEFORE DELETE OR UPDATE ON public.job_messages FOR EACH ROW EXECUTE FUNCTION private.job_messages_append_only();

CREATE TRIGGER job_proof_questions_immutable BEFORE DELETE ON public.job_proof_questions FOR EACH ROW EXECUTE FUNCTION private.job_proof_questions_append_only();

CREATE TRIGGER job_evidence_access_immutable BEFORE DELETE OR UPDATE ON public.job_evidence_access FOR EACH ROW EXECUTE FUNCTION private.job_evidence_access_append_only();

CREATE TRIGGER job_locations_acyclic BEFORE INSERT OR UPDATE OF parent_id ON public.job_locations FOR EACH ROW EXECUTE FUNCTION private.job_location_no_cycle();

CREATE TRIGGER work_episodes_touch BEFORE UPDATE ON public.work_episodes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER episode_verifications_immutable BEFORE DELETE OR UPDATE ON public.episode_verifications FOR EACH ROW EXECUTE FUNCTION private.episode_verifications_append_only();

CREATE TRIGGER evidence_downloads_settle BEFORE UPDATE ON public.evidence_downloads FOR EACH ROW EXECUTE FUNCTION private.evidence_downloads_settle_once();

CREATE TRIGGER human_review_decisions_immutable BEFORE DELETE OR UPDATE ON public.human_review_decisions FOR EACH ROW EXECUTE FUNCTION private.human_review_decisions_append_only();

CREATE TRIGGER verification_audit_immutable BEFORE DELETE OR UPDATE ON public.verification_audit_events FOR EACH ROW EXECUTE FUNCTION private.verification_audit_append_only();

CREATE TRIGGER verification_videos_touch BEFORE UPDATE ON public.verification_videos FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER video_processing_jobs_touch BEFORE UPDATE ON public.video_processing_jobs FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER video_processing_steps_touch BEFORE UPDATE ON public.video_processing_steps FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER verification_scenes_touch BEFORE UPDATE ON public.verification_scenes FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER verification_results_touch BEFORE UPDATE ON public.verification_results FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER human_review_tasks_touch BEFORE UPDATE ON public.human_review_tasks FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER crm_jobs_memory_capture AFTER INSERT OR DELETE OR UPDATE ON public.crm_jobs FOR EACH ROW EXECUTE FUNCTION memory.capture('job');

CREATE TRIGGER job_tasks_capture AFTER INSERT OR DELETE OR UPDATE ON public.job_tasks FOR EACH ROW EXECUTE FUNCTION memory.capture('task');

CREATE TRIGGER job_assignments_capture AFTER INSERT OR DELETE OR UPDATE ON public.job_assignments FOR EACH ROW EXECUTE FUNCTION memory.capture('assignment');

CREATE TRIGGER work_logs_capture AFTER INSERT OR DELETE OR UPDATE ON public.work_logs FOR EACH ROW EXECUTE FUNCTION memory.capture('work_log');

CREATE TRIGGER legal_holds_guard BEFORE DELETE OR UPDATE ON public.legal_holds FOR EACH ROW EXECUTE FUNCTION private.legal_holds_guard();

CREATE TRIGGER legal_hold_subjects_immutable BEFORE DELETE OR UPDATE ON public.legal_hold_subjects FOR EACH ROW EXECUTE FUNCTION private.legal_append_only();

CREATE TRIGGER legal_video_vault_guard BEFORE DELETE OR UPDATE ON public.legal_video_vault FOR EACH ROW EXECUTE FUNCTION private.legal_vault_guard();

CREATE TRIGGER user_activity_events_immutable BEFORE DELETE OR UPDATE ON public.user_activity_events FOR EACH ROW EXECUTE FUNCTION private.legal_append_only();

CREATE TRIGGER legal_productions_immutable BEFORE DELETE OR UPDATE ON public.legal_productions FOR EACH ROW EXECUTE FUNCTION private.legal_append_only();

CREATE TRIGGER job_proofs_forbid_destroy BEFORE DELETE ON public.job_proofs FOR EACH ROW EXECUTE FUNCTION private.job_proofs_forbid_destroy();

CREATE TRIGGER media_objects_forbid_destroy BEFORE DELETE ON public.media_objects FOR EACH ROW EXECUTE FUNCTION private.media_objects_forbid_destroy();

CREATE TRIGGER episode_world_states_touch BEFORE UPDATE ON public.episode_world_states FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER episode_evidence_assets_touch BEFORE UPDATE ON public.episode_evidence_assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER episode_annotations_immutable BEFORE DELETE OR UPDATE ON public.episode_annotations FOR EACH ROW EXECUTE FUNCTION private.episode_annotations_append_only();

CREATE TRIGGER episode_immediate_outcomes_touch BEFORE UPDATE ON public.episode_immediate_outcomes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER org_members_guard_product_seat BEFORE INSERT OR UPDATE OF role ON public.org_members FOR EACH ROW EXECUTE FUNCTION private.org_members_guard_product_seat();

CREATE TRIGGER org_members_seat_allowance BEFORE INSERT OR UPDATE OF role, usage_intents ON public.org_members FOR EACH ROW EXECUTE FUNCTION private.enforce_field_capture_seat_limit();

CREATE TRIGGER org_invites_seat_allowance BEFORE INSERT OR UPDATE OF role, status ON public.org_invites FOR EACH ROW EXECUTE FUNCTION private.enforce_field_capture_seat_limit();

CREATE TRIGGER job_proofs_guard_budget_hold BEFORE UPDATE ON public.job_proofs FOR EACH ROW EXECUTE FUNCTION private.job_proofs_guard_budget_hold();

CREATE TRIGGER computer_audit_events_no_update BEFORE DELETE OR UPDATE ON public.computer_audit_events FOR EACH ROW EXECUTE FUNCTION computer_audit_events_append_only();

CREATE TRIGGER computer_audit_events_no_truncate BEFORE TRUNCATE ON public.computer_audit_events FOR EACH STATEMENT EXECUTE FUNCTION computer_audit_events_append_only();

CREATE TRIGGER job_proofs_first_analysed BEFORE INSERT OR UPDATE OF analysed_at, first_analysed_at ON public.job_proofs FOR EACH ROW EXECUTE FUNCTION private.job_proofs_first_analysed();

CREATE TRIGGER verifier_shares_revoke_grants AFTER UPDATE OF revoked_at ON public.verifier_shares FOR EACH ROW EXECUTE FUNCTION private.revoke_job_progress_grants_on_share();

alter table public.profiles enable row level security;

alter table public.orgs enable row level security;

alter table public.org_members enable row level security;

alter table public.device_credentials enable row level security;

alter table public.billing_plans enable row level security;

alter table public.org_billing enable row level security;

alter table public.payments enable row level security;

alter table public.analytics_staff enable row level security;

alter table public.feature_catalog enable row level security;

alter table public.feature_usage_sessions enable row level security;

alter table public.feature_usage_daily enable row level security;

alter table public.org_billing_events enable row level security;

alter table public.jobs enable row level security;

alter table public.job_tasks enable row level security;

alter table public.job_assignments enable row level security;

alter table public.work_logs enable row level security;

alter table public.memory_events enable row level security;

alter table public.schema_migrations enable row level security; alter table public.schema_migrations force row level security;

alter table public.media_objects enable row level security;

alter table public.org_media_quotas enable row level security;

alter table public.media_upload_sessions enable row level security;

alter table public.crm_counters enable row level security;

alter table public.crm_properties enable row level security;

alter table public.crm_jobs enable row level security;

alter table public.job_parties enable row level security;

alter table public.job_briefs enable row level security;

alter table public.job_scope_items enable row level security;

alter table public.job_acknowledgements enable row level security;

alter table public.job_messages enable row level security;

alter table public.job_proofs enable row level security;

alter table public.job_proof_frames enable row level security;

alter table public.job_proof_questions enable row level security;

alter table public.job_evidence_access enable row level security;

alter table public.job_evidence_policy enable row level security;

alter table public.verifier_shares enable row level security;

alter table public.field_identities enable row level security;

alter table public.field_identity_codes enable row level security;

alter table public.job_party_claims enable row level security;

alter table public.field_sessions enable row level security;

alter table public.job_intake enable row level security;

alter table public.scope_documents enable row level security;

alter table public.job_proof_segments enable row level security;

alter table public.evidence_download_policy enable row level security;

alter table public.evidence_downloads enable row level security;

alter table public.org_invites enable row level security;

alter table private.ai_model_pricing enable row level security;

alter table private.compute_unit_config enable row level security;

alter table private.ai_usage_events enable row level security;

alter table public.qualifying_workflow_types enable row level security;

alter table public.metering_plans enable row level security;

alter table public.metering_plan_versions enable row level security;

alter table public.org_metering enable row level security;

alter table public.billing_period_jobs enable row level security;

alter table public.billing_period_statements enable row level security;

alter table public.metering_alerts enable row level security;

alter table public.job_locations enable row level security;

alter table public.verification_videos enable row level security;

alter table public.video_processing_jobs enable row level security;

alter table public.video_processing_steps enable row level security;

alter table public.verification_scenes enable row level security;

alter table public.verification_frames enable row level security;

alter table public.ai_analysis_runs enable row level security;

alter table public.frame_observations enable row level security;

alter table public.temporal_change_events enable row level security;

alter table public.verification_rules enable row level security;

alter table public.verification_results enable row level security;

alter table public.verification_evidence enable row level security;

alter table public.human_review_tasks enable row level security;

alter table public.human_review_decisions enable row level security;

alter table public.verification_audit_events enable row level security;

alter table public.verification_ai_costs enable row level security;

alter table public.verification_usage_limits enable row level security;

alter table public.video_clips enable row level security;

alter table public.llm_verification_runs enable row level security;

alter table public.network_erasures enable row level security;

alter table public.work_episodes enable row level security;

alter table public.episode_observations enable row level security;

alter table public.episode_actions enable row level security;

alter table public.episode_resources enable row level security;

alter table public.episode_verifications enable row level security;

alter table public.episode_outcomes enable row level security;

alter table public.episode_economics enable row level security;

alter table public.platform_staff enable row level security;

alter table public.platform_admin_audit enable row level security;

alter table public.internal_staff_totp enable row level security;

alter table public.internal_access_requests enable row level security;

alter table public.legal_holds enable row level security;

alter table public.legal_hold_subjects enable row level security;

alter table public.legal_video_vault enable row level security;

alter table public.user_activity_events enable row level security;

alter table public.legal_productions enable row level security;

alter table public.episode_world_states enable row level security;

alter table public.episode_evidence_assets enable row level security;

alter table public.episode_annotations enable row level security;

alter table public.episode_immediate_outcomes enable row level security;

alter table public.token_usage_events enable row level security;

alter table public.crm_audit_log enable row level security;

alter table public.terms_acceptances enable row level security;

alter table public.atmosphere_migrations enable row level security; alter table public.atmosphere_migrations force row level security;

alter table public.job_progress_grants enable row level security;

alter table public.safety_incidents enable row level security;

alter table public.wellness_session_state enable row level security;

alter table public.daily_job_reports enable row level security;

alter table public.trade_playbooks enable row level security;

alter table public.trade_playbook_steps enable row level security;

alter table public.trade_playbook_sources enable row level security;

alter table public.ask_threads enable row level security;

alter table public.proof_live_sessions enable row level security;

alter table public.recording_acknowledgments enable row level security;

alter table public.crm_agent_credentials enable row level security;

alter table public.crm_agent_jobs enable row level security;

alter table public.content_mentions enable row level security;

alter table public.ask_job_notes enable row level security;

alter table public.ask_transcript_chunks enable row level security;

alter table public.voiceprints enable row level security;

alter table public.voiceprint_embeddings enable row level security;

alter table public.voice_consent_events enable row level security;

alter table public.voice_enrollment_requests enable row level security;

alter table public.speaker_identities enable row level security;

alter table public.speaker_role_guesses enable row level security;

alter table public.clip_room_segments enable row level security;

alter table public.job_chat_documents enable row level security;

alter table public.ask_document_chunks enable row level security;

alter table public.job_document_rooms enable row level security;

alter table public.ai_credit_ledger enable row level security;

alter table public.ai_usage_allocations enable row level security;

alter table public.ai_budget_price_spans enable row level security;

alter table public.ai_credit_pack_clawbacks enable row level security;

alter table public.ai_credit_pack_disputes enable row level security;

alter table public.capture_upload_attempts enable row level security;

alter table public.ask_turn_events enable row level security;

alter table public.analytics_campaigns enable row level security;

alter table public.analytics_campaign_sends enable row level security;

alter table public.analytics_email_suppressions enable row level security;

alter table public.ai_credit_auto_recharge_settings enable row level security;

alter table public.ai_credit_auto_recharges enable row level security;

alter table public.computer_sessions enable row level security;

alter table public.computer_tasks enable row level security;

alter table public.computer_approvals enable row level security;

alter table public.computer_audit_events enable row level security;

alter table public.computer_logins enable row level security;

alter table public.computer_login_credentials enable row level security;

alter table public.ask_communication_styles enable row level security;

alter table public.ask_analysis_chunks enable row level security;

alter table public.ask_route_decisions enable row level security;

alter table public.ask_job_context_cache enable row level security;

alter table public.ask_org_memory_facts enable row level security;

alter table public.computer_site_playbooks enable row level security;

alter table public.computer_playbook_outcomes enable row level security;

alter table public.computer_supply_orders enable row level security;

alter table public.computer_practice_runs enable row level security;

alter table public.computer_practice_screens enable row level security;

alter table public.computer_playbook_drafts enable row level security;

alter table public.computer_route_decisions enable row level security;

alter table public.ask_answer_feedback enable row level security;

alter table public.ask_pinned_answers enable row level security;

alter table public.ask_pending_actions enable row level security;

alter table public.demo_bookings enable row level security;

create policy profiles_update_self on public.profiles as PERMISSIVE for UPDATE to public using ((id = auth.uid())) with check ((id = auth.uid()));

create policy ai_credit_auto_recharge_settings_select on public.ai_credit_auto_recharge_settings as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ai_credit_auto_recharges_select on public.ai_credit_auto_recharges as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy episode_immediate_outcomes_all on public.episode_immediate_outcomes as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_ai_costs_insert on public.verification_ai_costs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_ai_costs_select on public.verification_ai_costs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy work_episodes_all on public.work_episodes as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_observations_all on public.episode_observations as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_actions_all on public.episode_actions as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_resources_all on public.episode_resources as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_verifications_insert on public.episode_verifications as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy episode_verifications_select on public.episode_verifications as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy episode_outcomes_all on public.episode_outcomes as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_economics_all on public.episode_economics as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verifier_shares_insert on public.verifier_shares as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verifier_shares_select on public.verifier_shares as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verifier_shares_update on public.verifier_shares as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy ai_analysis_runs_insert on public.ai_analysis_runs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy ai_analysis_runs_select on public.ai_analysis_runs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy frame_observations_insert on public.frame_observations as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy frame_observations_select on public.frame_observations as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy frame_observations_update on public.frame_observations as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_evidence_insert on public.verification_evidence as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_evidence_select on public.verification_evidence as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_evidence_update on public.verification_evidence as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy human_review_tasks_insert on public.human_review_tasks as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy human_review_tasks_select on public.human_review_tasks as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy human_review_tasks_update on public.human_review_tasks as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy human_review_decisions_insert on public.human_review_decisions as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy human_review_decisions_select on public.human_review_decisions as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_audit_events_insert on public.verification_audit_events as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_audit_events_select on public.verification_audit_events as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_usage_limits_insert on public.verification_usage_limits as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_usage_limits_select on public.verification_usage_limits as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_usage_limits_update on public.verification_usage_limits as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy job_proof_segments_select on public.job_proof_segments as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy field_identities_no_user_access on public.field_identities as PERMISSIVE for SELECT to authenticated using (false);

create policy job_party_claims_select on public.job_party_claims as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy field_sessions_no_user_access on public.field_sessions as PERMISSIVE for SELECT to authenticated using (false);

create policy org_media_quotas_select_member on public.org_media_quotas as PERMISSIVE for SELECT to public using ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy org_media_quotas_write_member on public.org_media_quotas as PERMISSIVE for ALL to authenticated using ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))) with check ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy media_objects_insert_member on public.media_objects as PERMISSIVE for INSERT to authenticated with check ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy media_objects_select_member on public.media_objects as PERMISSIVE for SELECT to public using (((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))) AND (((deleted_at IS NULL) AND (state <> 'deleted'::media_state)) OR (deleted_by = auth.uid()))));

create policy media_objects_update_member on public.media_objects as PERMISSIVE for UPDATE to authenticated using ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))) with check ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy media_upload_sessions_select_member on public.media_upload_sessions as PERMISSIVE for SELECT to public using ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy media_upload_sessions_write_member on public.media_upload_sessions as PERMISSIVE for ALL to authenticated using ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))) with check ((org_id IN ( SELECT org_members.org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))));

create policy job_intake_insert on public.job_intake as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_intake_select on public.job_intake as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_parties_insert on public.job_parties as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_parties_select on public.job_parties as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_parties_update on public.job_parties as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy computer_sessions_no_user_access on public.computer_sessions as PERMISSIVE for SELECT to authenticated using (false);

create policy computer_audit_events_no_user_access on public.computer_audit_events as PERMISSIVE for SELECT to authenticated using (false);

create policy job_briefs_insert on public.job_briefs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_briefs_select on public.job_briefs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy computer_approvals_no_user_access on public.computer_approvals as PERMISSIVE for SELECT to authenticated using (false);

create policy computer_tasks_no_user_access on public.computer_tasks as PERMISSIVE for SELECT to authenticated using (false);

create policy computer_logins_no_user_access on public.computer_logins as PERMISSIVE for SELECT to authenticated using (false);

create policy episode_world_states_all on public.episode_world_states as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_evidence_assets_all on public.episode_evidence_assets as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy episode_annotations_insert on public.episode_annotations as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy episode_annotations_select on public.episode_annotations as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_assignments_insert on public.job_assignments as PERMISSIVE for INSERT to authenticated with check ((private.is_org_member(org_id) AND memory.job_in_org(job_id, org_id) AND memory.is_org_member(org_id, user_id)));

create policy computer_login_credentials_no_user_access on public.computer_login_credentials as PERMISSIVE for SELECT to authenticated using (false);

create policy safety_incidents_select_member on public.safety_incidents as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy safety_incidents_update_member on public.safety_incidents as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy device_credentials_delete_own on public.device_credentials as PERMISSIVE for DELETE to authenticated using ((user_id = auth.uid()));

create policy device_credentials_select_own on public.device_credentials as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));

create policy ask_communication_styles_delete on public.ask_communication_styles as PERMISSIVE for DELETE to authenticated using ((user_id = auth.uid()));

create policy ask_communication_styles_select on public.ask_communication_styles as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));

create policy wellness_session_state_select_member on public.wellness_session_state as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy daily_job_reports_select_member on public.daily_job_reports as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy trade_playbooks_select_member on public.trade_playbooks as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy trade_playbook_steps_select_member on public.trade_playbook_steps as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM trade_playbooks p
  WHERE ((p.id = trade_playbook_steps.playbook_id) AND private.is_org_member(p.org_id)))));

create policy trade_playbook_sources_select_member on public.trade_playbook_sources as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM trade_playbooks p
  WHERE ((p.id = trade_playbook_sources.playbook_id) AND private.is_org_member(p.org_id)))));

create policy billing_plans_select on public.billing_plans as PERMISSIVE for SELECT to public using (true);

create policy org_billing_select on public.org_billing as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy ask_threads_insert on public.ask_threads as PERMISSIVE for INSERT to authenticated with check (((private.is_org_member(org_id) AND (owner_user_id = auth.uid())) OR (owner_user_id = auth.uid())));

create policy ask_threads_select on public.ask_threads as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) OR (owner_user_id = auth.uid())));

create policy ask_threads_update on public.ask_threads as PERMISSIVE for UPDATE to authenticated using ((private.is_org_member(org_id) OR (owner_user_id = auth.uid()))) with check ((private.is_org_member(org_id) OR (owner_user_id = auth.uid())));

create policy ask_analysis_chunks_select on public.ask_analysis_chunks as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND (EXISTS ( SELECT 1
   FROM job_proofs p
  WHERE ((p.id = ask_analysis_chunks.proof_id) AND (p.deleted_at IS NULL))))));

create policy proof_live_sessions_select_member on public.proof_live_sessions as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ask_route_decisions_select on public.ask_route_decisions as PERMISSIVE for SELECT to authenticated using (((org_id IS NOT NULL) AND private.is_org_member(org_id)));

create policy token_usage_events_select on public.token_usage_events as PERMISSIVE for SELECT to public using (private.can_manage_billing(org_id));

create policy recording_acknowledgments_org_select on public.recording_acknowledgments as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy recording_acknowledgments_self_insert on public.recording_acknowledgments as PERMISSIVE for INSERT to authenticated with check ((auth.uid() = actor_user_id));

create policy recording_acknowledgments_self_select on public.recording_acknowledgments as PERMISSIVE for SELECT to authenticated using ((auth.uid() = actor_user_id));

create policy recording_acknowledgments_self_update on public.recording_acknowledgments as PERMISSIVE for UPDATE to authenticated using ((auth.uid() = actor_user_id)) with check ((auth.uid() = actor_user_id));

create policy ask_job_context_cache_select on public.ask_job_context_cache as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy analytics_staff_select_self on public.analytics_staff as PERMISSIVE for SELECT to public using ((user_id = auth.uid()));

create policy job_scope_items_insert on public.job_scope_items as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_scope_items_select on public.job_scope_items as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_scope_items_update on public.job_scope_items as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy feature_catalog_select on public.feature_catalog as PERMISSIVE for SELECT to authenticated using (true);

create policy feature_usage_sessions_select on public.feature_usage_sessions as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy feature_usage_daily_select on public.feature_usage_daily as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy crm_audit_log_select on public.crm_audit_log as PERMISSIVE for SELECT to authenticated using (((org_id IS NOT NULL) AND private.is_org_member(org_id)));

create policy org_billing_events_select on public.org_billing_events as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy jobs_insert on public.jobs as PERMISSIVE for INSERT to authenticated with check (memory.is_member_of(org_id));

create policy jobs_select on public.jobs as PERMISSIVE for SELECT to authenticated using (memory.is_member_of(org_id));

create policy jobs_update on public.jobs as PERMISSIVE for UPDATE to authenticated using (memory.is_member_of(org_id)) with check (memory.is_member_of(org_id));

create policy crm_agent_credentials_no_user_access on public.crm_agent_credentials as PERMISSIVE for SELECT to authenticated using (false);

create policy crm_agent_jobs_select on public.crm_agent_jobs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ask_org_memory_facts_insert on public.ask_org_memory_facts as PERMISSIVE for INSERT to authenticated with check ((private.is_org_member(org_id) AND (created_by = auth.uid())));

create policy ask_org_memory_facts_select on public.ask_org_memory_facts as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND ((restricted IS NOT TRUE) OR (cardinality(source_job_ids) = 0) OR ( SELECT bool_and(private.user_can_access_job(jid.jid)) AS bool_and
   FROM unnest(ask_org_memory_facts.source_job_ids) jid(jid)))));

create policy ask_org_memory_facts_update on public.ask_org_memory_facts as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy computer_playbook_outcomes_org_select on public.computer_playbook_outcomes as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy computer_site_playbooks_select_authenticated on public.computer_site_playbooks as PERMISSIVE for SELECT to authenticated using (true);

create policy network_erasures_no_direct on public.network_erasures as PERMISSIVE for SELECT to public using (false);

create policy computer_supply_orders_org_select on public.computer_supply_orders as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_evidence_access_insert on public.job_evidence_access as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_evidence_access_select on public.job_evidence_access as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy content_mentions_insert on public.content_mentions as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy content_mentions_select on public.content_mentions as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ask_job_notes_insert_member_job on public.ask_job_notes as PERMISSIVE for INSERT to authenticated with check ((private.is_org_member(org_id) AND (owner_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM crm_jobs
  WHERE ((crm_jobs.id = ask_job_notes.job_id) AND (crm_jobs.org_id = ask_job_notes.org_id))))));

create policy ask_job_notes_select on public.ask_job_notes as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) OR (owner_user_id = auth.uid())));

create policy field_identity_codes_no_user_access on public.field_identity_codes as PERMISSIVE for SELECT to authenticated using (false);

create policy job_proofs_insert on public.job_proofs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_proofs_select on public.job_proofs as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND ((deleted_at IS NULL) OR (deleted_by = auth.uid()))));

create policy job_proofs_select_progress_grant on public.job_proofs as PERMISSIVE for SELECT to authenticated using (((deleted_at IS NULL) AND private.has_job_progress_grant(job_id)));

create policy job_proofs_update on public.job_proofs as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy billing_period_statements_select on public.billing_period_statements as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy metering_alerts_select on public.metering_alerts as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy computer_route_decisions_select on public.computer_route_decisions as PERMISSIVE for SELECT to authenticated using (((org_id IS NOT NULL) AND private.is_org_member(org_id)));

create policy terms_acceptances_self_insert on public.terms_acceptances as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));

create policy terms_acceptances_self_select on public.terms_acceptances as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));

create policy terms_acceptances_self_update on public.terms_acceptances as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

create policy ask_transcript_chunks_select on public.ask_transcript_chunks as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND (EXISTS ( SELECT 1
   FROM job_proofs p
  WHERE ((p.id = ask_transcript_chunks.proof_id) AND (p.deleted_at IS NULL))))));

create policy scope_documents_select on public.scope_documents as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy org_members_insert_self on public.org_members as PERMISSIVE for INSERT to public with check ((user_id = auth.uid()));

create policy org_members_member_select on public.org_members as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy org_members_select on public.org_members as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy org_members_self_update on public.org_members as PERMISSIVE for UPDATE to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create policy org_members_update_self on public.org_members as PERMISSIVE for UPDATE to public using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create policy orgs_insert_own on public.orgs as PERMISSIVE for INSERT to public with check ((created_by = auth.uid()));

create policy orgs_member_select on public.orgs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(id));

create policy orgs_select_member on public.orgs as PERMISSIVE for SELECT to public using (((created_by = auth.uid()) OR private.is_org_member(id)));

create policy org_invites_insert on public.org_invites as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy org_invites_select on public.org_invites as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy org_invites_update on public.org_invites as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy evidence_downloads_org_select on public.evidence_downloads as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) OR (requested_by = auth.uid())));

create policy evidence_download_policy_select on public.evidence_download_policy as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy evidence_download_policy_write on public.evidence_download_policy as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy metering_plans_select on public.metering_plans as PERMISSIVE for SELECT to public using (is_active);

create policy metering_plan_versions_select on public.metering_plan_versions as PERMISSIVE for SELECT to public using (true);

create policy qualifying_workflow_types_select on public.qualifying_workflow_types as PERMISSIVE for SELECT to public using (is_active);

create policy org_metering_select on public.org_metering as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy billing_period_jobs_select on public.billing_period_jobs as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy job_locations_all on public.job_locations as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy voiceprints_select on public.voiceprints as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy voiceprint_embeddings_select on public.voiceprint_embeddings as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM voiceprints v
  WHERE ((v.id = voiceprint_embeddings.voiceprint_id) AND (v.user_id = auth.uid())))));

create policy voice_consent_events_select on public.voice_consent_events as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy voice_enrollment_requests_select on public.voice_enrollment_requests as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy speaker_identities_select on public.speaker_identities as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND private.speaker_job_clip_owned(org_id, job_id, proof_id)));

create policy speaker_role_guesses_select on public.speaker_role_guesses as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND private.speaker_job_clip_owned(org_id, job_id, proof_id)));

create policy payments_select on public.payments as PERMISSIVE for SELECT to public using (private.is_org_member(org_id));

create policy video_processing_jobs_insert on public.video_processing_jobs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy video_processing_jobs_select on public.video_processing_jobs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy video_processing_jobs_update on public.video_processing_jobs as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_videos_insert on public.verification_videos as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_videos_select on public.verification_videos as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_videos_update on public.verification_videos as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy clip_room_segments_select on public.clip_room_segments as PERMISSIVE for SELECT to authenticated using ((private.is_org_member(org_id) AND (EXISTS ( SELECT 1
   FROM job_proofs p
  WHERE ((p.id = clip_room_segments.proof_id) AND (p.deleted_at IS NULL))))));

create policy job_chat_documents_select on public.job_chat_documents as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy video_processing_steps_insert on public.video_processing_steps as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy video_processing_steps_select on public.video_processing_steps as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy video_processing_steps_update on public.video_processing_steps as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy ask_document_chunks_select on public.ask_document_chunks as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_scenes_insert on public.verification_scenes as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_scenes_select on public.verification_scenes as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_scenes_update on public.verification_scenes as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_frames_insert on public.verification_frames as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_frames_select on public.verification_frames as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_frames_update on public.verification_frames as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy job_document_rooms_select on public.job_document_rooms as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ask_answer_feedback_own on public.ask_answer_feedback as PERMISSIVE for ALL to authenticated using (((user_id = auth.uid()) AND private.is_org_member(org_id))) with check (((user_id = auth.uid()) AND private.is_org_member(org_id)));

create policy ask_pinned_answers_org on public.ask_pinned_answers as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy platform_staff_select_self on public.platform_staff as PERMISSIVE for SELECT to public using ((user_id = auth.uid()));

create policy job_tasks_insert on public.job_tasks as PERMISSIVE for INSERT to authenticated with check ((private.is_org_member(org_id) AND memory.job_in_org(job_id, org_id)));

create policy job_tasks_select on public.job_tasks as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_tasks_update on public.job_tasks as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy job_assignments_select on public.job_assignments as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_assignments_update on public.job_assignments as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy work_logs_insert on public.work_logs as PERMISSIVE for INSERT to authenticated with check ((private.is_org_member(org_id) AND memory.job_in_org(job_id, org_id) AND (author_id = auth.uid())));

create policy work_logs_select on public.work_logs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy work_logs_update on public.work_logs as PERMISSIVE for UPDATE to authenticated using ((private.is_org_member(org_id) AND (author_id = auth.uid()))) with check ((author_id = auth.uid()));

create policy ask_pending_actions_org_read on public.ask_pending_actions as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy temporal_change_events_insert on public.temporal_change_events as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy temporal_change_events_select on public.temporal_change_events as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy temporal_change_events_update on public.temporal_change_events as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_results_insert on public.verification_results as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy verification_results_select on public.verification_results as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy verification_results_update on public.verification_results as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy ai_usage_allocations_select on public.ai_usage_allocations as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ai_budget_price_spans_select on public.ai_budget_price_spans as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy memory_events_select on public.memory_events as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy ai_credit_ledger_select on public.ai_credit_ledger as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy avatars_storage_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy avatars_storage_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy avatars_storage_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy job_proofs_storage_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'job-proofs'::text) AND ((storage.foldername(name))[1] IN ( SELECT (org_members.org_id)::text AS org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))));

create policy job_proofs_storage_no_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'job-proofs'::text) AND false));

create policy job_proofs_storage_select on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'job-proofs'::text) AND ((storage.foldername(name))[1] IN ( SELECT (org_members.org_id)::text AS org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))));

create policy job_proofs_storage_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'job-proofs'::text) AND ((storage.foldername(name))[1] IN ( SELECT (org_members.org_id)::text AS org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid()))))) with check (((bucket_id = 'job-proofs'::text) AND ((storage.foldername(name))[1] IN ( SELECT (org_members.org_id)::text AS org_id
   FROM org_members
  WHERE (org_members.user_id = auth.uid())))));

create policy video_clips_insert on public.video_clips as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy video_clips_select on public.video_clips as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy video_clips_update on public.video_clips as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy llm_verification_runs_insert on public.llm_verification_runs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy llm_verification_runs_select on public.llm_verification_runs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_progress_grants_select_own on public.job_progress_grants as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));

create policy crm_jobs_delete on public.crm_jobs as PERMISSIVE for DELETE to authenticated using (private.is_org_member(org_id));

create policy crm_jobs_insert on public.crm_jobs as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy crm_jobs_select on public.crm_jobs as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy crm_jobs_select_progress_grant on public.crm_jobs as PERMISSIVE for SELECT to authenticated using (((deleted_at IS NULL) AND private.has_job_progress_grant(id)));

create policy crm_jobs_update on public.crm_jobs as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy verification_rules_insert on public.verification_rules as PERMISSIVE for INSERT to authenticated with check (((org_id IS NOT NULL) AND private.is_org_member(org_id)));

create policy verification_rules_select on public.verification_rules as PERMISSIVE for SELECT to authenticated using (((org_id IS NULL) OR private.is_org_member(org_id)));

create policy verification_rules_update on public.verification_rules as PERMISSIVE for UPDATE to authenticated using (((org_id IS NOT NULL) AND private.is_org_member(org_id))) with check (((org_id IS NOT NULL) AND private.is_org_member(org_id)));

create policy crm_properties_delete on public.crm_properties as PERMISSIVE for DELETE to authenticated using (private.is_org_member(org_id));

create policy crm_properties_insert on public.crm_properties as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy crm_properties_select on public.crm_properties as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy crm_properties_update on public.crm_properties as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy crm_counters_select on public.crm_counters as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy platform_admin_audit_select_staff on public.platform_admin_audit as PERMISSIVE for SELECT to public using ((private.platform_staff_scope() IS NOT NULL));

create policy job_proof_questions_insert on public.job_proof_questions as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_proof_questions_select on public.job_proof_questions as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_proof_questions_update on public.job_proof_questions as PERMISSIVE for UPDATE to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy job_acknowledgements_insert on public.job_acknowledgements as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_acknowledgements_select on public.job_acknowledgements as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_messages_insert on public.job_messages as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_messages_select on public.job_messages as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_proof_frames_insert on public.job_proof_frames as PERMISSIVE for INSERT to authenticated with check (private.is_org_member(org_id));

create policy job_proof_frames_select on public.job_proof_frames as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_evidence_policy_select on public.job_evidence_policy as PERMISSIVE for SELECT to authenticated using (private.is_org_member(org_id));

create policy job_evidence_policy_write on public.job_evidence_policy as PERMISSIVE for ALL to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy profiles_insert_self on public.profiles as PERMISSIVE for INSERT to public with check ((id = auth.uid()));

create policy profiles_select on public.profiles as PERMISSIVE for SELECT to public using (((id = auth.uid()) OR private.shares_org(id)));

create policy profiles_self on public.profiles as PERMISSIVE for SELECT to authenticated using ((id = auth.uid()));

revoke all on public.profiles from public, anon, authenticated, service_role; grant INSERT on public.profiles to anon; grant SELECT on public.profiles to anon; grant UPDATE on public.profiles to anon; grant DELETE on public.profiles to anon; grant TRUNCATE on public.profiles to anon; grant REFERENCES on public.profiles to anon; grant TRIGGER on public.profiles to anon; grant MAINTAIN on public.profiles to anon; grant INSERT on public.profiles to authenticated; grant SELECT on public.profiles to authenticated; grant UPDATE on public.profiles to authenticated; grant DELETE on public.profiles to authenticated; grant TRUNCATE on public.profiles to authenticated; grant REFERENCES on public.profiles to authenticated; grant TRIGGER on public.profiles to authenticated; grant MAINTAIN on public.profiles to authenticated; grant INSERT on public.profiles to service_role; grant SELECT on public.profiles to service_role; grant UPDATE on public.profiles to service_role; grant DELETE on public.profiles to service_role; grant TRUNCATE on public.profiles to service_role; grant REFERENCES on public.profiles to service_role; grant TRIGGER on public.profiles to service_role; grant MAINTAIN on public.profiles to service_role;

revoke all on public.orgs from public, anon, authenticated, service_role; grant INSERT on public.orgs to anon; grant SELECT on public.orgs to anon; grant UPDATE on public.orgs to anon; grant DELETE on public.orgs to anon; grant TRUNCATE on public.orgs to anon; grant REFERENCES on public.orgs to anon; grant TRIGGER on public.orgs to anon; grant MAINTAIN on public.orgs to anon; grant INSERT on public.orgs to authenticated; grant SELECT on public.orgs to authenticated; grant UPDATE on public.orgs to authenticated; grant DELETE on public.orgs to authenticated; grant TRUNCATE on public.orgs to authenticated; grant REFERENCES on public.orgs to authenticated; grant TRIGGER on public.orgs to authenticated; grant MAINTAIN on public.orgs to authenticated; grant INSERT on public.orgs to service_role; grant SELECT on public.orgs to service_role; grant UPDATE on public.orgs to service_role; grant DELETE on public.orgs to service_role; grant TRUNCATE on public.orgs to service_role; grant REFERENCES on public.orgs to service_role; grant TRIGGER on public.orgs to service_role; grant MAINTAIN on public.orgs to service_role;

revoke all on public.org_members from public, anon, authenticated, service_role; grant INSERT on public.org_members to anon; grant SELECT on public.org_members to anon; grant UPDATE on public.org_members to anon; grant DELETE on public.org_members to anon; grant TRUNCATE on public.org_members to anon; grant REFERENCES on public.org_members to anon; grant TRIGGER on public.org_members to anon; grant MAINTAIN on public.org_members to anon; grant INSERT on public.org_members to authenticated; grant SELECT on public.org_members to authenticated; grant UPDATE on public.org_members to authenticated; grant DELETE on public.org_members to authenticated; grant TRUNCATE on public.org_members to authenticated; grant REFERENCES on public.org_members to authenticated; grant TRIGGER on public.org_members to authenticated; grant MAINTAIN on public.org_members to authenticated; grant INSERT on public.org_members to service_role; grant SELECT on public.org_members to service_role; grant UPDATE on public.org_members to service_role; grant DELETE on public.org_members to service_role; grant TRUNCATE on public.org_members to service_role; grant REFERENCES on public.org_members to service_role; grant TRIGGER on public.org_members to service_role; grant MAINTAIN on public.org_members to service_role;

revoke all on public.device_credentials from public, anon, authenticated, service_role; grant INSERT on public.device_credentials to anon; grant SELECT on public.device_credentials to anon; grant UPDATE on public.device_credentials to anon; grant DELETE on public.device_credentials to anon; grant TRUNCATE on public.device_credentials to anon; grant REFERENCES on public.device_credentials to anon; grant TRIGGER on public.device_credentials to anon; grant MAINTAIN on public.device_credentials to anon; grant INSERT on public.device_credentials to authenticated; grant SELECT on public.device_credentials to authenticated; grant UPDATE on public.device_credentials to authenticated; grant DELETE on public.device_credentials to authenticated; grant TRUNCATE on public.device_credentials to authenticated; grant REFERENCES on public.device_credentials to authenticated; grant TRIGGER on public.device_credentials to authenticated; grant MAINTAIN on public.device_credentials to authenticated; grant INSERT on public.device_credentials to service_role; grant SELECT on public.device_credentials to service_role; grant UPDATE on public.device_credentials to service_role; grant DELETE on public.device_credentials to service_role; grant TRUNCATE on public.device_credentials to service_role; grant REFERENCES on public.device_credentials to service_role; grant TRIGGER on public.device_credentials to service_role; grant MAINTAIN on public.device_credentials to service_role;

revoke all on private.model_costs from public, anon, authenticated, service_role;

revoke all on public.billing_plans from public, anon, authenticated, service_role; grant INSERT on public.billing_plans to anon; grant SELECT on public.billing_plans to anon; grant UPDATE on public.billing_plans to anon; grant DELETE on public.billing_plans to anon; grant TRUNCATE on public.billing_plans to anon; grant REFERENCES on public.billing_plans to anon; grant TRIGGER on public.billing_plans to anon; grant MAINTAIN on public.billing_plans to anon; grant INSERT on public.billing_plans to authenticated; grant SELECT on public.billing_plans to authenticated; grant UPDATE on public.billing_plans to authenticated; grant DELETE on public.billing_plans to authenticated; grant TRUNCATE on public.billing_plans to authenticated; grant REFERENCES on public.billing_plans to authenticated; grant TRIGGER on public.billing_plans to authenticated; grant MAINTAIN on public.billing_plans to authenticated; grant INSERT on public.billing_plans to service_role; grant SELECT on public.billing_plans to service_role; grant UPDATE on public.billing_plans to service_role; grant DELETE on public.billing_plans to service_role; grant TRUNCATE on public.billing_plans to service_role; grant REFERENCES on public.billing_plans to service_role; grant TRIGGER on public.billing_plans to service_role; grant MAINTAIN on public.billing_plans to service_role;

revoke all on public.org_billing from public, anon, authenticated, service_role; grant INSERT on public.org_billing to anon; grant SELECT on public.org_billing to anon; grant UPDATE on public.org_billing to anon; grant DELETE on public.org_billing to anon; grant TRUNCATE on public.org_billing to anon; grant REFERENCES on public.org_billing to anon; grant TRIGGER on public.org_billing to anon; grant MAINTAIN on public.org_billing to anon; grant INSERT on public.org_billing to authenticated; grant SELECT on public.org_billing to authenticated; grant UPDATE on public.org_billing to authenticated; grant DELETE on public.org_billing to authenticated; grant TRUNCATE on public.org_billing to authenticated; grant REFERENCES on public.org_billing to authenticated; grant TRIGGER on public.org_billing to authenticated; grant MAINTAIN on public.org_billing to authenticated; grant INSERT on public.org_billing to service_role; grant SELECT on public.org_billing to service_role; grant UPDATE on public.org_billing to service_role; grant DELETE on public.org_billing to service_role; grant TRUNCATE on public.org_billing to service_role; grant REFERENCES on public.org_billing to service_role; grant TRIGGER on public.org_billing to service_role; grant MAINTAIN on public.org_billing to service_role;

revoke all on public.payments from public, anon, authenticated, service_role; grant INSERT on public.payments to anon; grant SELECT on public.payments to anon; grant UPDATE on public.payments to anon; grant DELETE on public.payments to anon; grant TRUNCATE on public.payments to anon; grant REFERENCES on public.payments to anon; grant TRIGGER on public.payments to anon; grant MAINTAIN on public.payments to anon; grant INSERT on public.payments to authenticated; grant SELECT on public.payments to authenticated; grant UPDATE on public.payments to authenticated; grant DELETE on public.payments to authenticated; grant TRUNCATE on public.payments to authenticated; grant REFERENCES on public.payments to authenticated; grant TRIGGER on public.payments to authenticated; grant MAINTAIN on public.payments to authenticated; grant INSERT on public.payments to service_role; grant SELECT on public.payments to service_role; grant UPDATE on public.payments to service_role; grant DELETE on public.payments to service_role; grant TRUNCATE on public.payments to service_role; grant REFERENCES on public.payments to service_role; grant TRIGGER on public.payments to service_role; grant MAINTAIN on public.payments to service_role;

revoke all on public.analytics_staff from public, anon, authenticated, service_role; grant INSERT on public.analytics_staff to anon; grant SELECT on public.analytics_staff to anon; grant UPDATE on public.analytics_staff to anon; grant DELETE on public.analytics_staff to anon; grant TRUNCATE on public.analytics_staff to anon; grant REFERENCES on public.analytics_staff to anon; grant TRIGGER on public.analytics_staff to anon; grant MAINTAIN on public.analytics_staff to anon; grant INSERT on public.analytics_staff to authenticated; grant SELECT on public.analytics_staff to authenticated; grant UPDATE on public.analytics_staff to authenticated; grant DELETE on public.analytics_staff to authenticated; grant TRUNCATE on public.analytics_staff to authenticated; grant REFERENCES on public.analytics_staff to authenticated; grant TRIGGER on public.analytics_staff to authenticated; grant MAINTAIN on public.analytics_staff to authenticated; grant INSERT on public.analytics_staff to service_role; grant SELECT on public.analytics_staff to service_role; grant UPDATE on public.analytics_staff to service_role; grant DELETE on public.analytics_staff to service_role; grant TRUNCATE on public.analytics_staff to service_role; grant REFERENCES on public.analytics_staff to service_role; grant TRIGGER on public.analytics_staff to service_role; grant MAINTAIN on public.analytics_staff to service_role;

revoke all on public.feature_catalog from public, anon, authenticated, service_role; grant INSERT on public.feature_catalog to anon; grant SELECT on public.feature_catalog to anon; grant UPDATE on public.feature_catalog to anon; grant DELETE on public.feature_catalog to anon; grant TRUNCATE on public.feature_catalog to anon; grant REFERENCES on public.feature_catalog to anon; grant TRIGGER on public.feature_catalog to anon; grant MAINTAIN on public.feature_catalog to anon; grant INSERT on public.feature_catalog to authenticated; grant SELECT on public.feature_catalog to authenticated; grant UPDATE on public.feature_catalog to authenticated; grant DELETE on public.feature_catalog to authenticated; grant TRUNCATE on public.feature_catalog to authenticated; grant REFERENCES on public.feature_catalog to authenticated; grant TRIGGER on public.feature_catalog to authenticated; grant MAINTAIN on public.feature_catalog to authenticated; grant INSERT on public.feature_catalog to service_role; grant SELECT on public.feature_catalog to service_role; grant UPDATE on public.feature_catalog to service_role; grant DELETE on public.feature_catalog to service_role; grant TRUNCATE on public.feature_catalog to service_role; grant REFERENCES on public.feature_catalog to service_role; grant TRIGGER on public.feature_catalog to service_role; grant MAINTAIN on public.feature_catalog to service_role;

revoke all on public.feature_usage_sessions from public, anon, authenticated, service_role; grant INSERT on public.feature_usage_sessions to anon; grant SELECT on public.feature_usage_sessions to anon; grant UPDATE on public.feature_usage_sessions to anon; grant DELETE on public.feature_usage_sessions to anon; grant TRUNCATE on public.feature_usage_sessions to anon; grant REFERENCES on public.feature_usage_sessions to anon; grant TRIGGER on public.feature_usage_sessions to anon; grant MAINTAIN on public.feature_usage_sessions to anon; grant INSERT on public.feature_usage_sessions to authenticated; grant SELECT on public.feature_usage_sessions to authenticated; grant UPDATE on public.feature_usage_sessions to authenticated; grant DELETE on public.feature_usage_sessions to authenticated; grant TRUNCATE on public.feature_usage_sessions to authenticated; grant REFERENCES on public.feature_usage_sessions to authenticated; grant TRIGGER on public.feature_usage_sessions to authenticated; grant MAINTAIN on public.feature_usage_sessions to authenticated; grant INSERT on public.feature_usage_sessions to service_role; grant SELECT on public.feature_usage_sessions to service_role; grant UPDATE on public.feature_usage_sessions to service_role; grant DELETE on public.feature_usage_sessions to service_role; grant TRUNCATE on public.feature_usage_sessions to service_role; grant REFERENCES on public.feature_usage_sessions to service_role; grant TRIGGER on public.feature_usage_sessions to service_role; grant MAINTAIN on public.feature_usage_sessions to service_role;

revoke all on public.feature_usage_daily from public, anon, authenticated, service_role; grant INSERT on public.feature_usage_daily to anon; grant SELECT on public.feature_usage_daily to anon; grant UPDATE on public.feature_usage_daily to anon; grant DELETE on public.feature_usage_daily to anon; grant TRUNCATE on public.feature_usage_daily to anon; grant REFERENCES on public.feature_usage_daily to anon; grant TRIGGER on public.feature_usage_daily to anon; grant MAINTAIN on public.feature_usage_daily to anon; grant INSERT on public.feature_usage_daily to authenticated; grant SELECT on public.feature_usage_daily to authenticated; grant UPDATE on public.feature_usage_daily to authenticated; grant DELETE on public.feature_usage_daily to authenticated; grant TRUNCATE on public.feature_usage_daily to authenticated; grant REFERENCES on public.feature_usage_daily to authenticated; grant TRIGGER on public.feature_usage_daily to authenticated; grant MAINTAIN on public.feature_usage_daily to authenticated; grant INSERT on public.feature_usage_daily to service_role; grant SELECT on public.feature_usage_daily to service_role; grant UPDATE on public.feature_usage_daily to service_role; grant DELETE on public.feature_usage_daily to service_role; grant TRUNCATE on public.feature_usage_daily to service_role; grant REFERENCES on public.feature_usage_daily to service_role; grant TRIGGER on public.feature_usage_daily to service_role; grant MAINTAIN on public.feature_usage_daily to service_role;

revoke all on public.org_billing_events_id_seq from public, anon, authenticated, service_role; grant SELECT on public.org_billing_events_id_seq to anon; grant UPDATE on public.org_billing_events_id_seq to anon; grant USAGE on public.org_billing_events_id_seq to anon; grant SELECT on public.org_billing_events_id_seq to authenticated; grant UPDATE on public.org_billing_events_id_seq to authenticated; grant USAGE on public.org_billing_events_id_seq to authenticated; grant SELECT on public.org_billing_events_id_seq to service_role; grant UPDATE on public.org_billing_events_id_seq to service_role; grant USAGE on public.org_billing_events_id_seq to service_role;

revoke all on public.org_billing_events from public, anon, authenticated, service_role; grant INSERT on public.org_billing_events to anon; grant SELECT on public.org_billing_events to anon; grant UPDATE on public.org_billing_events to anon; grant DELETE on public.org_billing_events to anon; grant TRUNCATE on public.org_billing_events to anon; grant REFERENCES on public.org_billing_events to anon; grant TRIGGER on public.org_billing_events to anon; grant MAINTAIN on public.org_billing_events to anon; grant INSERT on public.org_billing_events to authenticated; grant SELECT on public.org_billing_events to authenticated; grant UPDATE on public.org_billing_events to authenticated; grant DELETE on public.org_billing_events to authenticated; grant TRUNCATE on public.org_billing_events to authenticated; grant REFERENCES on public.org_billing_events to authenticated; grant TRIGGER on public.org_billing_events to authenticated; grant MAINTAIN on public.org_billing_events to authenticated; grant INSERT on public.org_billing_events to service_role; grant SELECT on public.org_billing_events to service_role; grant UPDATE on public.org_billing_events to service_role; grant DELETE on public.org_billing_events to service_role; grant TRUNCATE on public.org_billing_events to service_role; grant REFERENCES on public.org_billing_events to service_role; grant TRIGGER on public.org_billing_events to service_role; grant MAINTAIN on public.org_billing_events to service_role;

revoke all on public.jobs from public, anon, authenticated, service_role; grant INSERT on public.jobs to anon; grant SELECT on public.jobs to anon; grant UPDATE on public.jobs to anon; grant DELETE on public.jobs to anon; grant TRUNCATE on public.jobs to anon; grant REFERENCES on public.jobs to anon; grant TRIGGER on public.jobs to anon; grant MAINTAIN on public.jobs to anon; grant INSERT on public.jobs to authenticated; grant SELECT on public.jobs to authenticated; grant UPDATE on public.jobs to authenticated; grant DELETE on public.jobs to authenticated; grant TRUNCATE on public.jobs to authenticated; grant REFERENCES on public.jobs to authenticated; grant TRIGGER on public.jobs to authenticated; grant MAINTAIN on public.jobs to authenticated; grant INSERT on public.jobs to service_role; grant SELECT on public.jobs to service_role; grant UPDATE on public.jobs to service_role; grant DELETE on public.jobs to service_role; grant TRUNCATE on public.jobs to service_role; grant REFERENCES on public.jobs to service_role; grant TRIGGER on public.jobs to service_role; grant MAINTAIN on public.jobs to service_role;

revoke all on public.job_tasks from public, anon, authenticated, service_role; grant INSERT on public.job_tasks to anon; grant SELECT on public.job_tasks to anon; grant UPDATE on public.job_tasks to anon; grant DELETE on public.job_tasks to anon; grant TRUNCATE on public.job_tasks to anon; grant REFERENCES on public.job_tasks to anon; grant TRIGGER on public.job_tasks to anon; grant MAINTAIN on public.job_tasks to anon; grant INSERT on public.job_tasks to authenticated; grant SELECT on public.job_tasks to authenticated; grant UPDATE on public.job_tasks to authenticated; grant DELETE on public.job_tasks to authenticated; grant TRUNCATE on public.job_tasks to authenticated; grant REFERENCES on public.job_tasks to authenticated; grant TRIGGER on public.job_tasks to authenticated; grant MAINTAIN on public.job_tasks to authenticated; grant INSERT on public.job_tasks to service_role; grant SELECT on public.job_tasks to service_role; grant UPDATE on public.job_tasks to service_role; grant DELETE on public.job_tasks to service_role; grant TRUNCATE on public.job_tasks to service_role; grant REFERENCES on public.job_tasks to service_role; grant TRIGGER on public.job_tasks to service_role; grant MAINTAIN on public.job_tasks to service_role;

revoke all on public.job_assignments from public, anon, authenticated, service_role; grant INSERT on public.job_assignments to anon; grant SELECT on public.job_assignments to anon; grant UPDATE on public.job_assignments to anon; grant DELETE on public.job_assignments to anon; grant TRUNCATE on public.job_assignments to anon; grant REFERENCES on public.job_assignments to anon; grant TRIGGER on public.job_assignments to anon; grant MAINTAIN on public.job_assignments to anon; grant INSERT on public.job_assignments to authenticated; grant SELECT on public.job_assignments to authenticated; grant UPDATE on public.job_assignments to authenticated; grant DELETE on public.job_assignments to authenticated; grant TRUNCATE on public.job_assignments to authenticated; grant REFERENCES on public.job_assignments to authenticated; grant TRIGGER on public.job_assignments to authenticated; grant MAINTAIN on public.job_assignments to authenticated; grant INSERT on public.job_assignments to service_role; grant SELECT on public.job_assignments to service_role; grant UPDATE on public.job_assignments to service_role; grant DELETE on public.job_assignments to service_role; grant TRUNCATE on public.job_assignments to service_role; grant REFERENCES on public.job_assignments to service_role; grant TRIGGER on public.job_assignments to service_role; grant MAINTAIN on public.job_assignments to service_role;

revoke all on public.work_logs from public, anon, authenticated, service_role; grant INSERT on public.work_logs to anon; grant SELECT on public.work_logs to anon; grant UPDATE on public.work_logs to anon; grant DELETE on public.work_logs to anon; grant TRUNCATE on public.work_logs to anon; grant REFERENCES on public.work_logs to anon; grant TRIGGER on public.work_logs to anon; grant MAINTAIN on public.work_logs to anon; grant INSERT on public.work_logs to authenticated; grant SELECT on public.work_logs to authenticated; grant UPDATE on public.work_logs to authenticated; grant DELETE on public.work_logs to authenticated; grant TRUNCATE on public.work_logs to authenticated; grant REFERENCES on public.work_logs to authenticated; grant TRIGGER on public.work_logs to authenticated; grant MAINTAIN on public.work_logs to authenticated; grant INSERT on public.work_logs to service_role; grant SELECT on public.work_logs to service_role; grant UPDATE on public.work_logs to service_role; grant DELETE on public.work_logs to service_role; grant TRUNCATE on public.work_logs to service_role; grant REFERENCES on public.work_logs to service_role; grant TRIGGER on public.work_logs to service_role; grant MAINTAIN on public.work_logs to service_role;

revoke all on public.memory_events_seq_seq from public, anon, authenticated, service_role; grant SELECT on public.memory_events_seq_seq to anon; grant UPDATE on public.memory_events_seq_seq to anon; grant USAGE on public.memory_events_seq_seq to anon; grant SELECT on public.memory_events_seq_seq to authenticated; grant UPDATE on public.memory_events_seq_seq to authenticated; grant USAGE on public.memory_events_seq_seq to authenticated; grant SELECT on public.memory_events_seq_seq to service_role; grant UPDATE on public.memory_events_seq_seq to service_role; grant USAGE on public.memory_events_seq_seq to service_role;

revoke all on public.memory_events from public, anon, authenticated, service_role; grant SELECT on public.memory_events to anon; grant REFERENCES on public.memory_events to anon; grant TRIGGER on public.memory_events to anon; grant MAINTAIN on public.memory_events to anon; grant SELECT on public.memory_events to authenticated; grant REFERENCES on public.memory_events to authenticated; grant TRIGGER on public.memory_events to authenticated; grant MAINTAIN on public.memory_events to authenticated; grant INSERT on public.memory_events to service_role; grant SELECT on public.memory_events to service_role; grant UPDATE on public.memory_events to service_role; grant DELETE on public.memory_events to service_role; grant TRUNCATE on public.memory_events to service_role; grant REFERENCES on public.memory_events to service_role; grant TRIGGER on public.memory_events to service_role; grant MAINTAIN on public.memory_events to service_role;

revoke all on public.schema_migrations from public, anon, authenticated, service_role; grant INSERT on public.schema_migrations to service_role; grant SELECT on public.schema_migrations to service_role; grant UPDATE on public.schema_migrations to service_role; grant DELETE on public.schema_migrations to service_role; grant TRUNCATE on public.schema_migrations to service_role; grant REFERENCES on public.schema_migrations to service_role; grant TRIGGER on public.schema_migrations to service_role; grant MAINTAIN on public.schema_migrations to service_role;

revoke all on public.media_objects from public, anon, authenticated, service_role; grant INSERT on public.media_objects to anon; grant SELECT on public.media_objects to anon; grant UPDATE on public.media_objects to anon; grant DELETE on public.media_objects to anon; grant TRUNCATE on public.media_objects to anon; grant REFERENCES on public.media_objects to anon; grant TRIGGER on public.media_objects to anon; grant MAINTAIN on public.media_objects to anon; grant INSERT on public.media_objects to authenticated; grant SELECT on public.media_objects to authenticated; grant UPDATE on public.media_objects to authenticated; grant DELETE on public.media_objects to authenticated; grant TRUNCATE on public.media_objects to authenticated; grant REFERENCES on public.media_objects to authenticated; grant TRIGGER on public.media_objects to authenticated; grant MAINTAIN on public.media_objects to authenticated; grant INSERT on public.media_objects to service_role; grant SELECT on public.media_objects to service_role; grant UPDATE on public.media_objects to service_role; grant DELETE on public.media_objects to service_role; grant TRUNCATE on public.media_objects to service_role; grant REFERENCES on public.media_objects to service_role; grant TRIGGER on public.media_objects to service_role; grant MAINTAIN on public.media_objects to service_role;

revoke all on public.org_media_quotas from public, anon, authenticated, service_role; grant INSERT on public.org_media_quotas to anon; grant SELECT on public.org_media_quotas to anon; grant UPDATE on public.org_media_quotas to anon; grant DELETE on public.org_media_quotas to anon; grant TRUNCATE on public.org_media_quotas to anon; grant REFERENCES on public.org_media_quotas to anon; grant TRIGGER on public.org_media_quotas to anon; grant MAINTAIN on public.org_media_quotas to anon; grant INSERT on public.org_media_quotas to authenticated; grant SELECT on public.org_media_quotas to authenticated; grant UPDATE on public.org_media_quotas to authenticated; grant DELETE on public.org_media_quotas to authenticated; grant TRUNCATE on public.org_media_quotas to authenticated; grant REFERENCES on public.org_media_quotas to authenticated; grant TRIGGER on public.org_media_quotas to authenticated; grant MAINTAIN on public.org_media_quotas to authenticated; grant INSERT on public.org_media_quotas to service_role; grant SELECT on public.org_media_quotas to service_role; grant UPDATE on public.org_media_quotas to service_role; grant DELETE on public.org_media_quotas to service_role; grant TRUNCATE on public.org_media_quotas to service_role; grant REFERENCES on public.org_media_quotas to service_role; grant TRIGGER on public.org_media_quotas to service_role; grant MAINTAIN on public.org_media_quotas to service_role;

revoke all on public.media_upload_sessions from public, anon, authenticated, service_role; grant INSERT on public.media_upload_sessions to anon; grant SELECT on public.media_upload_sessions to anon; grant UPDATE on public.media_upload_sessions to anon; grant DELETE on public.media_upload_sessions to anon; grant TRUNCATE on public.media_upload_sessions to anon; grant REFERENCES on public.media_upload_sessions to anon; grant TRIGGER on public.media_upload_sessions to anon; grant MAINTAIN on public.media_upload_sessions to anon; grant INSERT on public.media_upload_sessions to authenticated; grant SELECT on public.media_upload_sessions to authenticated; grant UPDATE on public.media_upload_sessions to authenticated; grant DELETE on public.media_upload_sessions to authenticated; grant TRUNCATE on public.media_upload_sessions to authenticated; grant REFERENCES on public.media_upload_sessions to authenticated; grant TRIGGER on public.media_upload_sessions to authenticated; grant MAINTAIN on public.media_upload_sessions to authenticated; grant INSERT on public.media_upload_sessions to service_role; grant SELECT on public.media_upload_sessions to service_role; grant UPDATE on public.media_upload_sessions to service_role; grant DELETE on public.media_upload_sessions to service_role; grant TRUNCATE on public.media_upload_sessions to service_role; grant REFERENCES on public.media_upload_sessions to service_role; grant TRIGGER on public.media_upload_sessions to service_role; grant MAINTAIN on public.media_upload_sessions to service_role;

revoke all on public.crm_counters from public, anon, authenticated, service_role; grant INSERT on public.crm_counters to authenticated; grant SELECT on public.crm_counters to authenticated; grant UPDATE on public.crm_counters to authenticated; grant DELETE on public.crm_counters to authenticated; grant TRUNCATE on public.crm_counters to authenticated; grant REFERENCES on public.crm_counters to authenticated; grant TRIGGER on public.crm_counters to authenticated; grant MAINTAIN on public.crm_counters to authenticated; grant INSERT on public.crm_counters to service_role; grant SELECT on public.crm_counters to service_role; grant UPDATE on public.crm_counters to service_role; grant DELETE on public.crm_counters to service_role; grant TRUNCATE on public.crm_counters to service_role; grant REFERENCES on public.crm_counters to service_role; grant TRIGGER on public.crm_counters to service_role; grant MAINTAIN on public.crm_counters to service_role;

revoke all on public.crm_properties from public, anon, authenticated, service_role; grant INSERT on public.crm_properties to authenticated; grant SELECT on public.crm_properties to authenticated; grant UPDATE on public.crm_properties to authenticated; grant DELETE on public.crm_properties to authenticated; grant TRUNCATE on public.crm_properties to authenticated; grant REFERENCES on public.crm_properties to authenticated; grant TRIGGER on public.crm_properties to authenticated; grant MAINTAIN on public.crm_properties to authenticated; grant INSERT on public.crm_properties to service_role; grant SELECT on public.crm_properties to service_role; grant UPDATE on public.crm_properties to service_role; grant DELETE on public.crm_properties to service_role; grant TRUNCATE on public.crm_properties to service_role; grant REFERENCES on public.crm_properties to service_role; grant TRIGGER on public.crm_properties to service_role; grant MAINTAIN on public.crm_properties to service_role;

revoke all on public.crm_jobs from public, anon, authenticated, service_role; grant INSERT on public.crm_jobs to authenticated; grant SELECT on public.crm_jobs to authenticated; grant UPDATE on public.crm_jobs to authenticated; grant DELETE on public.crm_jobs to authenticated; grant TRUNCATE on public.crm_jobs to authenticated; grant REFERENCES on public.crm_jobs to authenticated; grant TRIGGER on public.crm_jobs to authenticated; grant MAINTAIN on public.crm_jobs to authenticated; grant INSERT on public.crm_jobs to service_role; grant SELECT on public.crm_jobs to service_role; grant UPDATE on public.crm_jobs to service_role; grant DELETE on public.crm_jobs to service_role; grant TRUNCATE on public.crm_jobs to service_role; grant REFERENCES on public.crm_jobs to service_role; grant TRIGGER on public.crm_jobs to service_role; grant MAINTAIN on public.crm_jobs to service_role;

revoke all on public.job_parties from public, anon, authenticated, service_role; grant INSERT on public.job_parties to authenticated; grant SELECT on public.job_parties to authenticated; grant UPDATE on public.job_parties to authenticated; grant DELETE on public.job_parties to authenticated; grant TRUNCATE on public.job_parties to authenticated; grant REFERENCES on public.job_parties to authenticated; grant TRIGGER on public.job_parties to authenticated; grant MAINTAIN on public.job_parties to authenticated; grant INSERT on public.job_parties to service_role; grant SELECT on public.job_parties to service_role; grant UPDATE on public.job_parties to service_role; grant DELETE on public.job_parties to service_role; grant TRUNCATE on public.job_parties to service_role; grant REFERENCES on public.job_parties to service_role; grant TRIGGER on public.job_parties to service_role; grant MAINTAIN on public.job_parties to service_role;

revoke all on public.job_briefs from public, anon, authenticated, service_role; grant INSERT on public.job_briefs to authenticated; grant SELECT on public.job_briefs to authenticated; grant UPDATE on public.job_briefs to authenticated; grant DELETE on public.job_briefs to authenticated; grant TRUNCATE on public.job_briefs to authenticated; grant REFERENCES on public.job_briefs to authenticated; grant TRIGGER on public.job_briefs to authenticated; grant MAINTAIN on public.job_briefs to authenticated; grant INSERT on public.job_briefs to service_role; grant SELECT on public.job_briefs to service_role; grant UPDATE on public.job_briefs to service_role; grant DELETE on public.job_briefs to service_role; grant TRUNCATE on public.job_briefs to service_role; grant REFERENCES on public.job_briefs to service_role; grant TRIGGER on public.job_briefs to service_role; grant MAINTAIN on public.job_briefs to service_role;

revoke all on public.job_scope_items from public, anon, authenticated, service_role; grant INSERT on public.job_scope_items to authenticated; grant SELECT on public.job_scope_items to authenticated; grant UPDATE on public.job_scope_items to authenticated; grant DELETE on public.job_scope_items to authenticated; grant TRUNCATE on public.job_scope_items to authenticated; grant REFERENCES on public.job_scope_items to authenticated; grant TRIGGER on public.job_scope_items to authenticated; grant MAINTAIN on public.job_scope_items to authenticated; grant INSERT on public.job_scope_items to service_role; grant SELECT on public.job_scope_items to service_role; grant UPDATE on public.job_scope_items to service_role; grant DELETE on public.job_scope_items to service_role; grant TRUNCATE on public.job_scope_items to service_role; grant REFERENCES on public.job_scope_items to service_role; grant TRIGGER on public.job_scope_items to service_role; grant MAINTAIN on public.job_scope_items to service_role;

revoke all on public.job_acknowledgements from public, anon, authenticated, service_role; grant INSERT on public.job_acknowledgements to authenticated; grant SELECT on public.job_acknowledgements to authenticated; grant UPDATE on public.job_acknowledgements to authenticated; grant DELETE on public.job_acknowledgements to authenticated; grant TRUNCATE on public.job_acknowledgements to authenticated; grant REFERENCES on public.job_acknowledgements to authenticated; grant TRIGGER on public.job_acknowledgements to authenticated; grant MAINTAIN on public.job_acknowledgements to authenticated; grant INSERT on public.job_acknowledgements to service_role; grant SELECT on public.job_acknowledgements to service_role; grant UPDATE on public.job_acknowledgements to service_role; grant DELETE on public.job_acknowledgements to service_role; grant TRUNCATE on public.job_acknowledgements to service_role; grant REFERENCES on public.job_acknowledgements to service_role; grant TRIGGER on public.job_acknowledgements to service_role; grant MAINTAIN on public.job_acknowledgements to service_role;

revoke all on public.job_messages from public, anon, authenticated, service_role; grant INSERT on public.job_messages to authenticated; grant SELECT on public.job_messages to authenticated; grant UPDATE on public.job_messages to authenticated; grant DELETE on public.job_messages to authenticated; grant TRUNCATE on public.job_messages to authenticated; grant REFERENCES on public.job_messages to authenticated; grant TRIGGER on public.job_messages to authenticated; grant MAINTAIN on public.job_messages to authenticated; grant INSERT on public.job_messages to service_role; grant SELECT on public.job_messages to service_role; grant UPDATE on public.job_messages to service_role; grant DELETE on public.job_messages to service_role; grant TRUNCATE on public.job_messages to service_role; grant REFERENCES on public.job_messages to service_role; grant TRIGGER on public.job_messages to service_role; grant MAINTAIN on public.job_messages to service_role;

revoke all on public.job_share_status from public, anon, authenticated, service_role; grant INSERT on public.job_share_status to anon; grant SELECT on public.job_share_status to anon; grant UPDATE on public.job_share_status to anon; grant DELETE on public.job_share_status to anon; grant TRUNCATE on public.job_share_status to anon; grant REFERENCES on public.job_share_status to anon; grant TRIGGER on public.job_share_status to anon; grant MAINTAIN on public.job_share_status to anon; grant INSERT on public.job_share_status to authenticated; grant SELECT on public.job_share_status to authenticated; grant UPDATE on public.job_share_status to authenticated; grant DELETE on public.job_share_status to authenticated; grant TRUNCATE on public.job_share_status to authenticated; grant REFERENCES on public.job_share_status to authenticated; grant TRIGGER on public.job_share_status to authenticated; grant MAINTAIN on public.job_share_status to authenticated; grant INSERT on public.job_share_status to service_role; grant SELECT on public.job_share_status to service_role; grant UPDATE on public.job_share_status to service_role; grant DELETE on public.job_share_status to service_role; grant TRUNCATE on public.job_share_status to service_role; grant REFERENCES on public.job_share_status to service_role; grant TRIGGER on public.job_share_status to service_role; grant MAINTAIN on public.job_share_status to service_role;

revoke all on public.job_proofs from public, anon, authenticated, service_role; grant INSERT on public.job_proofs to anon; grant SELECT on public.job_proofs to anon; grant DELETE on public.job_proofs to anon; grant TRUNCATE on public.job_proofs to anon; grant REFERENCES on public.job_proofs to anon; grant TRIGGER on public.job_proofs to anon; grant MAINTAIN on public.job_proofs to anon; grant INSERT on public.job_proofs to authenticated; grant SELECT on public.job_proofs to authenticated; grant DELETE on public.job_proofs to authenticated; grant TRUNCATE on public.job_proofs to authenticated; grant REFERENCES on public.job_proofs to authenticated; grant TRIGGER on public.job_proofs to authenticated; grant MAINTAIN on public.job_proofs to authenticated; grant INSERT on public.job_proofs to service_role; grant SELECT on public.job_proofs to service_role; grant UPDATE on public.job_proofs to service_role; grant DELETE on public.job_proofs to service_role; grant TRUNCATE on public.job_proofs to service_role; grant REFERENCES on public.job_proofs to service_role; grant TRIGGER on public.job_proofs to service_role; grant MAINTAIN on public.job_proofs to service_role;

revoke all on public.job_proof_frames from public, anon, authenticated, service_role; grant INSERT on public.job_proof_frames to anon; grant SELECT on public.job_proof_frames to anon; grant UPDATE on public.job_proof_frames to anon; grant DELETE on public.job_proof_frames to anon; grant TRUNCATE on public.job_proof_frames to anon; grant REFERENCES on public.job_proof_frames to anon; grant TRIGGER on public.job_proof_frames to anon; grant MAINTAIN on public.job_proof_frames to anon; grant INSERT on public.job_proof_frames to authenticated; grant SELECT on public.job_proof_frames to authenticated; grant UPDATE on public.job_proof_frames to authenticated; grant DELETE on public.job_proof_frames to authenticated; grant TRUNCATE on public.job_proof_frames to authenticated; grant REFERENCES on public.job_proof_frames to authenticated; grant TRIGGER on public.job_proof_frames to authenticated; grant MAINTAIN on public.job_proof_frames to authenticated; grant INSERT on public.job_proof_frames to service_role; grant SELECT on public.job_proof_frames to service_role; grant UPDATE on public.job_proof_frames to service_role; grant DELETE on public.job_proof_frames to service_role; grant TRUNCATE on public.job_proof_frames to service_role; grant REFERENCES on public.job_proof_frames to service_role; grant TRIGGER on public.job_proof_frames to service_role; grant MAINTAIN on public.job_proof_frames to service_role;

revoke all on public.job_proof_questions from public, anon, authenticated, service_role; grant INSERT on public.job_proof_questions to anon; grant SELECT on public.job_proof_questions to anon; grant UPDATE on public.job_proof_questions to anon; grant DELETE on public.job_proof_questions to anon; grant TRUNCATE on public.job_proof_questions to anon; grant REFERENCES on public.job_proof_questions to anon; grant TRIGGER on public.job_proof_questions to anon; grant MAINTAIN on public.job_proof_questions to anon; grant INSERT on public.job_proof_questions to authenticated; grant SELECT on public.job_proof_questions to authenticated; grant UPDATE on public.job_proof_questions to authenticated; grant DELETE on public.job_proof_questions to authenticated; grant TRUNCATE on public.job_proof_questions to authenticated; grant REFERENCES on public.job_proof_questions to authenticated; grant TRIGGER on public.job_proof_questions to authenticated; grant MAINTAIN on public.job_proof_questions to authenticated; grant INSERT on public.job_proof_questions to service_role; grant SELECT on public.job_proof_questions to service_role; grant UPDATE on public.job_proof_questions to service_role; grant DELETE on public.job_proof_questions to service_role; grant TRUNCATE on public.job_proof_questions to service_role; grant REFERENCES on public.job_proof_questions to service_role; grant TRIGGER on public.job_proof_questions to service_role; grant MAINTAIN on public.job_proof_questions to service_role;

revoke all on public.job_proof_days from public, anon, authenticated, service_role; grant INSERT on public.job_proof_days to anon; grant SELECT on public.job_proof_days to anon; grant UPDATE on public.job_proof_days to anon; grant DELETE on public.job_proof_days to anon; grant TRUNCATE on public.job_proof_days to anon; grant REFERENCES on public.job_proof_days to anon; grant TRIGGER on public.job_proof_days to anon; grant MAINTAIN on public.job_proof_days to anon; grant INSERT on public.job_proof_days to authenticated; grant SELECT on public.job_proof_days to authenticated; grant UPDATE on public.job_proof_days to authenticated; grant DELETE on public.job_proof_days to authenticated; grant TRUNCATE on public.job_proof_days to authenticated; grant REFERENCES on public.job_proof_days to authenticated; grant TRIGGER on public.job_proof_days to authenticated; grant MAINTAIN on public.job_proof_days to authenticated; grant INSERT on public.job_proof_days to service_role; grant SELECT on public.job_proof_days to service_role; grant UPDATE on public.job_proof_days to service_role; grant DELETE on public.job_proof_days to service_role; grant TRUNCATE on public.job_proof_days to service_role; grant REFERENCES on public.job_proof_days to service_role; grant TRIGGER on public.job_proof_days to service_role; grant MAINTAIN on public.job_proof_days to service_role;

revoke all on public.job_evidence_access from public, anon, authenticated, service_role; grant INSERT on public.job_evidence_access to anon; grant SELECT on public.job_evidence_access to anon; grant UPDATE on public.job_evidence_access to anon; grant DELETE on public.job_evidence_access to anon; grant TRUNCATE on public.job_evidence_access to anon; grant REFERENCES on public.job_evidence_access to anon; grant TRIGGER on public.job_evidence_access to anon; grant MAINTAIN on public.job_evidence_access to anon; grant INSERT on public.job_evidence_access to authenticated; grant SELECT on public.job_evidence_access to authenticated; grant UPDATE on public.job_evidence_access to authenticated; grant DELETE on public.job_evidence_access to authenticated; grant TRUNCATE on public.job_evidence_access to authenticated; grant REFERENCES on public.job_evidence_access to authenticated; grant TRIGGER on public.job_evidence_access to authenticated; grant MAINTAIN on public.job_evidence_access to authenticated; grant INSERT on public.job_evidence_access to service_role; grant SELECT on public.job_evidence_access to service_role; grant UPDATE on public.job_evidence_access to service_role; grant DELETE on public.job_evidence_access to service_role; grant TRUNCATE on public.job_evidence_access to service_role; grant REFERENCES on public.job_evidence_access to service_role; grant TRIGGER on public.job_evidence_access to service_role; grant MAINTAIN on public.job_evidence_access to service_role;

revoke all on public.job_evidence_policy from public, anon, authenticated, service_role; grant INSERT on public.job_evidence_policy to anon; grant SELECT on public.job_evidence_policy to anon; grant UPDATE on public.job_evidence_policy to anon; grant DELETE on public.job_evidence_policy to anon; grant TRUNCATE on public.job_evidence_policy to anon; grant REFERENCES on public.job_evidence_policy to anon; grant TRIGGER on public.job_evidence_policy to anon; grant MAINTAIN on public.job_evidence_policy to anon; grant INSERT on public.job_evidence_policy to authenticated; grant SELECT on public.job_evidence_policy to authenticated; grant UPDATE on public.job_evidence_policy to authenticated; grant DELETE on public.job_evidence_policy to authenticated; grant TRUNCATE on public.job_evidence_policy to authenticated; grant REFERENCES on public.job_evidence_policy to authenticated; grant TRIGGER on public.job_evidence_policy to authenticated; grant MAINTAIN on public.job_evidence_policy to authenticated; grant INSERT on public.job_evidence_policy to service_role; grant SELECT on public.job_evidence_policy to service_role; grant UPDATE on public.job_evidence_policy to service_role; grant DELETE on public.job_evidence_policy to service_role; grant TRUNCATE on public.job_evidence_policy to service_role; grant REFERENCES on public.job_evidence_policy to service_role; grant TRIGGER on public.job_evidence_policy to service_role; grant MAINTAIN on public.job_evidence_policy to service_role;

revoke all on public.job_evidence_items from public, anon, authenticated, service_role; grant INSERT on public.job_evidence_items to anon; grant SELECT on public.job_evidence_items to anon; grant UPDATE on public.job_evidence_items to anon; grant DELETE on public.job_evidence_items to anon; grant TRUNCATE on public.job_evidence_items to anon; grant REFERENCES on public.job_evidence_items to anon; grant TRIGGER on public.job_evidence_items to anon; grant MAINTAIN on public.job_evidence_items to anon; grant INSERT on public.job_evidence_items to authenticated; grant SELECT on public.job_evidence_items to authenticated; grant UPDATE on public.job_evidence_items to authenticated; grant DELETE on public.job_evidence_items to authenticated; grant TRUNCATE on public.job_evidence_items to authenticated; grant REFERENCES on public.job_evidence_items to authenticated; grant TRIGGER on public.job_evidence_items to authenticated; grant MAINTAIN on public.job_evidence_items to authenticated; grant INSERT on public.job_evidence_items to service_role; grant SELECT on public.job_evidence_items to service_role; grant UPDATE on public.job_evidence_items to service_role; grant DELETE on public.job_evidence_items to service_role; grant TRUNCATE on public.job_evidence_items to service_role; grant REFERENCES on public.job_evidence_items to service_role; grant TRIGGER on public.job_evidence_items to service_role; grant MAINTAIN on public.job_evidence_items to service_role;

revoke all on public.verifier_shares from public, anon, authenticated, service_role; grant INSERT on public.verifier_shares to authenticated; grant SELECT on public.verifier_shares to authenticated; grant UPDATE on public.verifier_shares to authenticated; grant DELETE on public.verifier_shares to authenticated; grant TRUNCATE on public.verifier_shares to authenticated; grant REFERENCES on public.verifier_shares to authenticated; grant TRIGGER on public.verifier_shares to authenticated; grant MAINTAIN on public.verifier_shares to authenticated; grant INSERT on public.verifier_shares to service_role; grant SELECT on public.verifier_shares to service_role; grant UPDATE on public.verifier_shares to service_role; grant DELETE on public.verifier_shares to service_role; grant TRUNCATE on public.verifier_shares to service_role; grant REFERENCES on public.verifier_shares to service_role; grant TRIGGER on public.verifier_shares to service_role; grant MAINTAIN on public.verifier_shares to service_role;

revoke all on public.field_identities from public, anon, authenticated, service_role; grant INSERT on public.field_identities to authenticated; grant SELECT on public.field_identities to authenticated; grant UPDATE on public.field_identities to authenticated; grant DELETE on public.field_identities to authenticated; grant TRUNCATE on public.field_identities to authenticated; grant REFERENCES on public.field_identities to authenticated; grant TRIGGER on public.field_identities to authenticated; grant MAINTAIN on public.field_identities to authenticated; grant INSERT on public.field_identities to service_role; grant SELECT on public.field_identities to service_role; grant UPDATE on public.field_identities to service_role; grant DELETE on public.field_identities to service_role; grant TRUNCATE on public.field_identities to service_role; grant REFERENCES on public.field_identities to service_role; grant TRIGGER on public.field_identities to service_role; grant MAINTAIN on public.field_identities to service_role;

revoke all on public.field_identity_codes from public, anon, authenticated, service_role; grant INSERT on public.field_identity_codes to authenticated; grant SELECT on public.field_identity_codes to authenticated; grant UPDATE on public.field_identity_codes to authenticated; grant DELETE on public.field_identity_codes to authenticated; grant TRUNCATE on public.field_identity_codes to authenticated; grant REFERENCES on public.field_identity_codes to authenticated; grant TRIGGER on public.field_identity_codes to authenticated; grant MAINTAIN on public.field_identity_codes to authenticated; grant INSERT on public.field_identity_codes to service_role; grant SELECT on public.field_identity_codes to service_role; grant UPDATE on public.field_identity_codes to service_role; grant DELETE on public.field_identity_codes to service_role; grant TRUNCATE on public.field_identity_codes to service_role; grant REFERENCES on public.field_identity_codes to service_role; grant TRIGGER on public.field_identity_codes to service_role; grant MAINTAIN on public.field_identity_codes to service_role;

revoke all on public.job_party_claims from public, anon, authenticated, service_role; grant INSERT on public.job_party_claims to authenticated; grant SELECT on public.job_party_claims to authenticated; grant UPDATE on public.job_party_claims to authenticated; grant DELETE on public.job_party_claims to authenticated; grant TRUNCATE on public.job_party_claims to authenticated; grant REFERENCES on public.job_party_claims to authenticated; grant TRIGGER on public.job_party_claims to authenticated; grant MAINTAIN on public.job_party_claims to authenticated; grant INSERT on public.job_party_claims to service_role; grant SELECT on public.job_party_claims to service_role; grant UPDATE on public.job_party_claims to service_role; grant DELETE on public.job_party_claims to service_role; grant TRUNCATE on public.job_party_claims to service_role; grant REFERENCES on public.job_party_claims to service_role; grant TRIGGER on public.job_party_claims to service_role; grant MAINTAIN on public.job_party_claims to service_role;

revoke all on public.field_sessions from public, anon, authenticated, service_role; grant INSERT on public.field_sessions to authenticated; grant SELECT on public.field_sessions to authenticated; grant UPDATE on public.field_sessions to authenticated; grant DELETE on public.field_sessions to authenticated; grant TRUNCATE on public.field_sessions to authenticated; grant REFERENCES on public.field_sessions to authenticated; grant TRIGGER on public.field_sessions to authenticated; grant MAINTAIN on public.field_sessions to authenticated; grant INSERT on public.field_sessions to service_role; grant SELECT on public.field_sessions to service_role; grant UPDATE on public.field_sessions to service_role; grant DELETE on public.field_sessions to service_role; grant TRUNCATE on public.field_sessions to service_role; grant REFERENCES on public.field_sessions to service_role; grant TRIGGER on public.field_sessions to service_role; grant MAINTAIN on public.field_sessions to service_role;

revoke all on public.job_intake from public, anon, authenticated, service_role; grant INSERT on public.job_intake to authenticated; grant SELECT on public.job_intake to authenticated; grant UPDATE on public.job_intake to authenticated; grant DELETE on public.job_intake to authenticated; grant TRUNCATE on public.job_intake to authenticated; grant REFERENCES on public.job_intake to authenticated; grant TRIGGER on public.job_intake to authenticated; grant MAINTAIN on public.job_intake to authenticated; grant INSERT on public.job_intake to service_role; grant SELECT on public.job_intake to service_role; grant UPDATE on public.job_intake to service_role; grant DELETE on public.job_intake to service_role; grant TRUNCATE on public.job_intake to service_role; grant REFERENCES on public.job_intake to service_role; grant TRIGGER on public.job_intake to service_role; grant MAINTAIN on public.job_intake to service_role;

revoke all on public.scope_documents from public, anon, authenticated, service_role; grant INSERT on public.scope_documents to authenticated; grant SELECT on public.scope_documents to authenticated; grant UPDATE on public.scope_documents to authenticated; grant DELETE on public.scope_documents to authenticated; grant TRUNCATE on public.scope_documents to authenticated; grant REFERENCES on public.scope_documents to authenticated; grant TRIGGER on public.scope_documents to authenticated; grant MAINTAIN on public.scope_documents to authenticated; grant INSERT on public.scope_documents to service_role; grant SELECT on public.scope_documents to service_role; grant UPDATE on public.scope_documents to service_role; grant DELETE on public.scope_documents to service_role; grant TRUNCATE on public.scope_documents to service_role; grant REFERENCES on public.scope_documents to service_role; grant TRIGGER on public.scope_documents to service_role; grant MAINTAIN on public.scope_documents to service_role;

revoke all on public.job_proof_segments from public, anon, authenticated, service_role; grant INSERT on public.job_proof_segments to authenticated; grant SELECT on public.job_proof_segments to authenticated; grant UPDATE on public.job_proof_segments to authenticated; grant DELETE on public.job_proof_segments to authenticated; grant TRUNCATE on public.job_proof_segments to authenticated; grant REFERENCES on public.job_proof_segments to authenticated; grant TRIGGER on public.job_proof_segments to authenticated; grant MAINTAIN on public.job_proof_segments to authenticated; grant INSERT on public.job_proof_segments to service_role; grant SELECT on public.job_proof_segments to service_role; grant UPDATE on public.job_proof_segments to service_role; grant DELETE on public.job_proof_segments to service_role; grant TRUNCATE on public.job_proof_segments to service_role; grant REFERENCES on public.job_proof_segments to service_role; grant TRIGGER on public.job_proof_segments to service_role; grant MAINTAIN on public.job_proof_segments to service_role;

revoke all on public.evidence_download_policy from public, anon, authenticated, service_role; grant INSERT on public.evidence_download_policy to authenticated; grant SELECT on public.evidence_download_policy to authenticated; grant UPDATE on public.evidence_download_policy to authenticated; grant DELETE on public.evidence_download_policy to authenticated; grant TRUNCATE on public.evidence_download_policy to authenticated; grant REFERENCES on public.evidence_download_policy to authenticated; grant TRIGGER on public.evidence_download_policy to authenticated; grant MAINTAIN on public.evidence_download_policy to authenticated; grant INSERT on public.evidence_download_policy to service_role; grant SELECT on public.evidence_download_policy to service_role; grant UPDATE on public.evidence_download_policy to service_role; grant DELETE on public.evidence_download_policy to service_role; grant TRUNCATE on public.evidence_download_policy to service_role; grant REFERENCES on public.evidence_download_policy to service_role; grant TRIGGER on public.evidence_download_policy to service_role; grant MAINTAIN on public.evidence_download_policy to service_role;

revoke all on public.evidence_downloads from public, anon, authenticated, service_role; grant INSERT on public.evidence_downloads to authenticated; grant SELECT on public.evidence_downloads to authenticated; grant UPDATE on public.evidence_downloads to authenticated; grant DELETE on public.evidence_downloads to authenticated; grant TRUNCATE on public.evidence_downloads to authenticated; grant REFERENCES on public.evidence_downloads to authenticated; grant TRIGGER on public.evidence_downloads to authenticated; grant MAINTAIN on public.evidence_downloads to authenticated; grant INSERT on public.evidence_downloads to service_role; grant SELECT on public.evidence_downloads to service_role; grant UPDATE on public.evidence_downloads to service_role; grant DELETE on public.evidence_downloads to service_role; grant TRUNCATE on public.evidence_downloads to service_role; grant REFERENCES on public.evidence_downloads to service_role; grant TRIGGER on public.evidence_downloads to service_role; grant MAINTAIN on public.evidence_downloads to service_role;

revoke all on public.org_invites from public, anon, authenticated, service_role; grant INSERT on public.org_invites to anon; grant SELECT on public.org_invites to anon; grant UPDATE on public.org_invites to anon; grant DELETE on public.org_invites to anon; grant TRUNCATE on public.org_invites to anon; grant REFERENCES on public.org_invites to anon; grant TRIGGER on public.org_invites to anon; grant MAINTAIN on public.org_invites to anon; grant INSERT on public.org_invites to authenticated; grant SELECT on public.org_invites to authenticated; grant UPDATE on public.org_invites to authenticated; grant DELETE on public.org_invites to authenticated; grant TRUNCATE on public.org_invites to authenticated; grant REFERENCES on public.org_invites to authenticated; grant TRIGGER on public.org_invites to authenticated; grant MAINTAIN on public.org_invites to authenticated; grant INSERT on public.org_invites to service_role; grant SELECT on public.org_invites to service_role; grant UPDATE on public.org_invites to service_role; grant DELETE on public.org_invites to service_role; grant TRUNCATE on public.org_invites to service_role; grant REFERENCES on public.org_invites to service_role; grant TRIGGER on public.org_invites to service_role; grant MAINTAIN on public.org_invites to service_role;

revoke all on public.qualifying_workflow_types from public, anon, authenticated, service_role; grant INSERT on public.qualifying_workflow_types to anon; grant SELECT on public.qualifying_workflow_types to anon; grant UPDATE on public.qualifying_workflow_types to anon; grant DELETE on public.qualifying_workflow_types to anon; grant TRUNCATE on public.qualifying_workflow_types to anon; grant REFERENCES on public.qualifying_workflow_types to anon; grant TRIGGER on public.qualifying_workflow_types to anon; grant MAINTAIN on public.qualifying_workflow_types to anon; grant INSERT on public.qualifying_workflow_types to authenticated; grant SELECT on public.qualifying_workflow_types to authenticated; grant UPDATE on public.qualifying_workflow_types to authenticated; grant DELETE on public.qualifying_workflow_types to authenticated; grant TRUNCATE on public.qualifying_workflow_types to authenticated; grant REFERENCES on public.qualifying_workflow_types to authenticated; grant TRIGGER on public.qualifying_workflow_types to authenticated; grant MAINTAIN on public.qualifying_workflow_types to authenticated; grant INSERT on public.qualifying_workflow_types to service_role; grant SELECT on public.qualifying_workflow_types to service_role; grant UPDATE on public.qualifying_workflow_types to service_role; grant DELETE on public.qualifying_workflow_types to service_role; grant TRUNCATE on public.qualifying_workflow_types to service_role; grant REFERENCES on public.qualifying_workflow_types to service_role; grant TRIGGER on public.qualifying_workflow_types to service_role; grant MAINTAIN on public.qualifying_workflow_types to service_role;

revoke all on public.metering_plans from public, anon, authenticated, service_role; grant INSERT on public.metering_plans to anon; grant SELECT on public.metering_plans to anon; grant UPDATE on public.metering_plans to anon; grant DELETE on public.metering_plans to anon; grant TRUNCATE on public.metering_plans to anon; grant REFERENCES on public.metering_plans to anon; grant TRIGGER on public.metering_plans to anon; grant MAINTAIN on public.metering_plans to anon; grant INSERT on public.metering_plans to authenticated; grant SELECT on public.metering_plans to authenticated; grant UPDATE on public.metering_plans to authenticated; grant DELETE on public.metering_plans to authenticated; grant TRUNCATE on public.metering_plans to authenticated; grant REFERENCES on public.metering_plans to authenticated; grant TRIGGER on public.metering_plans to authenticated; grant MAINTAIN on public.metering_plans to authenticated; grant INSERT on public.metering_plans to service_role; grant SELECT on public.metering_plans to service_role; grant UPDATE on public.metering_plans to service_role; grant DELETE on public.metering_plans to service_role; grant TRUNCATE on public.metering_plans to service_role; grant REFERENCES on public.metering_plans to service_role; grant TRIGGER on public.metering_plans to service_role; grant MAINTAIN on public.metering_plans to service_role;

revoke all on public.metering_plan_versions from public, anon, authenticated, service_role; grant INSERT on public.metering_plan_versions to anon; grant SELECT on public.metering_plan_versions to anon; grant UPDATE on public.metering_plan_versions to anon; grant DELETE on public.metering_plan_versions to anon; grant TRUNCATE on public.metering_plan_versions to anon; grant REFERENCES on public.metering_plan_versions to anon; grant TRIGGER on public.metering_plan_versions to anon; grant MAINTAIN on public.metering_plan_versions to anon; grant INSERT on public.metering_plan_versions to authenticated; grant SELECT on public.metering_plan_versions to authenticated; grant UPDATE on public.metering_plan_versions to authenticated; grant DELETE on public.metering_plan_versions to authenticated; grant TRUNCATE on public.metering_plan_versions to authenticated; grant REFERENCES on public.metering_plan_versions to authenticated; grant TRIGGER on public.metering_plan_versions to authenticated; grant MAINTAIN on public.metering_plan_versions to authenticated; grant INSERT on public.metering_plan_versions to service_role; grant SELECT on public.metering_plan_versions to service_role; grant UPDATE on public.metering_plan_versions to service_role; grant DELETE on public.metering_plan_versions to service_role; grant TRUNCATE on public.metering_plan_versions to service_role; grant REFERENCES on public.metering_plan_versions to service_role; grant TRIGGER on public.metering_plan_versions to service_role; grant MAINTAIN on public.metering_plan_versions to service_role;

revoke all on public.org_metering from public, anon, authenticated, service_role; grant INSERT on public.org_metering to anon; grant SELECT on public.org_metering to anon; grant UPDATE on public.org_metering to anon; grant DELETE on public.org_metering to anon; grant TRUNCATE on public.org_metering to anon; grant REFERENCES on public.org_metering to anon; grant TRIGGER on public.org_metering to anon; grant MAINTAIN on public.org_metering to anon; grant INSERT on public.org_metering to authenticated; grant SELECT on public.org_metering to authenticated; grant UPDATE on public.org_metering to authenticated; grant DELETE on public.org_metering to authenticated; grant TRUNCATE on public.org_metering to authenticated; grant REFERENCES on public.org_metering to authenticated; grant TRIGGER on public.org_metering to authenticated; grant MAINTAIN on public.org_metering to authenticated; grant INSERT on public.org_metering to service_role; grant SELECT on public.org_metering to service_role; grant UPDATE on public.org_metering to service_role; grant DELETE on public.org_metering to service_role; grant TRUNCATE on public.org_metering to service_role; grant REFERENCES on public.org_metering to service_role; grant TRIGGER on public.org_metering to service_role; grant MAINTAIN on public.org_metering to service_role;

revoke all on public.billing_period_jobs from public, anon, authenticated, service_role; grant INSERT on public.billing_period_jobs to anon; grant SELECT on public.billing_period_jobs to anon; grant UPDATE on public.billing_period_jobs to anon; grant DELETE on public.billing_period_jobs to anon; grant TRUNCATE on public.billing_period_jobs to anon; grant REFERENCES on public.billing_period_jobs to anon; grant TRIGGER on public.billing_period_jobs to anon; grant MAINTAIN on public.billing_period_jobs to anon; grant INSERT on public.billing_period_jobs to authenticated; grant SELECT on public.billing_period_jobs to authenticated; grant UPDATE on public.billing_period_jobs to authenticated; grant DELETE on public.billing_period_jobs to authenticated; grant TRUNCATE on public.billing_period_jobs to authenticated; grant REFERENCES on public.billing_period_jobs to authenticated; grant TRIGGER on public.billing_period_jobs to authenticated; grant MAINTAIN on public.billing_period_jobs to authenticated; grant INSERT on public.billing_period_jobs to service_role; grant SELECT on public.billing_period_jobs to service_role; grant UPDATE on public.billing_period_jobs to service_role; grant DELETE on public.billing_period_jobs to service_role; grant TRUNCATE on public.billing_period_jobs to service_role; grant REFERENCES on public.billing_period_jobs to service_role; grant TRIGGER on public.billing_period_jobs to service_role; grant MAINTAIN on public.billing_period_jobs to service_role;

revoke all on public.billing_period_statements from public, anon, authenticated, service_role; grant INSERT on public.billing_period_statements to anon; grant SELECT on public.billing_period_statements to anon; grant UPDATE on public.billing_period_statements to anon; grant DELETE on public.billing_period_statements to anon; grant TRUNCATE on public.billing_period_statements to anon; grant REFERENCES on public.billing_period_statements to anon; grant TRIGGER on public.billing_period_statements to anon; grant MAINTAIN on public.billing_period_statements to anon; grant INSERT on public.billing_period_statements to authenticated; grant SELECT on public.billing_period_statements to authenticated; grant UPDATE on public.billing_period_statements to authenticated; grant DELETE on public.billing_period_statements to authenticated; grant TRUNCATE on public.billing_period_statements to authenticated; grant REFERENCES on public.billing_period_statements to authenticated; grant TRIGGER on public.billing_period_statements to authenticated; grant MAINTAIN on public.billing_period_statements to authenticated; grant INSERT on public.billing_period_statements to service_role; grant SELECT on public.billing_period_statements to service_role; grant UPDATE on public.billing_period_statements to service_role; grant DELETE on public.billing_period_statements to service_role; grant TRUNCATE on public.billing_period_statements to service_role; grant REFERENCES on public.billing_period_statements to service_role; grant TRIGGER on public.billing_period_statements to service_role; grant MAINTAIN on public.billing_period_statements to service_role;

revoke all on public.metering_alerts from public, anon, authenticated, service_role; grant INSERT on public.metering_alerts to anon; grant SELECT on public.metering_alerts to anon; grant UPDATE on public.metering_alerts to anon; grant DELETE on public.metering_alerts to anon; grant TRUNCATE on public.metering_alerts to anon; grant REFERENCES on public.metering_alerts to anon; grant TRIGGER on public.metering_alerts to anon; grant MAINTAIN on public.metering_alerts to anon; grant INSERT on public.metering_alerts to authenticated; grant SELECT on public.metering_alerts to authenticated; grant UPDATE on public.metering_alerts to authenticated; grant DELETE on public.metering_alerts to authenticated; grant TRUNCATE on public.metering_alerts to authenticated; grant REFERENCES on public.metering_alerts to authenticated; grant TRIGGER on public.metering_alerts to authenticated; grant MAINTAIN on public.metering_alerts to authenticated; grant INSERT on public.metering_alerts to service_role; grant SELECT on public.metering_alerts to service_role; grant UPDATE on public.metering_alerts to service_role; grant DELETE on public.metering_alerts to service_role; grant TRUNCATE on public.metering_alerts to service_role; grant REFERENCES on public.metering_alerts to service_role; grant TRIGGER on public.metering_alerts to service_role; grant MAINTAIN on public.metering_alerts to service_role;

revoke all on public.job_locations from public, anon, authenticated, service_role; grant INSERT on public.job_locations to authenticated; grant SELECT on public.job_locations to authenticated; grant UPDATE on public.job_locations to authenticated; grant DELETE on public.job_locations to authenticated; grant TRUNCATE on public.job_locations to authenticated; grant REFERENCES on public.job_locations to authenticated; grant TRIGGER on public.job_locations to authenticated; grant MAINTAIN on public.job_locations to authenticated; grant INSERT on public.job_locations to service_role; grant SELECT on public.job_locations to service_role; grant UPDATE on public.job_locations to service_role; grant DELETE on public.job_locations to service_role; grant TRUNCATE on public.job_locations to service_role; grant REFERENCES on public.job_locations to service_role; grant TRIGGER on public.job_locations to service_role; grant MAINTAIN on public.job_locations to service_role;

revoke all on public.verification_videos from public, anon, authenticated, service_role; grant INSERT on public.verification_videos to anon; grant SELECT on public.verification_videos to anon; grant UPDATE on public.verification_videos to anon; grant DELETE on public.verification_videos to anon; grant TRUNCATE on public.verification_videos to anon; grant REFERENCES on public.verification_videos to anon; grant TRIGGER on public.verification_videos to anon; grant MAINTAIN on public.verification_videos to anon; grant INSERT on public.verification_videos to authenticated; grant SELECT on public.verification_videos to authenticated; grant UPDATE on public.verification_videos to authenticated; grant DELETE on public.verification_videos to authenticated; grant TRUNCATE on public.verification_videos to authenticated; grant REFERENCES on public.verification_videos to authenticated; grant TRIGGER on public.verification_videos to authenticated; grant MAINTAIN on public.verification_videos to authenticated; grant INSERT on public.verification_videos to service_role; grant SELECT on public.verification_videos to service_role; grant UPDATE on public.verification_videos to service_role; grant DELETE on public.verification_videos to service_role; grant TRUNCATE on public.verification_videos to service_role; grant REFERENCES on public.verification_videos to service_role; grant TRIGGER on public.verification_videos to service_role; grant MAINTAIN on public.verification_videos to service_role;

revoke all on public.video_processing_jobs from public, anon, authenticated, service_role; grant INSERT on public.video_processing_jobs to anon; grant SELECT on public.video_processing_jobs to anon; grant UPDATE on public.video_processing_jobs to anon; grant DELETE on public.video_processing_jobs to anon; grant TRUNCATE on public.video_processing_jobs to anon; grant REFERENCES on public.video_processing_jobs to anon; grant TRIGGER on public.video_processing_jobs to anon; grant MAINTAIN on public.video_processing_jobs to anon; grant INSERT on public.video_processing_jobs to authenticated; grant SELECT on public.video_processing_jobs to authenticated; grant UPDATE on public.video_processing_jobs to authenticated; grant DELETE on public.video_processing_jobs to authenticated; grant TRUNCATE on public.video_processing_jobs to authenticated; grant REFERENCES on public.video_processing_jobs to authenticated; grant TRIGGER on public.video_processing_jobs to authenticated; grant MAINTAIN on public.video_processing_jobs to authenticated; grant INSERT on public.video_processing_jobs to service_role; grant SELECT on public.video_processing_jobs to service_role; grant UPDATE on public.video_processing_jobs to service_role; grant DELETE on public.video_processing_jobs to service_role; grant TRUNCATE on public.video_processing_jobs to service_role; grant REFERENCES on public.video_processing_jobs to service_role; grant TRIGGER on public.video_processing_jobs to service_role; grant MAINTAIN on public.video_processing_jobs to service_role;

revoke all on public.video_processing_steps from public, anon, authenticated, service_role; grant INSERT on public.video_processing_steps to anon; grant SELECT on public.video_processing_steps to anon; grant UPDATE on public.video_processing_steps to anon; grant DELETE on public.video_processing_steps to anon; grant TRUNCATE on public.video_processing_steps to anon; grant REFERENCES on public.video_processing_steps to anon; grant TRIGGER on public.video_processing_steps to anon; grant MAINTAIN on public.video_processing_steps to anon; grant INSERT on public.video_processing_steps to authenticated; grant SELECT on public.video_processing_steps to authenticated; grant UPDATE on public.video_processing_steps to authenticated; grant DELETE on public.video_processing_steps to authenticated; grant TRUNCATE on public.video_processing_steps to authenticated; grant REFERENCES on public.video_processing_steps to authenticated; grant TRIGGER on public.video_processing_steps to authenticated; grant MAINTAIN on public.video_processing_steps to authenticated; grant INSERT on public.video_processing_steps to service_role; grant SELECT on public.video_processing_steps to service_role; grant UPDATE on public.video_processing_steps to service_role; grant DELETE on public.video_processing_steps to service_role; grant TRUNCATE on public.video_processing_steps to service_role; grant REFERENCES on public.video_processing_steps to service_role; grant TRIGGER on public.video_processing_steps to service_role; grant MAINTAIN on public.video_processing_steps to service_role;

revoke all on public.verification_scenes from public, anon, authenticated, service_role; grant INSERT on public.verification_scenes to anon; grant SELECT on public.verification_scenes to anon; grant UPDATE on public.verification_scenes to anon; grant DELETE on public.verification_scenes to anon; grant TRUNCATE on public.verification_scenes to anon; grant REFERENCES on public.verification_scenes to anon; grant TRIGGER on public.verification_scenes to anon; grant MAINTAIN on public.verification_scenes to anon; grant INSERT on public.verification_scenes to authenticated; grant SELECT on public.verification_scenes to authenticated; grant UPDATE on public.verification_scenes to authenticated; grant DELETE on public.verification_scenes to authenticated; grant TRUNCATE on public.verification_scenes to authenticated; grant REFERENCES on public.verification_scenes to authenticated; grant TRIGGER on public.verification_scenes to authenticated; grant MAINTAIN on public.verification_scenes to authenticated; grant INSERT on public.verification_scenes to service_role; grant SELECT on public.verification_scenes to service_role; grant UPDATE on public.verification_scenes to service_role; grant DELETE on public.verification_scenes to service_role; grant TRUNCATE on public.verification_scenes to service_role; grant REFERENCES on public.verification_scenes to service_role; grant TRIGGER on public.verification_scenes to service_role; grant MAINTAIN on public.verification_scenes to service_role;

revoke all on public.verification_frames from public, anon, authenticated, service_role; grant INSERT on public.verification_frames to anon; grant SELECT on public.verification_frames to anon; grant UPDATE on public.verification_frames to anon; grant DELETE on public.verification_frames to anon; grant TRUNCATE on public.verification_frames to anon; grant REFERENCES on public.verification_frames to anon; grant TRIGGER on public.verification_frames to anon; grant MAINTAIN on public.verification_frames to anon; grant INSERT on public.verification_frames to authenticated; grant SELECT on public.verification_frames to authenticated; grant UPDATE on public.verification_frames to authenticated; grant DELETE on public.verification_frames to authenticated; grant TRUNCATE on public.verification_frames to authenticated; grant REFERENCES on public.verification_frames to authenticated; grant TRIGGER on public.verification_frames to authenticated; grant MAINTAIN on public.verification_frames to authenticated; grant INSERT on public.verification_frames to service_role; grant SELECT on public.verification_frames to service_role; grant UPDATE on public.verification_frames to service_role; grant DELETE on public.verification_frames to service_role; grant TRUNCATE on public.verification_frames to service_role; grant REFERENCES on public.verification_frames to service_role; grant TRIGGER on public.verification_frames to service_role; grant MAINTAIN on public.verification_frames to service_role;

revoke all on public.ai_analysis_runs from public, anon, authenticated, service_role; grant INSERT on public.ai_analysis_runs to anon; grant SELECT on public.ai_analysis_runs to anon; grant UPDATE on public.ai_analysis_runs to anon; grant DELETE on public.ai_analysis_runs to anon; grant TRUNCATE on public.ai_analysis_runs to anon; grant REFERENCES on public.ai_analysis_runs to anon; grant TRIGGER on public.ai_analysis_runs to anon; grant MAINTAIN on public.ai_analysis_runs to anon; grant INSERT on public.ai_analysis_runs to authenticated; grant SELECT on public.ai_analysis_runs to authenticated; grant UPDATE on public.ai_analysis_runs to authenticated; grant DELETE on public.ai_analysis_runs to authenticated; grant TRUNCATE on public.ai_analysis_runs to authenticated; grant REFERENCES on public.ai_analysis_runs to authenticated; grant TRIGGER on public.ai_analysis_runs to authenticated; grant MAINTAIN on public.ai_analysis_runs to authenticated; grant INSERT on public.ai_analysis_runs to service_role; grant SELECT on public.ai_analysis_runs to service_role; grant UPDATE on public.ai_analysis_runs to service_role; grant DELETE on public.ai_analysis_runs to service_role; grant TRUNCATE on public.ai_analysis_runs to service_role; grant REFERENCES on public.ai_analysis_runs to service_role; grant TRIGGER on public.ai_analysis_runs to service_role; grant MAINTAIN on public.ai_analysis_runs to service_role;

revoke all on public.frame_observations from public, anon, authenticated, service_role; grant INSERT on public.frame_observations to anon; grant SELECT on public.frame_observations to anon; grant UPDATE on public.frame_observations to anon; grant DELETE on public.frame_observations to anon; grant TRUNCATE on public.frame_observations to anon; grant REFERENCES on public.frame_observations to anon; grant TRIGGER on public.frame_observations to anon; grant MAINTAIN on public.frame_observations to anon; grant INSERT on public.frame_observations to authenticated; grant SELECT on public.frame_observations to authenticated; grant UPDATE on public.frame_observations to authenticated; grant DELETE on public.frame_observations to authenticated; grant TRUNCATE on public.frame_observations to authenticated; grant REFERENCES on public.frame_observations to authenticated; grant TRIGGER on public.frame_observations to authenticated; grant MAINTAIN on public.frame_observations to authenticated; grant INSERT on public.frame_observations to service_role; grant SELECT on public.frame_observations to service_role; grant UPDATE on public.frame_observations to service_role; grant DELETE on public.frame_observations to service_role; grant TRUNCATE on public.frame_observations to service_role; grant REFERENCES on public.frame_observations to service_role; grant TRIGGER on public.frame_observations to service_role; grant MAINTAIN on public.frame_observations to service_role;

revoke all on public.temporal_change_events from public, anon, authenticated, service_role; grant INSERT on public.temporal_change_events to anon; grant SELECT on public.temporal_change_events to anon; grant UPDATE on public.temporal_change_events to anon; grant DELETE on public.temporal_change_events to anon; grant TRUNCATE on public.temporal_change_events to anon; grant REFERENCES on public.temporal_change_events to anon; grant TRIGGER on public.temporal_change_events to anon; grant MAINTAIN on public.temporal_change_events to anon; grant INSERT on public.temporal_change_events to authenticated; grant SELECT on public.temporal_change_events to authenticated; grant UPDATE on public.temporal_change_events to authenticated; grant DELETE on public.temporal_change_events to authenticated; grant TRUNCATE on public.temporal_change_events to authenticated; grant REFERENCES on public.temporal_change_events to authenticated; grant TRIGGER on public.temporal_change_events to authenticated; grant MAINTAIN on public.temporal_change_events to authenticated; grant INSERT on public.temporal_change_events to service_role; grant SELECT on public.temporal_change_events to service_role; grant UPDATE on public.temporal_change_events to service_role; grant DELETE on public.temporal_change_events to service_role; grant TRUNCATE on public.temporal_change_events to service_role; grant REFERENCES on public.temporal_change_events to service_role; grant TRIGGER on public.temporal_change_events to service_role; grant MAINTAIN on public.temporal_change_events to service_role;

revoke all on public.verification_rules from public, anon, authenticated, service_role; grant INSERT on public.verification_rules to anon; grant SELECT on public.verification_rules to anon; grant UPDATE on public.verification_rules to anon; grant DELETE on public.verification_rules to anon; grant TRUNCATE on public.verification_rules to anon; grant REFERENCES on public.verification_rules to anon; grant TRIGGER on public.verification_rules to anon; grant MAINTAIN on public.verification_rules to anon; grant INSERT on public.verification_rules to authenticated; grant SELECT on public.verification_rules to authenticated; grant UPDATE on public.verification_rules to authenticated; grant DELETE on public.verification_rules to authenticated; grant TRUNCATE on public.verification_rules to authenticated; grant REFERENCES on public.verification_rules to authenticated; grant TRIGGER on public.verification_rules to authenticated; grant MAINTAIN on public.verification_rules to authenticated; grant INSERT on public.verification_rules to service_role; grant SELECT on public.verification_rules to service_role; grant UPDATE on public.verification_rules to service_role; grant DELETE on public.verification_rules to service_role; grant TRUNCATE on public.verification_rules to service_role; grant REFERENCES on public.verification_rules to service_role; grant TRIGGER on public.verification_rules to service_role; grant MAINTAIN on public.verification_rules to service_role;

revoke all on public.verification_results from public, anon, authenticated, service_role; grant INSERT on public.verification_results to anon; grant SELECT on public.verification_results to anon; grant UPDATE on public.verification_results to anon; grant DELETE on public.verification_results to anon; grant TRUNCATE on public.verification_results to anon; grant REFERENCES on public.verification_results to anon; grant TRIGGER on public.verification_results to anon; grant MAINTAIN on public.verification_results to anon; grant INSERT on public.verification_results to authenticated; grant SELECT on public.verification_results to authenticated; grant UPDATE on public.verification_results to authenticated; grant DELETE on public.verification_results to authenticated; grant TRUNCATE on public.verification_results to authenticated; grant REFERENCES on public.verification_results to authenticated; grant TRIGGER on public.verification_results to authenticated; grant MAINTAIN on public.verification_results to authenticated; grant INSERT on public.verification_results to service_role; grant SELECT on public.verification_results to service_role; grant UPDATE on public.verification_results to service_role; grant DELETE on public.verification_results to service_role; grant TRUNCATE on public.verification_results to service_role; grant REFERENCES on public.verification_results to service_role; grant TRIGGER on public.verification_results to service_role; grant MAINTAIN on public.verification_results to service_role;

revoke all on public.verification_evidence from public, anon, authenticated, service_role; grant INSERT on public.verification_evidence to anon; grant SELECT on public.verification_evidence to anon; grant UPDATE on public.verification_evidence to anon; grant DELETE on public.verification_evidence to anon; grant TRUNCATE on public.verification_evidence to anon; grant REFERENCES on public.verification_evidence to anon; grant TRIGGER on public.verification_evidence to anon; grant MAINTAIN on public.verification_evidence to anon; grant INSERT on public.verification_evidence to authenticated; grant SELECT on public.verification_evidence to authenticated; grant UPDATE on public.verification_evidence to authenticated; grant DELETE on public.verification_evidence to authenticated; grant TRUNCATE on public.verification_evidence to authenticated; grant REFERENCES on public.verification_evidence to authenticated; grant TRIGGER on public.verification_evidence to authenticated; grant MAINTAIN on public.verification_evidence to authenticated; grant INSERT on public.verification_evidence to service_role; grant SELECT on public.verification_evidence to service_role; grant UPDATE on public.verification_evidence to service_role; grant DELETE on public.verification_evidence to service_role; grant TRUNCATE on public.verification_evidence to service_role; grant REFERENCES on public.verification_evidence to service_role; grant TRIGGER on public.verification_evidence to service_role; grant MAINTAIN on public.verification_evidence to service_role;

revoke all on public.human_review_tasks from public, anon, authenticated, service_role; grant INSERT on public.human_review_tasks to anon; grant SELECT on public.human_review_tasks to anon; grant UPDATE on public.human_review_tasks to anon; grant DELETE on public.human_review_tasks to anon; grant TRUNCATE on public.human_review_tasks to anon; grant REFERENCES on public.human_review_tasks to anon; grant TRIGGER on public.human_review_tasks to anon; grant MAINTAIN on public.human_review_tasks to anon; grant INSERT on public.human_review_tasks to authenticated; grant SELECT on public.human_review_tasks to authenticated; grant UPDATE on public.human_review_tasks to authenticated; grant DELETE on public.human_review_tasks to authenticated; grant TRUNCATE on public.human_review_tasks to authenticated; grant REFERENCES on public.human_review_tasks to authenticated; grant TRIGGER on public.human_review_tasks to authenticated; grant MAINTAIN on public.human_review_tasks to authenticated; grant INSERT on public.human_review_tasks to service_role; grant SELECT on public.human_review_tasks to service_role; grant UPDATE on public.human_review_tasks to service_role; grant DELETE on public.human_review_tasks to service_role; grant TRUNCATE on public.human_review_tasks to service_role; grant REFERENCES on public.human_review_tasks to service_role; grant TRIGGER on public.human_review_tasks to service_role; grant MAINTAIN on public.human_review_tasks to service_role;

revoke all on public.human_review_decisions from public, anon, authenticated, service_role; grant INSERT on public.human_review_decisions to anon; grant SELECT on public.human_review_decisions to anon; grant UPDATE on public.human_review_decisions to anon; grant DELETE on public.human_review_decisions to anon; grant TRUNCATE on public.human_review_decisions to anon; grant REFERENCES on public.human_review_decisions to anon; grant TRIGGER on public.human_review_decisions to anon; grant MAINTAIN on public.human_review_decisions to anon; grant INSERT on public.human_review_decisions to authenticated; grant SELECT on public.human_review_decisions to authenticated; grant UPDATE on public.human_review_decisions to authenticated; grant DELETE on public.human_review_decisions to authenticated; grant TRUNCATE on public.human_review_decisions to authenticated; grant REFERENCES on public.human_review_decisions to authenticated; grant TRIGGER on public.human_review_decisions to authenticated; grant MAINTAIN on public.human_review_decisions to authenticated; grant INSERT on public.human_review_decisions to service_role; grant SELECT on public.human_review_decisions to service_role; grant UPDATE on public.human_review_decisions to service_role; grant DELETE on public.human_review_decisions to service_role; grant TRUNCATE on public.human_review_decisions to service_role; grant REFERENCES on public.human_review_decisions to service_role; grant TRIGGER on public.human_review_decisions to service_role; grant MAINTAIN on public.human_review_decisions to service_role;

revoke all on public.verification_audit_events from public, anon, authenticated, service_role; grant INSERT on public.verification_audit_events to anon; grant SELECT on public.verification_audit_events to anon; grant UPDATE on public.verification_audit_events to anon; grant DELETE on public.verification_audit_events to anon; grant TRUNCATE on public.verification_audit_events to anon; grant REFERENCES on public.verification_audit_events to anon; grant TRIGGER on public.verification_audit_events to anon; grant MAINTAIN on public.verification_audit_events to anon; grant INSERT on public.verification_audit_events to authenticated; grant SELECT on public.verification_audit_events to authenticated; grant UPDATE on public.verification_audit_events to authenticated; grant DELETE on public.verification_audit_events to authenticated; grant TRUNCATE on public.verification_audit_events to authenticated; grant REFERENCES on public.verification_audit_events to authenticated; grant TRIGGER on public.verification_audit_events to authenticated; grant MAINTAIN on public.verification_audit_events to authenticated; grant INSERT on public.verification_audit_events to service_role; grant SELECT on public.verification_audit_events to service_role; grant UPDATE on public.verification_audit_events to service_role; grant DELETE on public.verification_audit_events to service_role; grant TRUNCATE on public.verification_audit_events to service_role; grant REFERENCES on public.verification_audit_events to service_role; grant TRIGGER on public.verification_audit_events to service_role; grant MAINTAIN on public.verification_audit_events to service_role;

revoke all on public.verification_ai_costs from public, anon, authenticated, service_role; grant INSERT on public.verification_ai_costs to anon; grant SELECT on public.verification_ai_costs to anon; grant UPDATE on public.verification_ai_costs to anon; grant DELETE on public.verification_ai_costs to anon; grant TRUNCATE on public.verification_ai_costs to anon; grant REFERENCES on public.verification_ai_costs to anon; grant TRIGGER on public.verification_ai_costs to anon; grant MAINTAIN on public.verification_ai_costs to anon; grant INSERT on public.verification_ai_costs to authenticated; grant SELECT on public.verification_ai_costs to authenticated; grant UPDATE on public.verification_ai_costs to authenticated; grant DELETE on public.verification_ai_costs to authenticated; grant TRUNCATE on public.verification_ai_costs to authenticated; grant REFERENCES on public.verification_ai_costs to authenticated; grant TRIGGER on public.verification_ai_costs to authenticated; grant MAINTAIN on public.verification_ai_costs to authenticated; grant INSERT on public.verification_ai_costs to service_role; grant SELECT on public.verification_ai_costs to service_role; grant UPDATE on public.verification_ai_costs to service_role; grant DELETE on public.verification_ai_costs to service_role; grant TRUNCATE on public.verification_ai_costs to service_role; grant REFERENCES on public.verification_ai_costs to service_role; grant TRIGGER on public.verification_ai_costs to service_role; grant MAINTAIN on public.verification_ai_costs to service_role;

revoke all on public.verification_usage_limits from public, anon, authenticated, service_role; grant INSERT on public.verification_usage_limits to anon; grant SELECT on public.verification_usage_limits to anon; grant UPDATE on public.verification_usage_limits to anon; grant DELETE on public.verification_usage_limits to anon; grant TRUNCATE on public.verification_usage_limits to anon; grant REFERENCES on public.verification_usage_limits to anon; grant TRIGGER on public.verification_usage_limits to anon; grant MAINTAIN on public.verification_usage_limits to anon; grant INSERT on public.verification_usage_limits to authenticated; grant SELECT on public.verification_usage_limits to authenticated; grant UPDATE on public.verification_usage_limits to authenticated; grant DELETE on public.verification_usage_limits to authenticated; grant TRUNCATE on public.verification_usage_limits to authenticated; grant REFERENCES on public.verification_usage_limits to authenticated; grant TRIGGER on public.verification_usage_limits to authenticated; grant MAINTAIN on public.verification_usage_limits to authenticated; grant INSERT on public.verification_usage_limits to service_role; grant SELECT on public.verification_usage_limits to service_role; grant UPDATE on public.verification_usage_limits to service_role; grant DELETE on public.verification_usage_limits to service_role; grant TRUNCATE on public.verification_usage_limits to service_role; grant REFERENCES on public.verification_usage_limits to service_role; grant TRIGGER on public.verification_usage_limits to service_role; grant MAINTAIN on public.verification_usage_limits to service_role;

revoke all on public.video_clips from public, anon, authenticated, service_role; grant INSERT on public.video_clips to anon; grant SELECT on public.video_clips to anon; grant UPDATE on public.video_clips to anon; grant DELETE on public.video_clips to anon; grant TRUNCATE on public.video_clips to anon; grant REFERENCES on public.video_clips to anon; grant TRIGGER on public.video_clips to anon; grant MAINTAIN on public.video_clips to anon; grant INSERT on public.video_clips to authenticated; grant SELECT on public.video_clips to authenticated; grant UPDATE on public.video_clips to authenticated; grant DELETE on public.video_clips to authenticated; grant TRUNCATE on public.video_clips to authenticated; grant REFERENCES on public.video_clips to authenticated; grant TRIGGER on public.video_clips to authenticated; grant MAINTAIN on public.video_clips to authenticated; grant INSERT on public.video_clips to service_role; grant SELECT on public.video_clips to service_role; grant UPDATE on public.video_clips to service_role; grant DELETE on public.video_clips to service_role; grant TRUNCATE on public.video_clips to service_role; grant REFERENCES on public.video_clips to service_role; grant TRIGGER on public.video_clips to service_role; grant MAINTAIN on public.video_clips to service_role;

revoke all on public.llm_verification_runs from public, anon, authenticated, service_role; grant INSERT on public.llm_verification_runs to anon; grant SELECT on public.llm_verification_runs to anon; grant UPDATE on public.llm_verification_runs to anon; grant DELETE on public.llm_verification_runs to anon; grant TRUNCATE on public.llm_verification_runs to anon; grant REFERENCES on public.llm_verification_runs to anon; grant TRIGGER on public.llm_verification_runs to anon; grant MAINTAIN on public.llm_verification_runs to anon; grant INSERT on public.llm_verification_runs to authenticated; grant SELECT on public.llm_verification_runs to authenticated; grant UPDATE on public.llm_verification_runs to authenticated; grant DELETE on public.llm_verification_runs to authenticated; grant TRUNCATE on public.llm_verification_runs to authenticated; grant REFERENCES on public.llm_verification_runs to authenticated; grant TRIGGER on public.llm_verification_runs to authenticated; grant MAINTAIN on public.llm_verification_runs to authenticated; grant INSERT on public.llm_verification_runs to service_role; grant SELECT on public.llm_verification_runs to service_role; grant UPDATE on public.llm_verification_runs to service_role; grant DELETE on public.llm_verification_runs to service_role; grant TRUNCATE on public.llm_verification_runs to service_role; grant REFERENCES on public.llm_verification_runs to service_role; grant TRIGGER on public.llm_verification_runs to service_role; grant MAINTAIN on public.llm_verification_runs to service_role;

revoke all on public.network_erasures from public, anon, authenticated, service_role; grant INSERT on public.network_erasures to anon; grant SELECT on public.network_erasures to anon; grant UPDATE on public.network_erasures to anon; grant DELETE on public.network_erasures to anon; grant TRUNCATE on public.network_erasures to anon; grant REFERENCES on public.network_erasures to anon; grant TRIGGER on public.network_erasures to anon; grant MAINTAIN on public.network_erasures to anon; grant INSERT on public.network_erasures to authenticated; grant SELECT on public.network_erasures to authenticated; grant UPDATE on public.network_erasures to authenticated; grant DELETE on public.network_erasures to authenticated; grant TRUNCATE on public.network_erasures to authenticated; grant REFERENCES on public.network_erasures to authenticated; grant TRIGGER on public.network_erasures to authenticated; grant MAINTAIN on public.network_erasures to authenticated; grant INSERT on public.network_erasures to service_role; grant SELECT on public.network_erasures to service_role; grant UPDATE on public.network_erasures to service_role; grant DELETE on public.network_erasures to service_role; grant TRUNCATE on public.network_erasures to service_role; grant REFERENCES on public.network_erasures to service_role; grant TRIGGER on public.network_erasures to service_role; grant MAINTAIN on public.network_erasures to service_role;

revoke all on public.work_episodes from public, anon, authenticated, service_role; grant INSERT on public.work_episodes to authenticated; grant SELECT on public.work_episodes to authenticated; grant UPDATE on public.work_episodes to authenticated; grant DELETE on public.work_episodes to authenticated; grant TRUNCATE on public.work_episodes to authenticated; grant REFERENCES on public.work_episodes to authenticated; grant TRIGGER on public.work_episodes to authenticated; grant MAINTAIN on public.work_episodes to authenticated; grant INSERT on public.work_episodes to service_role; grant SELECT on public.work_episodes to service_role; grant UPDATE on public.work_episodes to service_role; grant DELETE on public.work_episodes to service_role; grant TRUNCATE on public.work_episodes to service_role; grant REFERENCES on public.work_episodes to service_role; grant TRIGGER on public.work_episodes to service_role; grant MAINTAIN on public.work_episodes to service_role;

revoke all on public.episode_observations from public, anon, authenticated, service_role; grant INSERT on public.episode_observations to authenticated; grant SELECT on public.episode_observations to authenticated; grant UPDATE on public.episode_observations to authenticated; grant DELETE on public.episode_observations to authenticated; grant TRUNCATE on public.episode_observations to authenticated; grant REFERENCES on public.episode_observations to authenticated; grant TRIGGER on public.episode_observations to authenticated; grant MAINTAIN on public.episode_observations to authenticated; grant INSERT on public.episode_observations to service_role; grant SELECT on public.episode_observations to service_role; grant UPDATE on public.episode_observations to service_role; grant DELETE on public.episode_observations to service_role; grant TRUNCATE on public.episode_observations to service_role; grant REFERENCES on public.episode_observations to service_role; grant TRIGGER on public.episode_observations to service_role; grant MAINTAIN on public.episode_observations to service_role;

revoke all on public.episode_actions from public, anon, authenticated, service_role; grant INSERT on public.episode_actions to authenticated; grant SELECT on public.episode_actions to authenticated; grant UPDATE on public.episode_actions to authenticated; grant DELETE on public.episode_actions to authenticated; grant TRUNCATE on public.episode_actions to authenticated; grant REFERENCES on public.episode_actions to authenticated; grant TRIGGER on public.episode_actions to authenticated; grant MAINTAIN on public.episode_actions to authenticated; grant INSERT on public.episode_actions to service_role; grant SELECT on public.episode_actions to service_role; grant UPDATE on public.episode_actions to service_role; grant DELETE on public.episode_actions to service_role; grant TRUNCATE on public.episode_actions to service_role; grant REFERENCES on public.episode_actions to service_role; grant TRIGGER on public.episode_actions to service_role; grant MAINTAIN on public.episode_actions to service_role;

revoke all on public.episode_resources from public, anon, authenticated, service_role; grant INSERT on public.episode_resources to authenticated; grant SELECT on public.episode_resources to authenticated; grant UPDATE on public.episode_resources to authenticated; grant DELETE on public.episode_resources to authenticated; grant TRUNCATE on public.episode_resources to authenticated; grant REFERENCES on public.episode_resources to authenticated; grant TRIGGER on public.episode_resources to authenticated; grant MAINTAIN on public.episode_resources to authenticated; grant INSERT on public.episode_resources to service_role; grant SELECT on public.episode_resources to service_role; grant UPDATE on public.episode_resources to service_role; grant DELETE on public.episode_resources to service_role; grant TRUNCATE on public.episode_resources to service_role; grant REFERENCES on public.episode_resources to service_role; grant TRIGGER on public.episode_resources to service_role; grant MAINTAIN on public.episode_resources to service_role;

revoke all on public.episode_verifications from public, anon, authenticated, service_role; grant INSERT on public.episode_verifications to authenticated; grant SELECT on public.episode_verifications to authenticated; grant UPDATE on public.episode_verifications to authenticated; grant DELETE on public.episode_verifications to authenticated; grant TRUNCATE on public.episode_verifications to authenticated; grant REFERENCES on public.episode_verifications to authenticated; grant TRIGGER on public.episode_verifications to authenticated; grant MAINTAIN on public.episode_verifications to authenticated; grant INSERT on public.episode_verifications to service_role; grant SELECT on public.episode_verifications to service_role; grant UPDATE on public.episode_verifications to service_role; grant DELETE on public.episode_verifications to service_role; grant TRUNCATE on public.episode_verifications to service_role; grant REFERENCES on public.episode_verifications to service_role; grant TRIGGER on public.episode_verifications to service_role; grant MAINTAIN on public.episode_verifications to service_role;

revoke all on public.episode_outcomes from public, anon, authenticated, service_role; grant INSERT on public.episode_outcomes to authenticated; grant SELECT on public.episode_outcomes to authenticated; grant UPDATE on public.episode_outcomes to authenticated; grant DELETE on public.episode_outcomes to authenticated; grant TRUNCATE on public.episode_outcomes to authenticated; grant REFERENCES on public.episode_outcomes to authenticated; grant TRIGGER on public.episode_outcomes to authenticated; grant MAINTAIN on public.episode_outcomes to authenticated; grant INSERT on public.episode_outcomes to service_role; grant SELECT on public.episode_outcomes to service_role; grant UPDATE on public.episode_outcomes to service_role; grant DELETE on public.episode_outcomes to service_role; grant TRUNCATE on public.episode_outcomes to service_role; grant REFERENCES on public.episode_outcomes to service_role; grant TRIGGER on public.episode_outcomes to service_role; grant MAINTAIN on public.episode_outcomes to service_role;

revoke all on public.episode_economics from public, anon, authenticated, service_role; grant INSERT on public.episode_economics to authenticated; grant SELECT on public.episode_economics to authenticated; grant UPDATE on public.episode_economics to authenticated; grant DELETE on public.episode_economics to authenticated; grant TRUNCATE on public.episode_economics to authenticated; grant REFERENCES on public.episode_economics to authenticated; grant TRIGGER on public.episode_economics to authenticated; grant MAINTAIN on public.episode_economics to authenticated; grant INSERT on public.episode_economics to service_role; grant SELECT on public.episode_economics to service_role; grant UPDATE on public.episode_economics to service_role; grant DELETE on public.episode_economics to service_role; grant TRUNCATE on public.episode_economics to service_role; grant REFERENCES on public.episode_economics to service_role; grant TRIGGER on public.episode_economics to service_role; grant MAINTAIN on public.episode_economics to service_role;

revoke all on public.job_memory from public, anon, authenticated, service_role; grant INSERT on public.job_memory to anon; grant SELECT on public.job_memory to anon; grant UPDATE on public.job_memory to anon; grant DELETE on public.job_memory to anon; grant TRUNCATE on public.job_memory to anon; grant REFERENCES on public.job_memory to anon; grant TRIGGER on public.job_memory to anon; grant MAINTAIN on public.job_memory to anon; grant INSERT on public.job_memory to authenticated; grant SELECT on public.job_memory to authenticated; grant UPDATE on public.job_memory to authenticated; grant DELETE on public.job_memory to authenticated; grant TRUNCATE on public.job_memory to authenticated; grant REFERENCES on public.job_memory to authenticated; grant TRIGGER on public.job_memory to authenticated; grant MAINTAIN on public.job_memory to authenticated; grant INSERT on public.job_memory to service_role; grant SELECT on public.job_memory to service_role; grant UPDATE on public.job_memory to service_role; grant DELETE on public.job_memory to service_role; grant TRUNCATE on public.job_memory to service_role; grant REFERENCES on public.job_memory to service_role; grant TRIGGER on public.job_memory to service_role; grant MAINTAIN on public.job_memory to service_role;

revoke all on public.agent_memory from public, anon, authenticated, service_role; grant INSERT on public.agent_memory to anon; grant SELECT on public.agent_memory to anon; grant UPDATE on public.agent_memory to anon; grant DELETE on public.agent_memory to anon; grant TRUNCATE on public.agent_memory to anon; grant REFERENCES on public.agent_memory to anon; grant TRIGGER on public.agent_memory to anon; grant MAINTAIN on public.agent_memory to anon; grant INSERT on public.agent_memory to authenticated; grant SELECT on public.agent_memory to authenticated; grant UPDATE on public.agent_memory to authenticated; grant DELETE on public.agent_memory to authenticated; grant TRUNCATE on public.agent_memory to authenticated; grant REFERENCES on public.agent_memory to authenticated; grant TRIGGER on public.agent_memory to authenticated; grant MAINTAIN on public.agent_memory to authenticated; grant INSERT on public.agent_memory to service_role; grant SELECT on public.agent_memory to service_role; grant UPDATE on public.agent_memory to service_role; grant DELETE on public.agent_memory to service_role; grant TRUNCATE on public.agent_memory to service_role; grant REFERENCES on public.agent_memory to service_role; grant TRIGGER on public.agent_memory to service_role; grant MAINTAIN on public.agent_memory to service_role;

revoke all on public.platform_staff from public, anon, authenticated, service_role; grant INSERT on public.platform_staff to anon; grant SELECT on public.platform_staff to anon; grant UPDATE on public.platform_staff to anon; grant DELETE on public.platform_staff to anon; grant TRUNCATE on public.platform_staff to anon; grant REFERENCES on public.platform_staff to anon; grant TRIGGER on public.platform_staff to anon; grant MAINTAIN on public.platform_staff to anon; grant INSERT on public.platform_staff to authenticated; grant SELECT on public.platform_staff to authenticated; grant UPDATE on public.platform_staff to authenticated; grant DELETE on public.platform_staff to authenticated; grant TRUNCATE on public.platform_staff to authenticated; grant REFERENCES on public.platform_staff to authenticated; grant TRIGGER on public.platform_staff to authenticated; grant MAINTAIN on public.platform_staff to authenticated; grant INSERT on public.platform_staff to service_role; grant SELECT on public.platform_staff to service_role; grant UPDATE on public.platform_staff to service_role; grant DELETE on public.platform_staff to service_role; grant TRUNCATE on public.platform_staff to service_role; grant REFERENCES on public.platform_staff to service_role; grant TRIGGER on public.platform_staff to service_role; grant MAINTAIN on public.platform_staff to service_role;

revoke all on public.platform_admin_audit from public, anon, authenticated, service_role; grant INSERT on public.platform_admin_audit to anon; grant SELECT on public.platform_admin_audit to anon; grant UPDATE on public.platform_admin_audit to anon; grant DELETE on public.platform_admin_audit to anon; grant TRUNCATE on public.platform_admin_audit to anon; grant REFERENCES on public.platform_admin_audit to anon; grant TRIGGER on public.platform_admin_audit to anon; grant MAINTAIN on public.platform_admin_audit to anon; grant INSERT on public.platform_admin_audit to authenticated; grant SELECT on public.platform_admin_audit to authenticated; grant UPDATE on public.platform_admin_audit to authenticated; grant DELETE on public.platform_admin_audit to authenticated; grant TRUNCATE on public.platform_admin_audit to authenticated; grant REFERENCES on public.platform_admin_audit to authenticated; grant TRIGGER on public.platform_admin_audit to authenticated; grant MAINTAIN on public.platform_admin_audit to authenticated; grant INSERT on public.platform_admin_audit to service_role; grant SELECT on public.platform_admin_audit to service_role; grant UPDATE on public.platform_admin_audit to service_role; grant DELETE on public.platform_admin_audit to service_role; grant TRUNCATE on public.platform_admin_audit to service_role; grant REFERENCES on public.platform_admin_audit to service_role; grant TRIGGER on public.platform_admin_audit to service_role; grant MAINTAIN on public.platform_admin_audit to service_role;

revoke all on public.internal_staff_totp from public, anon, authenticated, service_role; grant INSERT on public.internal_staff_totp to service_role; grant SELECT on public.internal_staff_totp to service_role; grant UPDATE on public.internal_staff_totp to service_role; grant DELETE on public.internal_staff_totp to service_role; grant TRUNCATE on public.internal_staff_totp to service_role; grant REFERENCES on public.internal_staff_totp to service_role; grant TRIGGER on public.internal_staff_totp to service_role; grant MAINTAIN on public.internal_staff_totp to service_role;

revoke all on public.internal_access_requests from public, anon, authenticated, service_role; grant INSERT on public.internal_access_requests to service_role; grant SELECT on public.internal_access_requests to service_role; grant UPDATE on public.internal_access_requests to service_role; grant DELETE on public.internal_access_requests to service_role; grant TRUNCATE on public.internal_access_requests to service_role; grant REFERENCES on public.internal_access_requests to service_role; grant TRIGGER on public.internal_access_requests to service_role; grant MAINTAIN on public.internal_access_requests to service_role;

revoke all on public.legal_holds from public, anon, authenticated, service_role; grant INSERT on public.legal_holds to service_role; grant SELECT on public.legal_holds to service_role; grant UPDATE on public.legal_holds to service_role; grant DELETE on public.legal_holds to service_role; grant TRUNCATE on public.legal_holds to service_role; grant REFERENCES on public.legal_holds to service_role; grant TRIGGER on public.legal_holds to service_role; grant MAINTAIN on public.legal_holds to service_role;

revoke all on public.legal_hold_subjects from public, anon, authenticated, service_role; grant INSERT on public.legal_hold_subjects to service_role; grant SELECT on public.legal_hold_subjects to service_role; grant UPDATE on public.legal_hold_subjects to service_role; grant DELETE on public.legal_hold_subjects to service_role; grant TRUNCATE on public.legal_hold_subjects to service_role; grant REFERENCES on public.legal_hold_subjects to service_role; grant TRIGGER on public.legal_hold_subjects to service_role; grant MAINTAIN on public.legal_hold_subjects to service_role;

revoke all on public.legal_video_vault from public, anon, authenticated, service_role; grant INSERT on public.legal_video_vault to service_role; grant SELECT on public.legal_video_vault to service_role; grant UPDATE on public.legal_video_vault to service_role; grant DELETE on public.legal_video_vault to service_role; grant TRUNCATE on public.legal_video_vault to service_role; grant REFERENCES on public.legal_video_vault to service_role; grant TRIGGER on public.legal_video_vault to service_role; grant MAINTAIN on public.legal_video_vault to service_role;

revoke all on public.user_activity_events from public, anon, authenticated, service_role; grant INSERT on public.user_activity_events to service_role; grant SELECT on public.user_activity_events to service_role; grant UPDATE on public.user_activity_events to service_role; grant DELETE on public.user_activity_events to service_role; grant TRUNCATE on public.user_activity_events to service_role; grant REFERENCES on public.user_activity_events to service_role; grant TRIGGER on public.user_activity_events to service_role; grant MAINTAIN on public.user_activity_events to service_role;

revoke all on public.legal_productions from public, anon, authenticated, service_role; grant INSERT on public.legal_productions to service_role; grant SELECT on public.legal_productions to service_role; grant UPDATE on public.legal_productions to service_role; grant DELETE on public.legal_productions to service_role; grant TRUNCATE on public.legal_productions to service_role; grant REFERENCES on public.legal_productions to service_role; grant TRIGGER on public.legal_productions to service_role; grant MAINTAIN on public.legal_productions to service_role;

revoke all on public.episode_world_states from public, anon, authenticated, service_role; grant INSERT on public.episode_world_states to authenticated; grant SELECT on public.episode_world_states to authenticated; grant UPDATE on public.episode_world_states to authenticated; grant DELETE on public.episode_world_states to authenticated; grant TRUNCATE on public.episode_world_states to authenticated; grant REFERENCES on public.episode_world_states to authenticated; grant TRIGGER on public.episode_world_states to authenticated; grant MAINTAIN on public.episode_world_states to authenticated; grant INSERT on public.episode_world_states to service_role; grant SELECT on public.episode_world_states to service_role; grant UPDATE on public.episode_world_states to service_role; grant DELETE on public.episode_world_states to service_role; grant TRUNCATE on public.episode_world_states to service_role; grant REFERENCES on public.episode_world_states to service_role; grant TRIGGER on public.episode_world_states to service_role; grant MAINTAIN on public.episode_world_states to service_role;

revoke all on public.episode_evidence_assets from public, anon, authenticated, service_role; grant INSERT on public.episode_evidence_assets to authenticated; grant SELECT on public.episode_evidence_assets to authenticated; grant UPDATE on public.episode_evidence_assets to authenticated; grant DELETE on public.episode_evidence_assets to authenticated; grant TRUNCATE on public.episode_evidence_assets to authenticated; grant REFERENCES on public.episode_evidence_assets to authenticated; grant TRIGGER on public.episode_evidence_assets to authenticated; grant MAINTAIN on public.episode_evidence_assets to authenticated; grant INSERT on public.episode_evidence_assets to service_role; grant SELECT on public.episode_evidence_assets to service_role; grant UPDATE on public.episode_evidence_assets to service_role; grant DELETE on public.episode_evidence_assets to service_role; grant TRUNCATE on public.episode_evidence_assets to service_role; grant REFERENCES on public.episode_evidence_assets to service_role; grant TRIGGER on public.episode_evidence_assets to service_role; grant MAINTAIN on public.episode_evidence_assets to service_role;

revoke all on public.episode_annotations from public, anon, authenticated, service_role; grant INSERT on public.episode_annotations to authenticated; grant SELECT on public.episode_annotations to authenticated; grant UPDATE on public.episode_annotations to authenticated; grant DELETE on public.episode_annotations to authenticated; grant TRUNCATE on public.episode_annotations to authenticated; grant REFERENCES on public.episode_annotations to authenticated; grant TRIGGER on public.episode_annotations to authenticated; grant MAINTAIN on public.episode_annotations to authenticated; grant INSERT on public.episode_annotations to service_role; grant SELECT on public.episode_annotations to service_role; grant UPDATE on public.episode_annotations to service_role; grant DELETE on public.episode_annotations to service_role; grant TRUNCATE on public.episode_annotations to service_role; grant REFERENCES on public.episode_annotations to service_role; grant TRIGGER on public.episode_annotations to service_role; grant MAINTAIN on public.episode_annotations to service_role;

revoke all on public.episode_immediate_outcomes from public, anon, authenticated, service_role; grant INSERT on public.episode_immediate_outcomes to authenticated; grant SELECT on public.episode_immediate_outcomes to authenticated; grant UPDATE on public.episode_immediate_outcomes to authenticated; grant DELETE on public.episode_immediate_outcomes to authenticated; grant TRUNCATE on public.episode_immediate_outcomes to authenticated; grant REFERENCES on public.episode_immediate_outcomes to authenticated; grant TRIGGER on public.episode_immediate_outcomes to authenticated; grant MAINTAIN on public.episode_immediate_outcomes to authenticated; grant INSERT on public.episode_immediate_outcomes to service_role; grant SELECT on public.episode_immediate_outcomes to service_role; grant UPDATE on public.episode_immediate_outcomes to service_role; grant DELETE on public.episode_immediate_outcomes to service_role; grant TRUNCATE on public.episode_immediate_outcomes to service_role; grant REFERENCES on public.episode_immediate_outcomes to service_role; grant TRIGGER on public.episode_immediate_outcomes to service_role; grant MAINTAIN on public.episode_immediate_outcomes to service_role;

revoke all on public.token_usage_events from public, anon, authenticated, service_role; grant INSERT on public.token_usage_events to anon; grant SELECT on public.token_usage_events to anon; grant UPDATE on public.token_usage_events to anon; grant DELETE on public.token_usage_events to anon; grant TRUNCATE on public.token_usage_events to anon; grant REFERENCES on public.token_usage_events to anon; grant TRIGGER on public.token_usage_events to anon; grant MAINTAIN on public.token_usage_events to anon; grant INSERT on public.token_usage_events to authenticated; grant SELECT on public.token_usage_events to authenticated; grant UPDATE on public.token_usage_events to authenticated; grant DELETE on public.token_usage_events to authenticated; grant TRUNCATE on public.token_usage_events to authenticated; grant REFERENCES on public.token_usage_events to authenticated; grant TRIGGER on public.token_usage_events to authenticated; grant MAINTAIN on public.token_usage_events to authenticated; grant INSERT on public.token_usage_events to service_role; grant SELECT on public.token_usage_events to service_role; grant UPDATE on public.token_usage_events to service_role; grant DELETE on public.token_usage_events to service_role; grant TRUNCATE on public.token_usage_events to service_role; grant REFERENCES on public.token_usage_events to service_role; grant TRIGGER on public.token_usage_events to service_role; grant MAINTAIN on public.token_usage_events to service_role;

revoke all on public.crm_audit_log_id_seq from public, anon, authenticated, service_role; grant SELECT on public.crm_audit_log_id_seq to anon; grant UPDATE on public.crm_audit_log_id_seq to anon; grant USAGE on public.crm_audit_log_id_seq to anon; grant SELECT on public.crm_audit_log_id_seq to authenticated; grant UPDATE on public.crm_audit_log_id_seq to authenticated; grant USAGE on public.crm_audit_log_id_seq to authenticated; grant SELECT on public.crm_audit_log_id_seq to service_role; grant UPDATE on public.crm_audit_log_id_seq to service_role; grant USAGE on public.crm_audit_log_id_seq to service_role;

revoke all on public.crm_audit_log from public, anon, authenticated, service_role; grant INSERT on public.crm_audit_log to authenticated; grant SELECT on public.crm_audit_log to authenticated; grant UPDATE on public.crm_audit_log to authenticated; grant DELETE on public.crm_audit_log to authenticated; grant TRUNCATE on public.crm_audit_log to authenticated; grant REFERENCES on public.crm_audit_log to authenticated; grant TRIGGER on public.crm_audit_log to authenticated; grant MAINTAIN on public.crm_audit_log to authenticated; grant INSERT on public.crm_audit_log to service_role; grant SELECT on public.crm_audit_log to service_role; grant UPDATE on public.crm_audit_log to service_role; grant DELETE on public.crm_audit_log to service_role; grant TRUNCATE on public.crm_audit_log to service_role; grant REFERENCES on public.crm_audit_log to service_role; grant TRIGGER on public.crm_audit_log to service_role; grant MAINTAIN on public.crm_audit_log to service_role;

revoke all on public.terms_acceptances from public, anon, authenticated, service_role; grant INSERT on public.terms_acceptances to service_role; grant SELECT on public.terms_acceptances to service_role; grant UPDATE on public.terms_acceptances to service_role; grant DELETE on public.terms_acceptances to service_role; grant TRUNCATE on public.terms_acceptances to service_role; grant REFERENCES on public.terms_acceptances to service_role; grant TRIGGER on public.terms_acceptances to service_role; grant MAINTAIN on public.terms_acceptances to service_role; grant INSERT on public.terms_acceptances to authenticated; grant SELECT on public.terms_acceptances to authenticated; grant UPDATE on public.terms_acceptances to authenticated;

revoke all on public.atmosphere_migrations from public, anon, authenticated, service_role; grant INSERT on public.atmosphere_migrations to anon; grant SELECT on public.atmosphere_migrations to anon; grant UPDATE on public.atmosphere_migrations to anon; grant DELETE on public.atmosphere_migrations to anon; grant TRUNCATE on public.atmosphere_migrations to anon; grant REFERENCES on public.atmosphere_migrations to anon; grant TRIGGER on public.atmosphere_migrations to anon; grant MAINTAIN on public.atmosphere_migrations to anon; grant INSERT on public.atmosphere_migrations to authenticated; grant SELECT on public.atmosphere_migrations to authenticated; grant UPDATE on public.atmosphere_migrations to authenticated; grant DELETE on public.atmosphere_migrations to authenticated; grant TRUNCATE on public.atmosphere_migrations to authenticated; grant REFERENCES on public.atmosphere_migrations to authenticated; grant TRIGGER on public.atmosphere_migrations to authenticated; grant MAINTAIN on public.atmosphere_migrations to authenticated; grant INSERT on public.atmosphere_migrations to service_role; grant SELECT on public.atmosphere_migrations to service_role; grant UPDATE on public.atmosphere_migrations to service_role; grant DELETE on public.atmosphere_migrations to service_role; grant TRUNCATE on public.atmosphere_migrations to service_role; grant REFERENCES on public.atmosphere_migrations to service_role; grant TRIGGER on public.atmosphere_migrations to service_role; grant MAINTAIN on public.atmosphere_migrations to service_role;

revoke all on public.job_progress_grants from public, anon, authenticated, service_role; grant INSERT on public.job_progress_grants to authenticated; grant SELECT on public.job_progress_grants to authenticated; grant UPDATE on public.job_progress_grants to authenticated; grant DELETE on public.job_progress_grants to authenticated; grant TRUNCATE on public.job_progress_grants to authenticated; grant REFERENCES on public.job_progress_grants to authenticated; grant TRIGGER on public.job_progress_grants to authenticated; grant MAINTAIN on public.job_progress_grants to authenticated; grant INSERT on public.job_progress_grants to service_role; grant SELECT on public.job_progress_grants to service_role; grant UPDATE on public.job_progress_grants to service_role; grant DELETE on public.job_progress_grants to service_role; grant TRUNCATE on public.job_progress_grants to service_role; grant REFERENCES on public.job_progress_grants to service_role; grant TRIGGER on public.job_progress_grants to service_role; grant MAINTAIN on public.job_progress_grants to service_role;

revoke all on public.safety_incidents from public, anon, authenticated, service_role; grant INSERT on public.safety_incidents to anon; grant SELECT on public.safety_incidents to anon; grant UPDATE on public.safety_incidents to anon; grant DELETE on public.safety_incidents to anon; grant TRUNCATE on public.safety_incidents to anon; grant REFERENCES on public.safety_incidents to anon; grant TRIGGER on public.safety_incidents to anon; grant MAINTAIN on public.safety_incidents to anon; grant INSERT on public.safety_incidents to authenticated; grant SELECT on public.safety_incidents to authenticated; grant UPDATE on public.safety_incidents to authenticated; grant DELETE on public.safety_incidents to authenticated; grant TRUNCATE on public.safety_incidents to authenticated; grant REFERENCES on public.safety_incidents to authenticated; grant TRIGGER on public.safety_incidents to authenticated; grant MAINTAIN on public.safety_incidents to authenticated; grant INSERT on public.safety_incidents to service_role; grant SELECT on public.safety_incidents to service_role; grant UPDATE on public.safety_incidents to service_role; grant DELETE on public.safety_incidents to service_role; grant TRUNCATE on public.safety_incidents to service_role; grant REFERENCES on public.safety_incidents to service_role; grant TRIGGER on public.safety_incidents to service_role; grant MAINTAIN on public.safety_incidents to service_role;

revoke all on public.wellness_session_state from public, anon, authenticated, service_role; grant INSERT on public.wellness_session_state to anon; grant SELECT on public.wellness_session_state to anon; grant UPDATE on public.wellness_session_state to anon; grant DELETE on public.wellness_session_state to anon; grant TRUNCATE on public.wellness_session_state to anon; grant REFERENCES on public.wellness_session_state to anon; grant TRIGGER on public.wellness_session_state to anon; grant MAINTAIN on public.wellness_session_state to anon; grant INSERT on public.wellness_session_state to authenticated; grant SELECT on public.wellness_session_state to authenticated; grant UPDATE on public.wellness_session_state to authenticated; grant DELETE on public.wellness_session_state to authenticated; grant TRUNCATE on public.wellness_session_state to authenticated; grant REFERENCES on public.wellness_session_state to authenticated; grant TRIGGER on public.wellness_session_state to authenticated; grant MAINTAIN on public.wellness_session_state to authenticated; grant INSERT on public.wellness_session_state to service_role; grant SELECT on public.wellness_session_state to service_role; grant UPDATE on public.wellness_session_state to service_role; grant DELETE on public.wellness_session_state to service_role; grant TRUNCATE on public.wellness_session_state to service_role; grant REFERENCES on public.wellness_session_state to service_role; grant TRIGGER on public.wellness_session_state to service_role; grant MAINTAIN on public.wellness_session_state to service_role;

revoke all on public.daily_job_reports from public, anon, authenticated, service_role; grant INSERT on public.daily_job_reports to anon; grant SELECT on public.daily_job_reports to anon; grant UPDATE on public.daily_job_reports to anon; grant DELETE on public.daily_job_reports to anon; grant TRUNCATE on public.daily_job_reports to anon; grant REFERENCES on public.daily_job_reports to anon; grant TRIGGER on public.daily_job_reports to anon; grant MAINTAIN on public.daily_job_reports to anon; grant INSERT on public.daily_job_reports to authenticated; grant SELECT on public.daily_job_reports to authenticated; grant UPDATE on public.daily_job_reports to authenticated; grant DELETE on public.daily_job_reports to authenticated; grant TRUNCATE on public.daily_job_reports to authenticated; grant REFERENCES on public.daily_job_reports to authenticated; grant TRIGGER on public.daily_job_reports to authenticated; grant MAINTAIN on public.daily_job_reports to authenticated; grant INSERT on public.daily_job_reports to service_role; grant SELECT on public.daily_job_reports to service_role; grant UPDATE on public.daily_job_reports to service_role; grant DELETE on public.daily_job_reports to service_role; grant TRUNCATE on public.daily_job_reports to service_role; grant REFERENCES on public.daily_job_reports to service_role; grant TRIGGER on public.daily_job_reports to service_role; grant MAINTAIN on public.daily_job_reports to service_role;

revoke all on public.trade_playbooks from public, anon, authenticated, service_role; grant INSERT on public.trade_playbooks to anon; grant SELECT on public.trade_playbooks to anon; grant UPDATE on public.trade_playbooks to anon; grant DELETE on public.trade_playbooks to anon; grant TRUNCATE on public.trade_playbooks to anon; grant REFERENCES on public.trade_playbooks to anon; grant TRIGGER on public.trade_playbooks to anon; grant MAINTAIN on public.trade_playbooks to anon; grant INSERT on public.trade_playbooks to authenticated; grant SELECT on public.trade_playbooks to authenticated; grant UPDATE on public.trade_playbooks to authenticated; grant DELETE on public.trade_playbooks to authenticated; grant TRUNCATE on public.trade_playbooks to authenticated; grant REFERENCES on public.trade_playbooks to authenticated; grant TRIGGER on public.trade_playbooks to authenticated; grant MAINTAIN on public.trade_playbooks to authenticated; grant INSERT on public.trade_playbooks to service_role; grant SELECT on public.trade_playbooks to service_role; grant UPDATE on public.trade_playbooks to service_role; grant DELETE on public.trade_playbooks to service_role; grant TRUNCATE on public.trade_playbooks to service_role; grant REFERENCES on public.trade_playbooks to service_role; grant TRIGGER on public.trade_playbooks to service_role; grant MAINTAIN on public.trade_playbooks to service_role;

revoke all on public.trade_playbook_steps from public, anon, authenticated, service_role; grant INSERT on public.trade_playbook_steps to anon; grant SELECT on public.trade_playbook_steps to anon; grant UPDATE on public.trade_playbook_steps to anon; grant DELETE on public.trade_playbook_steps to anon; grant TRUNCATE on public.trade_playbook_steps to anon; grant REFERENCES on public.trade_playbook_steps to anon; grant TRIGGER on public.trade_playbook_steps to anon; grant MAINTAIN on public.trade_playbook_steps to anon; grant INSERT on public.trade_playbook_steps to authenticated; grant SELECT on public.trade_playbook_steps to authenticated; grant UPDATE on public.trade_playbook_steps to authenticated; grant DELETE on public.trade_playbook_steps to authenticated; grant TRUNCATE on public.trade_playbook_steps to authenticated; grant REFERENCES on public.trade_playbook_steps to authenticated; grant TRIGGER on public.trade_playbook_steps to authenticated; grant MAINTAIN on public.trade_playbook_steps to authenticated; grant INSERT on public.trade_playbook_steps to service_role; grant SELECT on public.trade_playbook_steps to service_role; grant UPDATE on public.trade_playbook_steps to service_role; grant DELETE on public.trade_playbook_steps to service_role; grant TRUNCATE on public.trade_playbook_steps to service_role; grant REFERENCES on public.trade_playbook_steps to service_role; grant TRIGGER on public.trade_playbook_steps to service_role; grant MAINTAIN on public.trade_playbook_steps to service_role;

revoke all on public.trade_playbook_sources from public, anon, authenticated, service_role; grant INSERT on public.trade_playbook_sources to anon; grant SELECT on public.trade_playbook_sources to anon; grant UPDATE on public.trade_playbook_sources to anon; grant DELETE on public.trade_playbook_sources to anon; grant TRUNCATE on public.trade_playbook_sources to anon; grant REFERENCES on public.trade_playbook_sources to anon; grant TRIGGER on public.trade_playbook_sources to anon; grant MAINTAIN on public.trade_playbook_sources to anon; grant INSERT on public.trade_playbook_sources to authenticated; grant SELECT on public.trade_playbook_sources to authenticated; grant UPDATE on public.trade_playbook_sources to authenticated; grant DELETE on public.trade_playbook_sources to authenticated; grant TRUNCATE on public.trade_playbook_sources to authenticated; grant REFERENCES on public.trade_playbook_sources to authenticated; grant TRIGGER on public.trade_playbook_sources to authenticated; grant MAINTAIN on public.trade_playbook_sources to authenticated; grant INSERT on public.trade_playbook_sources to service_role; grant SELECT on public.trade_playbook_sources to service_role; grant UPDATE on public.trade_playbook_sources to service_role; grant DELETE on public.trade_playbook_sources to service_role; grant TRUNCATE on public.trade_playbook_sources to service_role; grant REFERENCES on public.trade_playbook_sources to service_role; grant TRIGGER on public.trade_playbook_sources to service_role; grant MAINTAIN on public.trade_playbook_sources to service_role;

revoke all on public.ask_threads from public, anon, authenticated, service_role; grant INSERT on public.ask_threads to authenticated; grant SELECT on public.ask_threads to authenticated; grant UPDATE on public.ask_threads to authenticated; grant DELETE on public.ask_threads to authenticated; grant TRUNCATE on public.ask_threads to authenticated; grant REFERENCES on public.ask_threads to authenticated; grant TRIGGER on public.ask_threads to authenticated; grant MAINTAIN on public.ask_threads to authenticated; grant INSERT on public.ask_threads to service_role; grant SELECT on public.ask_threads to service_role; grant UPDATE on public.ask_threads to service_role; grant DELETE on public.ask_threads to service_role; grant TRUNCATE on public.ask_threads to service_role; grant REFERENCES on public.ask_threads to service_role; grant TRIGGER on public.ask_threads to service_role; grant MAINTAIN on public.ask_threads to service_role;

revoke all on public.proof_live_sessions from public, anon, authenticated, service_role; grant INSERT on public.proof_live_sessions to anon; grant SELECT on public.proof_live_sessions to anon; grant UPDATE on public.proof_live_sessions to anon; grant DELETE on public.proof_live_sessions to anon; grant TRUNCATE on public.proof_live_sessions to anon; grant REFERENCES on public.proof_live_sessions to anon; grant TRIGGER on public.proof_live_sessions to anon; grant MAINTAIN on public.proof_live_sessions to anon; grant INSERT on public.proof_live_sessions to authenticated; grant SELECT on public.proof_live_sessions to authenticated; grant UPDATE on public.proof_live_sessions to authenticated; grant DELETE on public.proof_live_sessions to authenticated; grant TRUNCATE on public.proof_live_sessions to authenticated; grant REFERENCES on public.proof_live_sessions to authenticated; grant TRIGGER on public.proof_live_sessions to authenticated; grant MAINTAIN on public.proof_live_sessions to authenticated; grant INSERT on public.proof_live_sessions to service_role; grant SELECT on public.proof_live_sessions to service_role; grant UPDATE on public.proof_live_sessions to service_role; grant DELETE on public.proof_live_sessions to service_role; grant TRUNCATE on public.proof_live_sessions to service_role; grant REFERENCES on public.proof_live_sessions to service_role; grant TRIGGER on public.proof_live_sessions to service_role; grant MAINTAIN on public.proof_live_sessions to service_role;

revoke all on public.recording_acknowledgments from public, anon, authenticated, service_role; grant INSERT on public.recording_acknowledgments to authenticated; grant SELECT on public.recording_acknowledgments to authenticated; grant UPDATE on public.recording_acknowledgments to authenticated; grant DELETE on public.recording_acknowledgments to authenticated; grant TRUNCATE on public.recording_acknowledgments to authenticated; grant REFERENCES on public.recording_acknowledgments to authenticated; grant TRIGGER on public.recording_acknowledgments to authenticated; grant MAINTAIN on public.recording_acknowledgments to authenticated; grant INSERT on public.recording_acknowledgments to service_role; grant SELECT on public.recording_acknowledgments to service_role; grant UPDATE on public.recording_acknowledgments to service_role; grant DELETE on public.recording_acknowledgments to service_role; grant TRUNCATE on public.recording_acknowledgments to service_role; grant REFERENCES on public.recording_acknowledgments to service_role; grant TRIGGER on public.recording_acknowledgments to service_role; grant MAINTAIN on public.recording_acknowledgments to service_role;

revoke all on public.crm_agent_credentials from public, anon, authenticated, service_role; grant INSERT on public.crm_agent_credentials to service_role; grant SELECT on public.crm_agent_credentials to service_role; grant UPDATE on public.crm_agent_credentials to service_role; grant DELETE on public.crm_agent_credentials to service_role; grant TRUNCATE on public.crm_agent_credentials to service_role; grant REFERENCES on public.crm_agent_credentials to service_role; grant TRIGGER on public.crm_agent_credentials to service_role; grant MAINTAIN on public.crm_agent_credentials to service_role;

revoke all on public.crm_agent_jobs from public, anon, authenticated, service_role; grant INSERT on public.crm_agent_jobs to authenticated; grant SELECT on public.crm_agent_jobs to authenticated; grant UPDATE on public.crm_agent_jobs to authenticated; grant DELETE on public.crm_agent_jobs to authenticated; grant TRUNCATE on public.crm_agent_jobs to authenticated; grant REFERENCES on public.crm_agent_jobs to authenticated; grant TRIGGER on public.crm_agent_jobs to authenticated; grant MAINTAIN on public.crm_agent_jobs to authenticated; grant INSERT on public.crm_agent_jobs to service_role; grant SELECT on public.crm_agent_jobs to service_role; grant UPDATE on public.crm_agent_jobs to service_role; grant DELETE on public.crm_agent_jobs to service_role; grant TRUNCATE on public.crm_agent_jobs to service_role; grant REFERENCES on public.crm_agent_jobs to service_role; grant TRIGGER on public.crm_agent_jobs to service_role; grant MAINTAIN on public.crm_agent_jobs to service_role;

revoke all on public.usage_events from public, anon, authenticated, service_role; grant INSERT on public.usage_events to service_role; grant SELECT on public.usage_events to service_role; grant UPDATE on public.usage_events to service_role; grant DELETE on public.usage_events to service_role; grant TRUNCATE on public.usage_events to service_role; grant REFERENCES on public.usage_events to service_role; grant TRIGGER on public.usage_events to service_role; grant MAINTAIN on public.usage_events to service_role;

revoke all on public.content_mentions from public, anon, authenticated, service_role; grant INSERT on public.content_mentions to anon; grant SELECT on public.content_mentions to anon; grant UPDATE on public.content_mentions to anon; grant DELETE on public.content_mentions to anon; grant TRUNCATE on public.content_mentions to anon; grant REFERENCES on public.content_mentions to anon; grant TRIGGER on public.content_mentions to anon; grant MAINTAIN on public.content_mentions to anon; grant INSERT on public.content_mentions to authenticated; grant SELECT on public.content_mentions to authenticated; grant UPDATE on public.content_mentions to authenticated; grant DELETE on public.content_mentions to authenticated; grant TRUNCATE on public.content_mentions to authenticated; grant REFERENCES on public.content_mentions to authenticated; grant TRIGGER on public.content_mentions to authenticated; grant MAINTAIN on public.content_mentions to authenticated; grant INSERT on public.content_mentions to service_role; grant SELECT on public.content_mentions to service_role; grant UPDATE on public.content_mentions to service_role; grant DELETE on public.content_mentions to service_role; grant TRUNCATE on public.content_mentions to service_role; grant REFERENCES on public.content_mentions to service_role; grant TRIGGER on public.content_mentions to service_role; grant MAINTAIN on public.content_mentions to service_role;

revoke all on public.ask_job_notes from public, anon, authenticated, service_role; grant INSERT on public.ask_job_notes to authenticated; grant SELECT on public.ask_job_notes to authenticated; grant UPDATE on public.ask_job_notes to authenticated; grant DELETE on public.ask_job_notes to authenticated; grant TRUNCATE on public.ask_job_notes to authenticated; grant REFERENCES on public.ask_job_notes to authenticated; grant TRIGGER on public.ask_job_notes to authenticated; grant MAINTAIN on public.ask_job_notes to authenticated; grant INSERT on public.ask_job_notes to service_role; grant SELECT on public.ask_job_notes to service_role; grant UPDATE on public.ask_job_notes to service_role; grant DELETE on public.ask_job_notes to service_role; grant TRUNCATE on public.ask_job_notes to service_role; grant REFERENCES on public.ask_job_notes to service_role; grant TRIGGER on public.ask_job_notes to service_role; grant MAINTAIN on public.ask_job_notes to service_role;

revoke all on public.ask_transcript_chunks from public, anon, authenticated, service_role; grant SELECT on public.ask_transcript_chunks to authenticated; grant TRUNCATE on public.ask_transcript_chunks to authenticated; grant REFERENCES on public.ask_transcript_chunks to authenticated; grant TRIGGER on public.ask_transcript_chunks to authenticated; grant MAINTAIN on public.ask_transcript_chunks to authenticated; grant INSERT on public.ask_transcript_chunks to service_role; grant SELECT on public.ask_transcript_chunks to service_role; grant UPDATE on public.ask_transcript_chunks to service_role; grant DELETE on public.ask_transcript_chunks to service_role; grant TRUNCATE on public.ask_transcript_chunks to service_role; grant REFERENCES on public.ask_transcript_chunks to service_role; grant TRIGGER on public.ask_transcript_chunks to service_role; grant MAINTAIN on public.ask_transcript_chunks to service_role;

revoke all on public.voiceprints from public, anon, authenticated, service_role; grant INSERT on public.voiceprints to service_role; grant SELECT on public.voiceprints to service_role; grant UPDATE on public.voiceprints to service_role; grant DELETE on public.voiceprints to service_role; grant TRUNCATE on public.voiceprints to service_role; grant REFERENCES on public.voiceprints to service_role; grant TRIGGER on public.voiceprints to service_role; grant MAINTAIN on public.voiceprints to service_role; grant SELECT on public.voiceprints to authenticated;

revoke all on public.voiceprint_embeddings from public, anon, authenticated, service_role; grant INSERT on public.voiceprint_embeddings to service_role; grant SELECT on public.voiceprint_embeddings to service_role; grant UPDATE on public.voiceprint_embeddings to service_role; grant DELETE on public.voiceprint_embeddings to service_role; grant TRUNCATE on public.voiceprint_embeddings to service_role; grant REFERENCES on public.voiceprint_embeddings to service_role; grant TRIGGER on public.voiceprint_embeddings to service_role; grant MAINTAIN on public.voiceprint_embeddings to service_role; grant SELECT on public.voiceprint_embeddings to authenticated;

revoke all on public.voice_consent_events from public, anon, authenticated, service_role; grant INSERT on public.voice_consent_events to service_role; grant SELECT on public.voice_consent_events to service_role; grant UPDATE on public.voice_consent_events to service_role; grant DELETE on public.voice_consent_events to service_role; grant TRUNCATE on public.voice_consent_events to service_role; grant REFERENCES on public.voice_consent_events to service_role; grant TRIGGER on public.voice_consent_events to service_role; grant MAINTAIN on public.voice_consent_events to service_role; grant SELECT on public.voice_consent_events to authenticated;

revoke all on public.voice_enrollment_requests from public, anon, authenticated, service_role; grant INSERT on public.voice_enrollment_requests to service_role; grant SELECT on public.voice_enrollment_requests to service_role; grant UPDATE on public.voice_enrollment_requests to service_role; grant DELETE on public.voice_enrollment_requests to service_role; grant TRUNCATE on public.voice_enrollment_requests to service_role; grant REFERENCES on public.voice_enrollment_requests to service_role; grant TRIGGER on public.voice_enrollment_requests to service_role; grant MAINTAIN on public.voice_enrollment_requests to service_role; grant SELECT on public.voice_enrollment_requests to authenticated;

revoke all on public.speaker_identities from public, anon, authenticated, service_role; grant INSERT on public.speaker_identities to service_role; grant SELECT on public.speaker_identities to service_role; grant UPDATE on public.speaker_identities to service_role; grant DELETE on public.speaker_identities to service_role; grant TRUNCATE on public.speaker_identities to service_role; grant REFERENCES on public.speaker_identities to service_role; grant TRIGGER on public.speaker_identities to service_role; grant MAINTAIN on public.speaker_identities to service_role; grant SELECT on public.speaker_identities to authenticated;

revoke all on public.speaker_role_guesses from public, anon, authenticated, service_role; grant INSERT on public.speaker_role_guesses to service_role; grant SELECT on public.speaker_role_guesses to service_role; grant UPDATE on public.speaker_role_guesses to service_role; grant DELETE on public.speaker_role_guesses to service_role; grant TRUNCATE on public.speaker_role_guesses to service_role; grant REFERENCES on public.speaker_role_guesses to service_role; grant TRIGGER on public.speaker_role_guesses to service_role; grant MAINTAIN on public.speaker_role_guesses to service_role; grant SELECT on public.speaker_role_guesses to authenticated;

revoke all on public.clip_room_segments from public, anon, authenticated, service_role; grant INSERT on public.clip_room_segments to service_role; grant SELECT on public.clip_room_segments to service_role; grant UPDATE on public.clip_room_segments to service_role; grant DELETE on public.clip_room_segments to service_role; grant TRUNCATE on public.clip_room_segments to service_role; grant REFERENCES on public.clip_room_segments to service_role; grant TRIGGER on public.clip_room_segments to service_role; grant MAINTAIN on public.clip_room_segments to service_role; grant SELECT on public.clip_room_segments to authenticated;

revoke all on public.job_chat_documents from public, anon, authenticated, service_role; grant SELECT on public.job_chat_documents to authenticated; grant TRUNCATE on public.job_chat_documents to authenticated; grant REFERENCES on public.job_chat_documents to authenticated; grant TRIGGER on public.job_chat_documents to authenticated; grant MAINTAIN on public.job_chat_documents to authenticated; grant INSERT on public.job_chat_documents to service_role; grant SELECT on public.job_chat_documents to service_role; grant UPDATE on public.job_chat_documents to service_role; grant DELETE on public.job_chat_documents to service_role; grant TRUNCATE on public.job_chat_documents to service_role; grant REFERENCES on public.job_chat_documents to service_role; grant TRIGGER on public.job_chat_documents to service_role; grant MAINTAIN on public.job_chat_documents to service_role;

revoke all on public.ask_document_chunks from public, anon, authenticated, service_role; grant SELECT on public.ask_document_chunks to authenticated; grant TRUNCATE on public.ask_document_chunks to authenticated; grant REFERENCES on public.ask_document_chunks to authenticated; grant TRIGGER on public.ask_document_chunks to authenticated; grant MAINTAIN on public.ask_document_chunks to authenticated; grant INSERT on public.ask_document_chunks to service_role; grant SELECT on public.ask_document_chunks to service_role; grant UPDATE on public.ask_document_chunks to service_role; grant DELETE on public.ask_document_chunks to service_role; grant TRUNCATE on public.ask_document_chunks to service_role; grant REFERENCES on public.ask_document_chunks to service_role; grant TRIGGER on public.ask_document_chunks to service_role; grant MAINTAIN on public.ask_document_chunks to service_role;

revoke all on public.job_document_rooms from public, anon, authenticated, service_role; grant SELECT on public.job_document_rooms to authenticated; grant TRUNCATE on public.job_document_rooms to authenticated; grant REFERENCES on public.job_document_rooms to authenticated; grant TRIGGER on public.job_document_rooms to authenticated; grant MAINTAIN on public.job_document_rooms to authenticated; grant INSERT on public.job_document_rooms to service_role; grant SELECT on public.job_document_rooms to service_role; grant UPDATE on public.job_document_rooms to service_role; grant DELETE on public.job_document_rooms to service_role; grant TRUNCATE on public.job_document_rooms to service_role; grant REFERENCES on public.job_document_rooms to service_role; grant TRIGGER on public.job_document_rooms to service_role; grant MAINTAIN on public.job_document_rooms to service_role;

revoke all on public.ai_credit_ledger from public, anon, authenticated, service_role; grant INSERT on public.ai_credit_ledger to authenticated; grant SELECT on public.ai_credit_ledger to authenticated; grant UPDATE on public.ai_credit_ledger to authenticated; grant DELETE on public.ai_credit_ledger to authenticated; grant TRUNCATE on public.ai_credit_ledger to authenticated; grant REFERENCES on public.ai_credit_ledger to authenticated; grant TRIGGER on public.ai_credit_ledger to authenticated; grant MAINTAIN on public.ai_credit_ledger to authenticated; grant INSERT on public.ai_credit_ledger to service_role; grant SELECT on public.ai_credit_ledger to service_role; grant UPDATE on public.ai_credit_ledger to service_role; grant DELETE on public.ai_credit_ledger to service_role; grant TRUNCATE on public.ai_credit_ledger to service_role; grant REFERENCES on public.ai_credit_ledger to service_role; grant TRIGGER on public.ai_credit_ledger to service_role; grant MAINTAIN on public.ai_credit_ledger to service_role;

revoke all on public.ai_usage_allocations from public, anon, authenticated, service_role; grant INSERT on public.ai_usage_allocations to authenticated; grant SELECT on public.ai_usage_allocations to authenticated; grant UPDATE on public.ai_usage_allocations to authenticated; grant DELETE on public.ai_usage_allocations to authenticated; grant TRUNCATE on public.ai_usage_allocations to authenticated; grant REFERENCES on public.ai_usage_allocations to authenticated; grant TRIGGER on public.ai_usage_allocations to authenticated; grant MAINTAIN on public.ai_usage_allocations to authenticated; grant INSERT on public.ai_usage_allocations to service_role; grant SELECT on public.ai_usage_allocations to service_role; grant UPDATE on public.ai_usage_allocations to service_role; grant DELETE on public.ai_usage_allocations to service_role; grant TRUNCATE on public.ai_usage_allocations to service_role; grant REFERENCES on public.ai_usage_allocations to service_role; grant TRIGGER on public.ai_usage_allocations to service_role; grant MAINTAIN on public.ai_usage_allocations to service_role;

revoke all on public.ai_budget_price_spans from public, anon, authenticated, service_role; grant INSERT on public.ai_budget_price_spans to authenticated; grant SELECT on public.ai_budget_price_spans to authenticated; grant UPDATE on public.ai_budget_price_spans to authenticated; grant DELETE on public.ai_budget_price_spans to authenticated; grant TRUNCATE on public.ai_budget_price_spans to authenticated; grant REFERENCES on public.ai_budget_price_spans to authenticated; grant TRIGGER on public.ai_budget_price_spans to authenticated; grant MAINTAIN on public.ai_budget_price_spans to authenticated; grant INSERT on public.ai_budget_price_spans to service_role; grant SELECT on public.ai_budget_price_spans to service_role; grant UPDATE on public.ai_budget_price_spans to service_role; grant DELETE on public.ai_budget_price_spans to service_role; grant TRUNCATE on public.ai_budget_price_spans to service_role; grant REFERENCES on public.ai_budget_price_spans to service_role; grant TRIGGER on public.ai_budget_price_spans to service_role; grant MAINTAIN on public.ai_budget_price_spans to service_role;

revoke all on public.ai_credit_pack_clawbacks from public, anon, authenticated, service_role; grant INSERT on public.ai_credit_pack_clawbacks to service_role; grant SELECT on public.ai_credit_pack_clawbacks to service_role; grant UPDATE on public.ai_credit_pack_clawbacks to service_role; grant DELETE on public.ai_credit_pack_clawbacks to service_role; grant TRUNCATE on public.ai_credit_pack_clawbacks to service_role; grant REFERENCES on public.ai_credit_pack_clawbacks to service_role; grant TRIGGER on public.ai_credit_pack_clawbacks to service_role; grant MAINTAIN on public.ai_credit_pack_clawbacks to service_role;

revoke all on public.ai_credit_pack_disputes from public, anon, authenticated, service_role; grant INSERT on public.ai_credit_pack_disputes to service_role; grant SELECT on public.ai_credit_pack_disputes to service_role; grant UPDATE on public.ai_credit_pack_disputes to service_role; grant DELETE on public.ai_credit_pack_disputes to service_role; grant TRUNCATE on public.ai_credit_pack_disputes to service_role; grant REFERENCES on public.ai_credit_pack_disputes to service_role; grant TRIGGER on public.ai_credit_pack_disputes to service_role; grant MAINTAIN on public.ai_credit_pack_disputes to service_role;

revoke all on public.capture_upload_attempts from public, anon, authenticated, service_role; grant INSERT on public.capture_upload_attempts to service_role; grant SELECT on public.capture_upload_attempts to service_role; grant UPDATE on public.capture_upload_attempts to service_role; grant DELETE on public.capture_upload_attempts to service_role; grant TRUNCATE on public.capture_upload_attempts to service_role; grant REFERENCES on public.capture_upload_attempts to service_role; grant TRIGGER on public.capture_upload_attempts to service_role; grant MAINTAIN on public.capture_upload_attempts to service_role;

revoke all on public.ask_turn_events_id_seq from public, anon, authenticated, service_role; grant SELECT on public.ask_turn_events_id_seq to anon; grant UPDATE on public.ask_turn_events_id_seq to anon; grant USAGE on public.ask_turn_events_id_seq to anon; grant SELECT on public.ask_turn_events_id_seq to authenticated; grant UPDATE on public.ask_turn_events_id_seq to authenticated; grant USAGE on public.ask_turn_events_id_seq to authenticated; grant SELECT on public.ask_turn_events_id_seq to service_role; grant UPDATE on public.ask_turn_events_id_seq to service_role; grant USAGE on public.ask_turn_events_id_seq to service_role;

revoke all on public.ask_turn_events from public, anon, authenticated, service_role; grant INSERT on public.ask_turn_events to service_role; grant SELECT on public.ask_turn_events to service_role; grant UPDATE on public.ask_turn_events to service_role; grant DELETE on public.ask_turn_events to service_role; grant TRUNCATE on public.ask_turn_events to service_role; grant REFERENCES on public.ask_turn_events to service_role; grant TRIGGER on public.ask_turn_events to service_role; grant MAINTAIN on public.ask_turn_events to service_role;

revoke all on public.analytics_campaigns from public, anon, authenticated, service_role; grant INSERT on public.analytics_campaigns to service_role; grant SELECT on public.analytics_campaigns to service_role; grant UPDATE on public.analytics_campaigns to service_role; grant DELETE on public.analytics_campaigns to service_role; grant TRUNCATE on public.analytics_campaigns to service_role; grant REFERENCES on public.analytics_campaigns to service_role; grant TRIGGER on public.analytics_campaigns to service_role; grant MAINTAIN on public.analytics_campaigns to service_role;

revoke all on public.analytics_campaign_sends from public, anon, authenticated, service_role; grant INSERT on public.analytics_campaign_sends to service_role; grant SELECT on public.analytics_campaign_sends to service_role; grant UPDATE on public.analytics_campaign_sends to service_role; grant DELETE on public.analytics_campaign_sends to service_role; grant TRUNCATE on public.analytics_campaign_sends to service_role; grant REFERENCES on public.analytics_campaign_sends to service_role; grant TRIGGER on public.analytics_campaign_sends to service_role; grant MAINTAIN on public.analytics_campaign_sends to service_role;

revoke all on public.analytics_email_suppressions from public, anon, authenticated, service_role; grant INSERT on public.analytics_email_suppressions to service_role; grant SELECT on public.analytics_email_suppressions to service_role; grant UPDATE on public.analytics_email_suppressions to service_role; grant DELETE on public.analytics_email_suppressions to service_role; grant TRUNCATE on public.analytics_email_suppressions to service_role; grant REFERENCES on public.analytics_email_suppressions to service_role; grant TRIGGER on public.analytics_email_suppressions to service_role; grant MAINTAIN on public.analytics_email_suppressions to service_role;

revoke all on public.ai_credit_auto_recharge_settings from public, anon, authenticated, service_role; grant INSERT on public.ai_credit_auto_recharge_settings to authenticated; grant SELECT on public.ai_credit_auto_recharge_settings to authenticated; grant UPDATE on public.ai_credit_auto_recharge_settings to authenticated; grant DELETE on public.ai_credit_auto_recharge_settings to authenticated; grant TRUNCATE on public.ai_credit_auto_recharge_settings to authenticated; grant REFERENCES on public.ai_credit_auto_recharge_settings to authenticated; grant TRIGGER on public.ai_credit_auto_recharge_settings to authenticated; grant MAINTAIN on public.ai_credit_auto_recharge_settings to authenticated; grant INSERT on public.ai_credit_auto_recharge_settings to service_role; grant SELECT on public.ai_credit_auto_recharge_settings to service_role; grant UPDATE on public.ai_credit_auto_recharge_settings to service_role; grant DELETE on public.ai_credit_auto_recharge_settings to service_role; grant TRUNCATE on public.ai_credit_auto_recharge_settings to service_role; grant REFERENCES on public.ai_credit_auto_recharge_settings to service_role; grant TRIGGER on public.ai_credit_auto_recharge_settings to service_role; grant MAINTAIN on public.ai_credit_auto_recharge_settings to service_role;

revoke all on public.ai_credit_auto_recharges from public, anon, authenticated, service_role; grant INSERT on public.ai_credit_auto_recharges to authenticated; grant SELECT on public.ai_credit_auto_recharges to authenticated; grant UPDATE on public.ai_credit_auto_recharges to authenticated; grant DELETE on public.ai_credit_auto_recharges to authenticated; grant TRUNCATE on public.ai_credit_auto_recharges to authenticated; grant REFERENCES on public.ai_credit_auto_recharges to authenticated; grant TRIGGER on public.ai_credit_auto_recharges to authenticated; grant MAINTAIN on public.ai_credit_auto_recharges to authenticated; grant INSERT on public.ai_credit_auto_recharges to service_role; grant SELECT on public.ai_credit_auto_recharges to service_role; grant UPDATE on public.ai_credit_auto_recharges to service_role; grant DELETE on public.ai_credit_auto_recharges to service_role; grant TRUNCATE on public.ai_credit_auto_recharges to service_role; grant REFERENCES on public.ai_credit_auto_recharges to service_role; grant TRIGGER on public.ai_credit_auto_recharges to service_role; grant MAINTAIN on public.ai_credit_auto_recharges to service_role;

revoke all on public.computer_sessions from public, anon, authenticated, service_role; grant INSERT on public.computer_sessions to service_role; grant SELECT on public.computer_sessions to service_role; grant UPDATE on public.computer_sessions to service_role; grant DELETE on public.computer_sessions to service_role; grant TRUNCATE on public.computer_sessions to service_role; grant REFERENCES on public.computer_sessions to service_role; grant TRIGGER on public.computer_sessions to service_role; grant MAINTAIN on public.computer_sessions to service_role;

revoke all on public.computer_tasks from public, anon, authenticated, service_role; grant INSERT on public.computer_tasks to service_role; grant SELECT on public.computer_tasks to service_role; grant UPDATE on public.computer_tasks to service_role; grant DELETE on public.computer_tasks to service_role; grant TRUNCATE on public.computer_tasks to service_role; grant REFERENCES on public.computer_tasks to service_role; grant TRIGGER on public.computer_tasks to service_role; grant MAINTAIN on public.computer_tasks to service_role;

revoke all on public.computer_approvals from public, anon, authenticated, service_role; grant INSERT on public.computer_approvals to service_role; grant SELECT on public.computer_approvals to service_role; grant UPDATE on public.computer_approvals to service_role; grant DELETE on public.computer_approvals to service_role; grant TRUNCATE on public.computer_approvals to service_role; grant REFERENCES on public.computer_approvals to service_role; grant TRIGGER on public.computer_approvals to service_role; grant MAINTAIN on public.computer_approvals to service_role;

revoke all on public.computer_audit_events_id_seq from public, anon, authenticated, service_role; grant SELECT on public.computer_audit_events_id_seq to anon; grant UPDATE on public.computer_audit_events_id_seq to anon; grant USAGE on public.computer_audit_events_id_seq to anon; grant SELECT on public.computer_audit_events_id_seq to authenticated; grant UPDATE on public.computer_audit_events_id_seq to authenticated; grant USAGE on public.computer_audit_events_id_seq to authenticated; grant SELECT on public.computer_audit_events_id_seq to service_role; grant UPDATE on public.computer_audit_events_id_seq to service_role; grant USAGE on public.computer_audit_events_id_seq to service_role;

revoke all on public.computer_audit_events from public, anon, authenticated, service_role; grant INSERT on public.computer_audit_events to service_role; grant SELECT on public.computer_audit_events to service_role; grant UPDATE on public.computer_audit_events to service_role; grant DELETE on public.computer_audit_events to service_role; grant TRUNCATE on public.computer_audit_events to service_role; grant REFERENCES on public.computer_audit_events to service_role; grant TRIGGER on public.computer_audit_events to service_role; grant MAINTAIN on public.computer_audit_events to service_role;

revoke all on public.computer_logins from public, anon, authenticated, service_role; grant INSERT on public.computer_logins to service_role; grant SELECT on public.computer_logins to service_role; grant UPDATE on public.computer_logins to service_role; grant DELETE on public.computer_logins to service_role; grant TRUNCATE on public.computer_logins to service_role; grant REFERENCES on public.computer_logins to service_role; grant TRIGGER on public.computer_logins to service_role; grant MAINTAIN on public.computer_logins to service_role;

revoke all on public.computer_login_credentials from public, anon, authenticated, service_role; grant INSERT on public.computer_login_credentials to service_role; grant SELECT on public.computer_login_credentials to service_role; grant UPDATE on public.computer_login_credentials to service_role; grant DELETE on public.computer_login_credentials to service_role; grant TRUNCATE on public.computer_login_credentials to service_role; grant REFERENCES on public.computer_login_credentials to service_role; grant TRIGGER on public.computer_login_credentials to service_role; grant MAINTAIN on public.computer_login_credentials to service_role;

revoke all on public.ask_communication_styles from public, anon, authenticated, service_role; grant INSERT on public.ask_communication_styles to authenticated; grant SELECT on public.ask_communication_styles to authenticated; grant UPDATE on public.ask_communication_styles to authenticated; grant DELETE on public.ask_communication_styles to authenticated; grant TRUNCATE on public.ask_communication_styles to authenticated; grant REFERENCES on public.ask_communication_styles to authenticated; grant TRIGGER on public.ask_communication_styles to authenticated; grant MAINTAIN on public.ask_communication_styles to authenticated; grant INSERT on public.ask_communication_styles to service_role; grant SELECT on public.ask_communication_styles to service_role; grant UPDATE on public.ask_communication_styles to service_role; grant DELETE on public.ask_communication_styles to service_role; grant TRUNCATE on public.ask_communication_styles to service_role; grant REFERENCES on public.ask_communication_styles to service_role; grant TRIGGER on public.ask_communication_styles to service_role; grant MAINTAIN on public.ask_communication_styles to service_role;

revoke all on public.ask_analysis_chunks from public, anon, authenticated, service_role; grant SELECT on public.ask_analysis_chunks to authenticated; grant TRUNCATE on public.ask_analysis_chunks to authenticated; grant REFERENCES on public.ask_analysis_chunks to authenticated; grant TRIGGER on public.ask_analysis_chunks to authenticated; grant MAINTAIN on public.ask_analysis_chunks to authenticated; grant INSERT on public.ask_analysis_chunks to service_role; grant SELECT on public.ask_analysis_chunks to service_role; grant UPDATE on public.ask_analysis_chunks to service_role; grant DELETE on public.ask_analysis_chunks to service_role; grant TRUNCATE on public.ask_analysis_chunks to service_role; grant REFERENCES on public.ask_analysis_chunks to service_role; grant TRIGGER on public.ask_analysis_chunks to service_role; grant MAINTAIN on public.ask_analysis_chunks to service_role;

revoke all on public.ask_route_decisions from public, anon, authenticated, service_role; grant SELECT on public.ask_route_decisions to authenticated; grant TRUNCATE on public.ask_route_decisions to authenticated; grant REFERENCES on public.ask_route_decisions to authenticated; grant TRIGGER on public.ask_route_decisions to authenticated; grant MAINTAIN on public.ask_route_decisions to authenticated; grant INSERT on public.ask_route_decisions to service_role; grant SELECT on public.ask_route_decisions to service_role; grant UPDATE on public.ask_route_decisions to service_role; grant DELETE on public.ask_route_decisions to service_role; grant TRUNCATE on public.ask_route_decisions to service_role; grant REFERENCES on public.ask_route_decisions to service_role; grant TRIGGER on public.ask_route_decisions to service_role; grant MAINTAIN on public.ask_route_decisions to service_role;

revoke all on public.ask_job_context_cache from public, anon, authenticated, service_role; grant SELECT on public.ask_job_context_cache to authenticated; grant TRUNCATE on public.ask_job_context_cache to authenticated; grant REFERENCES on public.ask_job_context_cache to authenticated; grant TRIGGER on public.ask_job_context_cache to authenticated; grant MAINTAIN on public.ask_job_context_cache to authenticated; grant INSERT on public.ask_job_context_cache to service_role; grant SELECT on public.ask_job_context_cache to service_role; grant UPDATE on public.ask_job_context_cache to service_role; grant DELETE on public.ask_job_context_cache to service_role; grant TRUNCATE on public.ask_job_context_cache to service_role; grant REFERENCES on public.ask_job_context_cache to service_role; grant TRIGGER on public.ask_job_context_cache to service_role; grant MAINTAIN on public.ask_job_context_cache to service_role;

revoke all on public.ask_org_memory_facts from public, anon, authenticated, service_role; grant INSERT on public.ask_org_memory_facts to authenticated; grant SELECT on public.ask_org_memory_facts to authenticated; grant UPDATE on public.ask_org_memory_facts to authenticated; grant TRUNCATE on public.ask_org_memory_facts to authenticated; grant REFERENCES on public.ask_org_memory_facts to authenticated; grant TRIGGER on public.ask_org_memory_facts to authenticated; grant MAINTAIN on public.ask_org_memory_facts to authenticated; grant INSERT on public.ask_org_memory_facts to service_role; grant SELECT on public.ask_org_memory_facts to service_role; grant UPDATE on public.ask_org_memory_facts to service_role; grant DELETE on public.ask_org_memory_facts to service_role; grant TRUNCATE on public.ask_org_memory_facts to service_role; grant REFERENCES on public.ask_org_memory_facts to service_role; grant TRIGGER on public.ask_org_memory_facts to service_role; grant MAINTAIN on public.ask_org_memory_facts to service_role;

revoke all on public.computer_site_playbooks from public, anon, authenticated, service_role; grant SELECT on public.computer_site_playbooks to anon; grant TRUNCATE on public.computer_site_playbooks to anon; grant REFERENCES on public.computer_site_playbooks to anon; grant TRIGGER on public.computer_site_playbooks to anon; grant MAINTAIN on public.computer_site_playbooks to anon; grant SELECT on public.computer_site_playbooks to authenticated; grant TRUNCATE on public.computer_site_playbooks to authenticated; grant REFERENCES on public.computer_site_playbooks to authenticated; grant TRIGGER on public.computer_site_playbooks to authenticated; grant MAINTAIN on public.computer_site_playbooks to authenticated; grant INSERT on public.computer_site_playbooks to service_role; grant SELECT on public.computer_site_playbooks to service_role; grant UPDATE on public.computer_site_playbooks to service_role; grant DELETE on public.computer_site_playbooks to service_role; grant TRUNCATE on public.computer_site_playbooks to service_role; grant REFERENCES on public.computer_site_playbooks to service_role; grant TRIGGER on public.computer_site_playbooks to service_role; grant MAINTAIN on public.computer_site_playbooks to service_role;

revoke all on public.computer_playbook_outcomes from public, anon, authenticated, service_role; grant SELECT on public.computer_playbook_outcomes to anon; grant TRUNCATE on public.computer_playbook_outcomes to anon; grant REFERENCES on public.computer_playbook_outcomes to anon; grant TRIGGER on public.computer_playbook_outcomes to anon; grant MAINTAIN on public.computer_playbook_outcomes to anon; grant SELECT on public.computer_playbook_outcomes to authenticated; grant TRUNCATE on public.computer_playbook_outcomes to authenticated; grant REFERENCES on public.computer_playbook_outcomes to authenticated; grant TRIGGER on public.computer_playbook_outcomes to authenticated; grant MAINTAIN on public.computer_playbook_outcomes to authenticated; grant INSERT on public.computer_playbook_outcomes to service_role; grant SELECT on public.computer_playbook_outcomes to service_role; grant UPDATE on public.computer_playbook_outcomes to service_role; grant DELETE on public.computer_playbook_outcomes to service_role; grant TRUNCATE on public.computer_playbook_outcomes to service_role; grant REFERENCES on public.computer_playbook_outcomes to service_role; grant TRIGGER on public.computer_playbook_outcomes to service_role; grant MAINTAIN on public.computer_playbook_outcomes to service_role;

revoke all on public.computer_supply_orders from public, anon, authenticated, service_role; grant SELECT on public.computer_supply_orders to anon; grant TRUNCATE on public.computer_supply_orders to anon; grant REFERENCES on public.computer_supply_orders to anon; grant TRIGGER on public.computer_supply_orders to anon; grant MAINTAIN on public.computer_supply_orders to anon; grant SELECT on public.computer_supply_orders to authenticated; grant TRUNCATE on public.computer_supply_orders to authenticated; grant REFERENCES on public.computer_supply_orders to authenticated; grant TRIGGER on public.computer_supply_orders to authenticated; grant MAINTAIN on public.computer_supply_orders to authenticated; grant INSERT on public.computer_supply_orders to service_role; grant SELECT on public.computer_supply_orders to service_role; grant UPDATE on public.computer_supply_orders to service_role; grant DELETE on public.computer_supply_orders to service_role; grant TRUNCATE on public.computer_supply_orders to service_role; grant REFERENCES on public.computer_supply_orders to service_role; grant TRIGGER on public.computer_supply_orders to service_role; grant MAINTAIN on public.computer_supply_orders to service_role;

revoke all on public.computer_practice_runs from public, anon, authenticated, service_role; grant INSERT on public.computer_practice_runs to service_role; grant SELECT on public.computer_practice_runs to service_role; grant UPDATE on public.computer_practice_runs to service_role; grant DELETE on public.computer_practice_runs to service_role; grant TRUNCATE on public.computer_practice_runs to service_role; grant REFERENCES on public.computer_practice_runs to service_role; grant TRIGGER on public.computer_practice_runs to service_role; grant MAINTAIN on public.computer_practice_runs to service_role;

revoke all on public.computer_practice_screens_id_seq from public, anon, authenticated, service_role; grant SELECT on public.computer_practice_screens_id_seq to anon; grant UPDATE on public.computer_practice_screens_id_seq to anon; grant USAGE on public.computer_practice_screens_id_seq to anon; grant SELECT on public.computer_practice_screens_id_seq to authenticated; grant UPDATE on public.computer_practice_screens_id_seq to authenticated; grant USAGE on public.computer_practice_screens_id_seq to authenticated; grant SELECT on public.computer_practice_screens_id_seq to service_role; grant UPDATE on public.computer_practice_screens_id_seq to service_role; grant USAGE on public.computer_practice_screens_id_seq to service_role;

revoke all on public.computer_practice_screens from public, anon, authenticated, service_role; grant INSERT on public.computer_practice_screens to service_role; grant SELECT on public.computer_practice_screens to service_role; grant UPDATE on public.computer_practice_screens to service_role; grant DELETE on public.computer_practice_screens to service_role; grant TRUNCATE on public.computer_practice_screens to service_role; grant REFERENCES on public.computer_practice_screens to service_role; grant TRIGGER on public.computer_practice_screens to service_role; grant MAINTAIN on public.computer_practice_screens to service_role;

revoke all on public.computer_playbook_drafts from public, anon, authenticated, service_role; grant INSERT on public.computer_playbook_drafts to service_role; grant SELECT on public.computer_playbook_drafts to service_role; grant UPDATE on public.computer_playbook_drafts to service_role; grant DELETE on public.computer_playbook_drafts to service_role; grant TRUNCATE on public.computer_playbook_drafts to service_role; grant REFERENCES on public.computer_playbook_drafts to service_role; grant TRIGGER on public.computer_playbook_drafts to service_role; grant MAINTAIN on public.computer_playbook_drafts to service_role;

revoke all on public.computer_route_decisions from public, anon, authenticated, service_role; grant SELECT on public.computer_route_decisions to authenticated; grant TRUNCATE on public.computer_route_decisions to authenticated; grant REFERENCES on public.computer_route_decisions to authenticated; grant TRIGGER on public.computer_route_decisions to authenticated; grant MAINTAIN on public.computer_route_decisions to authenticated; grant INSERT on public.computer_route_decisions to service_role; grant SELECT on public.computer_route_decisions to service_role; grant UPDATE on public.computer_route_decisions to service_role; grant DELETE on public.computer_route_decisions to service_role; grant TRUNCATE on public.computer_route_decisions to service_role; grant REFERENCES on public.computer_route_decisions to service_role; grant TRIGGER on public.computer_route_decisions to service_role; grant MAINTAIN on public.computer_route_decisions to service_role;

revoke all on private.payments_net from public, anon, authenticated, service_role;

revoke all on public.ask_answer_feedback from public, anon, authenticated, service_role; grant INSERT on public.ask_answer_feedback to anon; grant SELECT on public.ask_answer_feedback to anon; grant UPDATE on public.ask_answer_feedback to anon; grant DELETE on public.ask_answer_feedback to anon; grant TRUNCATE on public.ask_answer_feedback to anon; grant REFERENCES on public.ask_answer_feedback to anon; grant TRIGGER on public.ask_answer_feedback to anon; grant MAINTAIN on public.ask_answer_feedback to anon; grant INSERT on public.ask_answer_feedback to authenticated; grant SELECT on public.ask_answer_feedback to authenticated; grant UPDATE on public.ask_answer_feedback to authenticated; grant DELETE on public.ask_answer_feedback to authenticated; grant TRUNCATE on public.ask_answer_feedback to authenticated; grant REFERENCES on public.ask_answer_feedback to authenticated; grant TRIGGER on public.ask_answer_feedback to authenticated; grant MAINTAIN on public.ask_answer_feedback to authenticated; grant INSERT on public.ask_answer_feedback to service_role; grant SELECT on public.ask_answer_feedback to service_role; grant UPDATE on public.ask_answer_feedback to service_role; grant DELETE on public.ask_answer_feedback to service_role; grant TRUNCATE on public.ask_answer_feedback to service_role; grant REFERENCES on public.ask_answer_feedback to service_role; grant TRIGGER on public.ask_answer_feedback to service_role; grant MAINTAIN on public.ask_answer_feedback to service_role;

revoke all on public.ask_pinned_answers from public, anon, authenticated, service_role; grant INSERT on public.ask_pinned_answers to anon; grant SELECT on public.ask_pinned_answers to anon; grant UPDATE on public.ask_pinned_answers to anon; grant DELETE on public.ask_pinned_answers to anon; grant TRUNCATE on public.ask_pinned_answers to anon; grant REFERENCES on public.ask_pinned_answers to anon; grant TRIGGER on public.ask_pinned_answers to anon; grant MAINTAIN on public.ask_pinned_answers to anon; grant INSERT on public.ask_pinned_answers to authenticated; grant SELECT on public.ask_pinned_answers to authenticated; grant UPDATE on public.ask_pinned_answers to authenticated; grant DELETE on public.ask_pinned_answers to authenticated; grant TRUNCATE on public.ask_pinned_answers to authenticated; grant REFERENCES on public.ask_pinned_answers to authenticated; grant TRIGGER on public.ask_pinned_answers to authenticated; grant MAINTAIN on public.ask_pinned_answers to authenticated; grant INSERT on public.ask_pinned_answers to service_role; grant SELECT on public.ask_pinned_answers to service_role; grant UPDATE on public.ask_pinned_answers to service_role; grant DELETE on public.ask_pinned_answers to service_role; grant TRUNCATE on public.ask_pinned_answers to service_role; grant REFERENCES on public.ask_pinned_answers to service_role; grant TRIGGER on public.ask_pinned_answers to service_role; grant MAINTAIN on public.ask_pinned_answers to service_role;

revoke all on public.ask_pending_actions from public, anon, authenticated, service_role; grant SELECT on public.ask_pending_actions to anon; grant TRUNCATE on public.ask_pending_actions to anon; grant REFERENCES on public.ask_pending_actions to anon; grant TRIGGER on public.ask_pending_actions to anon; grant MAINTAIN on public.ask_pending_actions to anon; grant SELECT on public.ask_pending_actions to authenticated; grant TRUNCATE on public.ask_pending_actions to authenticated; grant REFERENCES on public.ask_pending_actions to authenticated; grant TRIGGER on public.ask_pending_actions to authenticated; grant MAINTAIN on public.ask_pending_actions to authenticated; grant INSERT on public.ask_pending_actions to service_role; grant SELECT on public.ask_pending_actions to service_role; grant UPDATE on public.ask_pending_actions to service_role; grant DELETE on public.ask_pending_actions to service_role; grant TRUNCATE on public.ask_pending_actions to service_role; grant REFERENCES on public.ask_pending_actions to service_role; grant TRIGGER on public.ask_pending_actions to service_role; grant MAINTAIN on public.ask_pending_actions to service_role;

revoke all on public.demo_bookings from public, anon, authenticated, service_role; grant INSERT on public.demo_bookings to service_role; grant SELECT on public.demo_bookings to service_role; grant UPDATE on public.demo_bookings to service_role; grant DELETE on public.demo_bookings to service_role; grant TRUNCATE on public.demo_bookings to service_role; grant REFERENCES on public.demo_bookings to service_role; grant TRIGGER on public.demo_bookings to service_role; grant MAINTAIN on public.demo_bookings to service_role;

revoke all on function public.create_org(p_name text, p_role member_role, p_work_type work_type) from public, anon, authenticated, service_role; grant execute on function public.create_org(p_name text, p_role member_role, p_work_type work_type) to authenticated; grant execute on function public.create_org(p_name text, p_role member_role, p_work_type work_type) to service_role;

revoke all on function public.join_org(p_code text, p_role member_role, p_work_type work_type) from public, anon, authenticated, service_role; grant execute on function public.join_org(p_code text, p_role member_role, p_work_type work_type) to authenticated; grant execute on function public.join_org(p_code text, p_role member_role, p_work_type work_type) to service_role;

revoke all on function private.is_org_member(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.is_org_member(p_org uuid) to authenticated; grant execute on function private.is_org_member(p_org uuid) to service_role;

revoke all on function private.shares_org(p_user uuid) from public, anon, authenticated, service_role; grant execute on function private.shares_org(p_user uuid) to public; grant execute on function private.shares_org(p_user uuid) to authenticated; grant execute on function private.shares_org(p_user uuid) to anon;

revoke all on function public.device_lookup(p_device_id uuid, p_secret_hash text) from public, anon, authenticated, service_role; grant execute on function public.device_lookup(p_device_id uuid, p_secret_hash text) to anon; grant execute on function public.device_lookup(p_device_id uuid, p_secret_hash text) to authenticated; grant execute on function public.device_lookup(p_device_id uuid, p_secret_hash text) to service_role;

revoke all on function public.revoke_my_devices() from public, anon, authenticated, service_role; grant execute on function public.revoke_my_devices() to authenticated; grant execute on function public.revoke_my_devices() to service_role;

revoke all on function public.device_verify_pin(p_device_id uuid, p_secret_hash text, p_pin_hash text) from public, anon, authenticated, service_role; grant execute on function public.device_verify_pin(p_device_id uuid, p_secret_hash text, p_pin_hash text) to anon; grant execute on function public.device_verify_pin(p_device_id uuid, p_secret_hash text, p_pin_hash text) to authenticated; grant execute on function public.device_verify_pin(p_device_id uuid, p_secret_hash text, p_pin_hash text) to service_role;

revoke all on function public.enroll_device(p_secret_hash text, p_pin_hash text, p_pin_salt text, p_label text, p_replace_device_id uuid) from public, anon, authenticated, service_role; grant execute on function public.enroll_device(p_secret_hash text, p_pin_hash text, p_pin_salt text, p_label text, p_replace_device_id uuid) to authenticated; grant execute on function public.enroll_device(p_secret_hash text, p_pin_hash text, p_pin_salt text, p_label text, p_replace_device_id uuid) to service_role;

revoke all on function public.web_access_touch_updated_at() from public, anon, authenticated, service_role; grant execute on function public.web_access_touch_updated_at() to public; grant execute on function public.web_access_touch_updated_at() to anon; grant execute on function public.web_access_touch_updated_at() to authenticated; grant execute on function public.web_access_touch_updated_at() to service_role;

revoke all on function public.audit_install_bridges() from public, anon, authenticated, service_role; grant execute on function public.audit_install_bridges() to public; grant execute on function public.audit_install_bridges() to anon; grant execute on function public.audit_install_bridges() to authenticated; grant execute on function public.audit_install_bridges() to service_role;

revoke all on function private.touch_updated_at() from public, anon, authenticated, service_role; grant execute on function private.touch_updated_at() to public;

revoke all on function private.can_manage_billing(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.can_manage_billing(p_org uuid) to public;

revoke all on function private.price_usage(p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean) from public, anon, authenticated, service_role; grant execute on function private.price_usage(p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean) to public;

revoke all on function public.quote_usage(p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean) from public, anon, authenticated, service_role; grant execute on function public.quote_usage(p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean) to service_role;

revoke all on function private.advance_billing_period(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.advance_billing_period(p_org uuid) to public;

revoke all on function public.record_usage(p_org uuid, p_model_id text, p_request_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean, p_feature text) from public, anon, authenticated, service_role; grant execute on function public.record_usage(p_org uuid, p_model_id text, p_request_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean, p_feature text) to authenticated; grant execute on function public.record_usage(p_org uuid, p_model_id text, p_request_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_cache_read_tokens bigint, p_is_batch boolean, p_feature text) to service_role;

revoke all on function public.set_billing_plan(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer) from public, anon, authenticated, service_role; grant execute on function public.set_billing_plan(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer) to authenticated; grant execute on function public.set_billing_plan(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer) to service_role;

revoke all on function public.set_billing_settings(p_org uuid, p_auto_reload_enabled boolean, p_auto_reload_threshold bigint, p_auto_reload_amount bigint, p_monthly_spend_limit bigint, p_clear_spend_limit boolean) from public, anon, authenticated, service_role; grant execute on function public.set_billing_settings(p_org uuid, p_auto_reload_enabled boolean, p_auto_reload_threshold bigint, p_auto_reload_amount bigint, p_monthly_spend_limit bigint, p_clear_spend_limit boolean) to authenticated; grant execute on function public.set_billing_settings(p_org uuid, p_auto_reload_enabled boolean, p_auto_reload_threshold bigint, p_auto_reload_amount bigint, p_monthly_spend_limit bigint, p_clear_spend_limit boolean) to service_role;

revoke all on function public.billing_overview(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.billing_overview(p_org uuid) to authenticated; grant execute on function public.billing_overview(p_org uuid) to service_role;

revoke all on function public.stripe_event_seen(p_event_id text, p_type text) from public, anon, authenticated, service_role; grant execute on function public.stripe_event_seen(p_event_id text, p_type text) to service_role;

revoke all on function public.link_stripe_customer(p_org uuid, p_customer_id text) from public, anon, authenticated, service_role; grant execute on function public.link_stripe_customer(p_org uuid, p_customer_id text) to authenticated; grant execute on function public.link_stripe_customer(p_org uuid, p_customer_id text) to service_role;

revoke all on function public.record_payment(p_org uuid, p_kind text, p_status text, p_amount_cents integer, p_currency text, p_description text, p_payment_intent_id text, p_invoice_id text, p_charge_id text, p_receipt_url text, p_hosted_invoice_url text, p_invoice_pdf_url text, p_receipt_email text, p_card_brand text, p_card_last4 text, p_purchase_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_failure_reason text) from public, anon, authenticated, service_role; grant execute on function public.record_payment(p_org uuid, p_kind text, p_status text, p_amount_cents integer, p_currency text, p_description text, p_payment_intent_id text, p_invoice_id text, p_charge_id text, p_receipt_url text, p_hosted_invoice_url text, p_invoice_pdf_url text, p_receipt_email text, p_card_brand text, p_card_last4 text, p_purchase_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_failure_reason text) to service_role;

revoke all on function public.stripe_cancel_subscription(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.stripe_cancel_subscription(p_org uuid) to service_role;

revoke all on function private.analytics_scope() from public, anon, authenticated, service_role;

revoke all on function private.require_analytics(p_min analytics_scope) from public, anon, authenticated, service_role;

revoke all on function public.analytics_whoami() from public, anon, authenticated, service_role; grant execute on function public.analytics_whoami() to service_role;

revoke all on function private.rollup_feature_usage() from public, anon, authenticated, service_role; grant execute on function private.rollup_feature_usage() to public;

revoke all on function public.feature_heartbeat(p_feature text, p_session uuid, p_delta_ms integer, p_client text, p_interactions integer) from public, anon, authenticated, service_role; grant execute on function public.feature_heartbeat(p_feature text, p_session uuid, p_delta_ms integer, p_client text, p_interactions integer) to authenticated; grant execute on function public.feature_heartbeat(p_feature text, p_session uuid, p_delta_ms integer, p_client text, p_interactions integer) to service_role;

revoke all on function private.plan_mrr_cents(p_plan text, p_interval billing_interval, p_seats integer, p_status subscription_status) from public, anon, authenticated, service_role;

revoke all on function private.record_billing_event() from public, anon, authenticated, service_role;

revoke all on function private.pct_change(p_now numeric, p_prev numeric) from public, anon, authenticated, service_role;

revoke all on function private.pm_current_org() from public, anon, authenticated, service_role; grant execute on function private.pm_current_org() to public;

revoke all on function private.pm_can_manage(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.pm_can_manage(p_org uuid) to public;

revoke all on function private.pm_project_in_org(p_project uuid, p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.pm_project_in_org(p_project uuid, p_org uuid) to public;

revoke all on function private.pm_assign_project_number() from public, anon, authenticated, service_role; grant execute on function private.pm_assign_project_number() to public;

revoke all on function private.pm_stamp_project_lifecycle() from public, anon, authenticated, service_role; grant execute on function private.pm_stamp_project_lifecycle() to public;

revoke all on function private.pm_stamp_task_completion() from public, anon, authenticated, service_role; grant execute on function private.pm_stamp_task_completion() to public;

revoke all on function private.pm_sync_equipment_status() from public, anon, authenticated, service_role; grant execute on function private.pm_sync_equipment_status() to public;

revoke all on function private.pm_stamp_document() from public, anon, authenticated, service_role; grant execute on function private.pm_stamp_document() to public;

revoke all on function private.pm_stamp_update() from public, anon, authenticated, service_role; grant execute on function private.pm_stamp_update() to public;

revoke all on function private.pm_fill_org_from_project() from public, anon, authenticated, service_role; grant execute on function private.pm_fill_org_from_project() to public;

revoke all on function private.pm_guard_task_update() from public, anon, authenticated, service_role; grant execute on function private.pm_guard_task_update() to public;

revoke all on function private.pm_guard_document_update() from public, anon, authenticated, service_role; grant execute on function private.pm_guard_document_update() to public;

revoke all on function private.pm_guard_alert_update() from public, anon, authenticated, service_role; grant execute on function private.pm_guard_alert_update() to public;

revoke all on function private.estimator_is_org_member(p_org_id uuid) from public, anon, authenticated, service_role; grant execute on function private.estimator_is_org_member(p_org_id uuid) to authenticated;

revoke all on function private.estimator_can_manage_credentials(p_org_id uuid) from public, anon, authenticated, service_role; grant execute on function private.estimator_can_manage_credentials(p_org_id uuid) to authenticated;

revoke all on function memory.current_org_id() from public, anon, authenticated, service_role; grant execute on function memory.current_org_id() to public;

revoke all on function memory.is_member_of(p_org_id uuid) from public, anon, authenticated, service_role; grant execute on function memory.is_member_of(p_org_id uuid) to public;

revoke all on function memory.is_org_member(p_org_id uuid, p_user_id uuid) from public, anon, authenticated, service_role; grant execute on function memory.is_org_member(p_org_id uuid, p_user_id uuid) to public;

revoke all on function memory.reject_mutation() from public, anon, authenticated, service_role; grant execute on function memory.reject_mutation() to public;

revoke all on function memory.touch_updated_at() from public, anon, authenticated, service_role; grant execute on function memory.touch_updated_at() to public;

revoke all on function memory.changed_fields(p_changes jsonb) from public, anon, authenticated, service_role; grant execute on function memory.changed_fields(p_changes jsonb) to public;

revoke all on function memory.job_in_org(p_job_id uuid, p_org_id uuid) from public, anon, authenticated, service_role; grant execute on function memory.job_in_org(p_job_id uuid, p_org_id uuid) to public;

revoke all on function memory.assign_job_number() from public, anon, authenticated, service_role; grant execute on function memory.assign_job_number() to public;

revoke all on function memory.stamp_job_lifecycle() from public, anon, authenticated, service_role; grant execute on function memory.stamp_job_lifecycle() to public;

revoke all on function memory.stamp_task_completion() from public, anon, authenticated, service_role; grant execute on function memory.stamp_task_completion() to public;

revoke all on function memory.capture() from public, anon, authenticated, service_role; grant execute on function memory.capture() to public;

revoke all on function public.record_memory_event(p_event_type text, p_summary text, p_entity_type text, p_entity_id uuid, p_job_id uuid, p_details jsonb) from public, anon, authenticated, service_role; grant execute on function public.record_memory_event(p_event_type text, p_summary text, p_entity_type text, p_entity_id uuid, p_job_id uuid, p_details jsonb) to authenticated; grant execute on function public.record_memory_event(p_event_type text, p_summary text, p_entity_type text, p_entity_id uuid, p_job_id uuid, p_details jsonb) to service_role;

revoke all on function private.can_sell(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.can_sell(p_org uuid) to public;

revoke all on function private.pm_bump_thread_on_message() from public, anon, authenticated, service_role; grant execute on function private.pm_bump_thread_on_message() to public;

revoke all on function private.pm_fill_org_from_thread() from public, anon, authenticated, service_role; grant execute on function private.pm_fill_org_from_thread() to public;

revoke all on function public.set_org_contractor_type(p_contractor_type text) from public, anon, authenticated, service_role; grant execute on function public.set_org_contractor_type(p_contractor_type text) to authenticated; grant execute on function public.set_org_contractor_type(p_contractor_type text) to service_role;

revoke all on function public.app_connectors_touch_updated_at() from public, anon, authenticated, service_role; grant execute on function public.app_connectors_touch_updated_at() to public; grant execute on function public.app_connectors_touch_updated_at() to anon; grant execute on function public.app_connectors_touch_updated_at() to authenticated; grant execute on function public.app_connectors_touch_updated_at() to service_role;

revoke all on function private.homeowner_portal_bump_conversation() from public, anon, authenticated, service_role; grant execute on function private.homeowner_portal_bump_conversation() to public;

revoke all on function private.finance_current_org() from public, anon, authenticated, service_role; grant execute on function private.finance_current_org() to public;

revoke all on function private.can_manage_finance(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.can_manage_finance(p_org uuid) to public;

revoke all on function public.open_finance_share(p_token text) from public, anon, authenticated, service_role; grant execute on function public.open_finance_share(p_token text) to anon; grant execute on function public.open_finance_share(p_token text) to authenticated; grant execute on function public.open_finance_share(p_token text) to service_role;

revoke all on function private.freeze_ownership() from public, anon, authenticated, service_role; grant execute on function private.freeze_ownership() to public;

revoke all on function private.next_counter(p_org uuid, p_name text) from public, anon, authenticated, service_role;

revoke all on function private.assign_job_number() from public, anon, authenticated, service_role; grant execute on function private.assign_job_number() to public;

revoke all on function private.job_brief_next_revision() from public, anon, authenticated, service_role; grant execute on function private.job_brief_next_revision() to public;

revoke all on function private.job_briefs_append_only() from public, anon, authenticated, service_role; grant execute on function private.job_briefs_append_only() to public;

revoke all on function private.job_messages_append_only() from public, anon, authenticated, service_role; grant execute on function private.job_messages_append_only() to public;

revoke all on function private.job_proof_questions_append_only() from public, anon, authenticated, service_role; grant execute on function private.job_proof_questions_append_only() to public;

revoke all on function private.job_evidence_access_append_only() from public, anon, authenticated, service_role; grant execute on function private.job_evidence_access_append_only() to public;

revoke all on function private.evidence_downloads_settle_once() from public, anon, authenticated, service_role; grant execute on function private.evidence_downloads_settle_once() to public;

revoke all on function private.resolve_ai_model_pricing(p_provider text, p_model text, p_at timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function private.resolve_ai_model_pricing(p_provider text, p_model text, p_at timestamp with time zone) to public;

revoke all on function private.resolve_compute_unit_rate(p_at timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function private.resolve_compute_unit_rate(p_at timestamp with time zone) to public;

revoke all on function private.usd_to_nanos(p_usd numeric) from public, anon, authenticated, service_role; grant execute on function private.usd_to_nanos(p_usd numeric) to public;

revoke all on function private.estimate_ai_cost_nanos(p_pricing private.ai_model_pricing, p_input_tokens bigint, p_output_tokens bigint, p_cached_input_tokens bigint, p_reasoning_tokens bigint, p_image_count integer, p_video_seconds numeric, p_audio_seconds numeric, p_ocr_pages integer, p_embedding_tokens bigint, p_third_party_cost_nanos bigint, p_other_variable_cost_nanos bigint) from public, anon, authenticated, service_role; grant execute on function private.estimate_ai_cost_nanos(p_pricing private.ai_model_pricing, p_input_tokens bigint, p_output_tokens bigint, p_cached_input_tokens bigint, p_reasoning_tokens bigint, p_image_count integer, p_video_seconds numeric, p_audio_seconds numeric, p_ocr_pages integer, p_embedding_tokens bigint, p_third_party_cost_nanos bigint, p_other_variable_cost_nanos bigint) to public;

revoke all on function private.metering_period_bounds(p_org uuid, p_reference timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function private.metering_period_bounds(p_org uuid, p_reference timestamp with time zone) to public;

revoke all on function private.org_metering_terms(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.org_metering_terms(p_org uuid) to public;

revoke all on function public.record_ai_usage_event(p_org uuid, p_idempotency_key text, p_action_type text, p_provider text, p_model text, p_user_id uuid, p_job_id uuid, p_workflow_id text, p_agent_run_id text, p_agent_type text, p_input_tokens bigint, p_output_tokens bigint, p_cached_input_tokens bigint, p_reasoning_tokens bigint, p_image_count integer, p_video_seconds numeric, p_audio_seconds numeric, p_ocr_pages integer, p_embedding_tokens bigint, p_third_party_cost_nanos bigint, p_other_variable_cost_nanos bigint, p_billable boolean, p_metadata jsonb, p_at timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function public.record_ai_usage_event(p_org uuid, p_idempotency_key text, p_action_type text, p_provider text, p_model text, p_user_id uuid, p_job_id uuid, p_workflow_id text, p_agent_run_id text, p_agent_type text, p_input_tokens bigint, p_output_tokens bigint, p_cached_input_tokens bigint, p_reasoning_tokens bigint, p_image_count integer, p_video_seconds numeric, p_audio_seconds numeric, p_ocr_pages integer, p_embedding_tokens bigint, p_third_party_cost_nanos bigint, p_other_variable_cost_nanos bigint, p_billable boolean, p_metadata jsonb, p_at timestamp with time zone) to service_role;

revoke all on function public.register_billable_job(p_org uuid, p_job_id uuid, p_workflow_type text, p_idempotency_key text, p_at timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function public.register_billable_job(p_org uuid, p_job_id uuid, p_workflow_type text, p_idempotency_key text, p_at timestamp with time zone) to service_role;

revoke all on function public.calculate_metering_period(p_org uuid, p_period_start date) from public, anon, authenticated, service_role; grant execute on function public.calculate_metering_period(p_org uuid, p_period_start date) to service_role;

revoke all on function public.customer_metering_summary(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.customer_metering_summary(p_org uuid) to service_role;

revoke all on function public.close_metering_period(p_org uuid, p_period_start date) from public, anon, authenticated, service_role; grant execute on function public.close_metering_period(p_org uuid, p_period_start date) to service_role;

revoke all on function private.ensure_org_metering() from public, anon, authenticated, service_role; grant execute on function private.ensure_org_metering() to public;

revoke all on function private.job_location_no_cycle() from public, anon, authenticated, service_role; grant execute on function private.job_location_no_cycle() to public;

revoke all on function private.human_review_decisions_append_only() from public, anon, authenticated, service_role; grant execute on function private.human_review_decisions_append_only() to public;

revoke all on function private.verification_audit_append_only() from public, anon, authenticated, service_role; grant execute on function private.verification_audit_append_only() to public;

revoke all on function private.llm_verification_runs_append_only() from public, anon, authenticated, service_role; grant execute on function private.llm_verification_runs_append_only() to public;

revoke all on function private.dataset_versions_protect_released() from public, anon, authenticated, service_role; grant execute on function private.dataset_versions_protect_released() to public;

revoke all on function private.mirror_append_only() from public, anon, authenticated, service_role; grant execute on function private.mirror_append_only() to public;

revoke all on function private.expire_backups() from public, anon, authenticated, service_role;

revoke all on function public.backup_public_tables() from public, anon, authenticated, service_role; grant execute on function public.backup_public_tables() to service_role;

revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role; grant execute on function public.touch_updated_at() to public; grant execute on function public.touch_updated_at() to anon; grant execute on function public.touch_updated_at() to authenticated; grant execute on function public.touch_updated_at() to service_role;

revoke all on function public.is_poolable_address(addr text) from public, anon, authenticated, service_role; grant execute on function public.is_poolable_address(addr text) to public; grant execute on function public.is_poolable_address(addr text) to anon; grant execute on function public.is_poolable_address(addr text) to authenticated; grant execute on function public.is_poolable_address(addr text) to service_role;

revoke all on function public.network_block_erased() from public, anon, authenticated, service_role; grant execute on function public.network_block_erased() to public; grant execute on function public.network_block_erased() to anon; grant execute on function public.network_block_erased() to authenticated; grant execute on function public.network_block_erased() to service_role;

revoke all on function public.network_erase(p_email text, p_reason text) from public, anon, authenticated, service_role; grant execute on function public.network_erase(p_email text, p_reason text) to service_role;

revoke all on function public.network_contribute(p_org uuid, p_email text, p_full_name text, p_title text, p_company text, p_phone text, p_mobile text) from public, anon, authenticated, service_role; grant execute on function public.network_contribute(p_org uuid, p_email text, p_full_name text, p_title text, p_company text, p_phone text, p_mobile text) to service_role;

revoke all on function public.network_withdraw(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.network_withdraw(p_org uuid) to service_role;

revoke all on function public.record_unsubscribe(p_token text) from public, anon, authenticated, service_role; grant execute on function public.record_unsubscribe(p_token text) to service_role;

revoke all on function public.record_crew_location(p_lat double precision, p_lon double precision, p_accuracy double precision, p_heading double precision, p_speed double precision) from public, anon, authenticated, service_role; grant execute on function public.record_crew_location(p_lat double precision, p_lon double precision, p_accuracy double precision, p_heading double precision, p_speed double precision) to authenticated; grant execute on function public.record_crew_location(p_lat double precision, p_lon double precision, p_accuracy double precision, p_heading double precision, p_speed double precision) to service_role;

revoke all on function public.stop_sharing_location() from public, anon, authenticated, service_role; grant execute on function public.stop_sharing_location() to authenticated; grant execute on function public.stop_sharing_location() to service_role;

revoke all on function public.sweep_expired_locations() from public, anon, authenticated, service_role; grant execute on function public.sweep_expired_locations() to service_role;

revoke all on function private.crm_accounts_no_cycles() from public, anon, authenticated, service_role; grant execute on function private.crm_accounts_no_cycles() to public;

revoke all on function private.crm_account_merges_append_only() from public, anon, authenticated, service_role; grant execute on function private.crm_account_merges_append_only() to public;

revoke all on function private.purchase_order_transition() from public, anon, authenticated, service_role; grant execute on function private.purchase_order_transition() to public;

revoke all on function private.purchase_order_lines_frozen() from public, anon, authenticated, service_role; grant execute on function private.purchase_order_lines_frozen() to public;

revoke all on function private.purchase_order_events_append_only() from public, anon, authenticated, service_role; grant execute on function private.purchase_order_events_append_only() to public;

revoke all on function private.episode_verifications_append_only() from public, anon, authenticated, service_role; grant execute on function private.episode_verifications_append_only() to public;

revoke all on function public.my_org_membership() from public, anon, authenticated, service_role; grant execute on function public.my_org_membership() to authenticated; grant execute on function public.my_org_membership() to service_role;

revoke all on function private.platform_staff_scope() from public, anon, authenticated, service_role; grant execute on function private.platform_staff_scope() to public;

revoke all on function private.require_platform_staff(p_min platform_staff_scope) from public, anon, authenticated, service_role; grant execute on function private.require_platform_staff(p_min platform_staff_scope) to public;

revoke all on function public.platform_admin_whoami() from public, anon, authenticated, service_role; grant execute on function public.platform_admin_whoami() to service_role;

revoke all on function public.preview_org_by_join_code(p_code text) from public, anon, authenticated, service_role; grant execute on function public.preview_org_by_join_code(p_code text) to authenticated; grant execute on function public.preview_org_by_join_code(p_code text) to service_role;

revoke all on function public.repair_memory_job_fk() from public, anon, authenticated, service_role; grant execute on function public.repair_memory_job_fk() to service_role;

revoke all on function private.legal_append_only() from public, anon, authenticated, service_role; grant execute on function private.legal_append_only() to public;

revoke all on function private.legal_holds_guard() from public, anon, authenticated, service_role; grant execute on function private.legal_holds_guard() to public;

revoke all on function private.legal_vault_guard() from public, anon, authenticated, service_role; grant execute on function private.legal_vault_guard() to public;

revoke all on function private.job_proofs_forbid_destroy() from public, anon, authenticated, service_role; grant execute on function private.job_proofs_forbid_destroy() to public;

revoke all on function private.media_objects_forbid_destroy() from public, anon, authenticated, service_role; grant execute on function private.media_objects_forbid_destroy() to public;

revoke all on function private.episode_annotations_append_only() from public, anon, authenticated, service_role; grant execute on function private.episode_annotations_append_only() to public;

revoke all on function public.stripe_event_forget(p_event_id text) from public, anon, authenticated, service_role; grant execute on function public.stripe_event_forget(p_event_id text) to service_role;

revoke all on function private.org_members_guard_product_seat() from public, anon, authenticated, service_role; grant execute on function private.org_members_guard_product_seat() to public;

revoke all on function public.classify_token_feature(p_feature text) from public, anon, authenticated, service_role; grant execute on function public.classify_token_feature(p_feature text) to authenticated; grant execute on function public.classify_token_feature(p_feature text) to service_role;

revoke all on function public.intake_create_job_file(p_org_id uuid, p_title text, p_work_type text, p_address text, p_city text, p_postal_code text, p_region text, p_country text, p_latitude double precision, p_longitude double precision, p_claim_number text, p_brief_note text, p_facts jsonb, p_scope jsonb, p_invitees jsonb) from public, anon, authenticated, service_role; grant execute on function public.intake_create_job_file(p_org_id uuid, p_title text, p_work_type text, p_address text, p_city text, p_postal_code text, p_region text, p_country text, p_latitude double precision, p_longitude double precision, p_claim_number text, p_brief_note text, p_facts jsonb, p_scope jsonb, p_invitees jsonb) to service_role;

revoke all on function public.repair_crm_audit_triggers() from public, anon, authenticated, service_role; grant execute on function public.repair_crm_audit_triggers() to service_role;

revoke all on function public.ensure_crm_audit_log() from public, anon, authenticated, service_role; grant execute on function public.ensure_crm_audit_log() to service_role;

revoke all on function public.claim_video_processing_job(p_owner text, p_lease_seconds integer, p_id uuid) from public, anon, authenticated, service_role; grant execute on function public.claim_video_processing_job(p_owner text, p_lease_seconds integer, p_id uuid) to service_role;

revoke all on function public.claim_job_proof_work(p_kind text, p_owner text, p_lease_seconds integer, p_id uuid) from public, anon, authenticated, service_role; grant execute on function public.claim_job_proof_work(p_kind text, p_owner text, p_lease_seconds integer, p_id uuid) to service_role;

revoke all on function private.is_field_capture_seat(p_role text, p_email text, p_usage_intents text[]) from public, anon, authenticated, service_role; grant execute on function private.is_field_capture_seat(p_role text, p_email text, p_usage_intents text[]) to public;

revoke all on function private.field_capture_seats_allowed(p_org uuid) from public, anon, authenticated, service_role; grant execute on function private.field_capture_seats_allowed(p_org uuid) to public;

revoke all on function private.field_capture_seats_used(p_org uuid, p_exclude_user uuid, p_exclude_invite uuid) from public, anon, authenticated, service_role; grant execute on function private.field_capture_seats_used(p_org uuid, p_exclude_user uuid, p_exclude_invite uuid) to public;

revoke all on function private.enforce_field_capture_seat_limit() from public, anon, authenticated, service_role; grant execute on function private.enforce_field_capture_seat_limit() to public;

revoke all on function public.credit_balance(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.credit_balance(p_org uuid) to authenticated; grant execute on function public.credit_balance(p_org uuid) to service_role;

revoke all on function public.stripe_sync_subscription(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer, p_subscription_id text, p_status subscription_status, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_cancel_at_period_end boolean) from public, anon, authenticated, service_role; grant execute on function public.stripe_sync_subscription(p_org uuid, p_plan text, p_interval billing_interval, p_seats integer, p_subscription_id text, p_status subscription_status, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_cancel_at_period_end boolean) to service_role;

revoke all on function public.voiceprints_matchable(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.voiceprints_matchable(p_org uuid) to service_role;

revoke all on function private.speaker_job_clip_owned(p_org uuid, p_job uuid, p_proof uuid) from public, anon, authenticated, service_role; grant execute on function private.speaker_job_clip_owned(p_org uuid, p_job uuid, p_proof uuid) to authenticated; grant execute on function private.speaker_job_clip_owned(p_org uuid, p_job uuid, p_proof uuid) to service_role;

revoke all on function public.set_proof_room_segments(p_proof_id uuid, p_segments jsonb) from public, anon, authenticated, service_role; grant execute on function public.set_proof_room_segments(p_proof_id uuid, p_segments jsonb) to service_role;

revoke all on function public.proofs_awaiting_room_backfill(p_limit integer, p_job_id uuid, p_org_id uuid, p_after timestamp with time zone, p_after_id uuid) from public, anon, authenticated, service_role; grant execute on function public.proofs_awaiting_room_backfill(p_limit integer, p_job_id uuid, p_org_id uuid, p_after timestamp with time zone, p_after_id uuid) to service_role;

revoke all on function public.ai_credit_balance(p_org uuid) from public, anon, authenticated, service_role; grant execute on function public.ai_credit_balance(p_org uuid) to service_role;

revoke all on function public.ai_allowance_totals(p_org uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function public.ai_allowance_totals(p_org uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone) to service_role;

revoke all on function public.settle_ai_usage(p_org uuid, p_request_id text, p_cost_nanos bigint, p_allowance_nanos bigint, p_credit_nanos bigint, p_at timestamp with time zone, p_period_allowance_nanos bigint, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone, p_rolling_cap_nanos bigint, p_window_event_nanos bigint) from public, anon, authenticated, service_role; grant execute on function public.settle_ai_usage(p_org uuid, p_request_id text, p_cost_nanos bigint, p_allowance_nanos bigint, p_credit_nanos bigint, p_at timestamp with time zone, p_period_allowance_nanos bigint, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_window_start timestamp with time zone, p_rolling_cap_nanos bigint, p_window_event_nanos bigint) to service_role;

revoke all on function private.job_proofs_guard_budget_hold() from public, anon, authenticated, service_role; grant execute on function private.job_proofs_guard_budget_hold() to public;

revoke all on function public.record_subscription_price_span(p_org uuid, p_amount_cents integer, p_interval text, p_at timestamp with time zone, p_period_start timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function public.record_subscription_price_span(p_org uuid, p_amount_cents integer, p_interval text, p_at timestamp with time zone, p_period_start timestamp with time zone) to service_role;

revoke all on function public.apply_ai_credit_clawback(p_org uuid, p_event_id text, p_charge_id text, p_charge_amount_cents integer, p_granted_nanos bigint, p_amount_refunded_cents integer, p_dispute_amount_cents integer, p_dispute_standing text, p_dispute_id text, p_event_at timestamp with time zone, p_note text) from public, anon, authenticated, service_role; grant execute on function public.apply_ai_credit_clawback(p_org uuid, p_event_id text, p_charge_id text, p_charge_amount_cents integer, p_granted_nanos bigint, p_amount_refunded_cents integer, p_dispute_amount_cents integer, p_dispute_standing text, p_dispute_id text, p_event_at timestamp with time zone, p_note text) to service_role;

revoke all on function private.analytics_actor() from public, anon, authenticated, service_role;

revoke all on function public.record_capture_upload(p_org uuid, p_upload_key text, p_event text, p_job uuid, p_error_code text) from public, anon, authenticated, service_role; grant execute on function public.record_capture_upload(p_org uuid, p_upload_key text, p_event text, p_job uuid, p_error_code text) to service_role;

revoke all on function private.analytics_campaign_json(c analytics_campaigns) from public, anon, authenticated, service_role;

revoke all on function public.analytics_campaigns_list() from public, anon, authenticated, service_role; grant execute on function public.analytics_campaigns_list() to service_role;

revoke all on function public.analytics_campaign_get(p_id uuid) from public, anon, authenticated, service_role; grant execute on function public.analytics_campaign_get(p_id uuid) to service_role;

revoke all on function public.analytics_campaign_save(p_id uuid, p_name text, p_subject text, p_body text, p_audience jsonb) from public, anon, authenticated, service_role; grant execute on function public.analytics_campaign_save(p_id uuid, p_name text, p_subject text, p_body text, p_audience jsonb) to service_role;

revoke all on function public.analytics_campaign_delete(p_id uuid) from public, anon, authenticated, service_role; grant execute on function public.analytics_campaign_delete(p_id uuid) to service_role;

revoke all on function public.analytics_email_suppressed(p_emails text[]) from public, anon, authenticated, service_role; grant execute on function public.analytics_email_suppressed(p_emails text[]) to service_role;

revoke all on function public.analytics_campaign_begin_send(p_id uuid, p_emails text[]) from public, anon, authenticated, service_role; grant execute on function public.analytics_campaign_begin_send(p_id uuid, p_emails text[]) to service_role;

revoke all on function public.analytics_campaign_finish_send(p_id uuid, p_results jsonb) from public, anon, authenticated, service_role; grant execute on function public.analytics_campaign_finish_send(p_id uuid, p_results jsonb) to service_role;

revoke all on function public.record_token_usage(p_org uuid, p_request_id text, p_feature text, p_source text, p_user_id uuid, p_job_id uuid, p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_tokens bigint, p_price_nanos bigint, p_metadata jsonb, p_at timestamp with time zone, p_cost_nanos bigint, p_provider text, p_cache_read_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_provider_usage jsonb, p_pricing_status text) from public, anon, authenticated, service_role; grant execute on function public.record_token_usage(p_org uuid, p_request_id text, p_feature text, p_source text, p_user_id uuid, p_job_id uuid, p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_tokens bigint, p_price_nanos bigint, p_metadata jsonb, p_at timestamp with time zone, p_cost_nanos bigint, p_provider text, p_cache_read_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_provider_usage jsonb, p_pricing_status text) to authenticated; grant execute on function public.record_token_usage(p_org uuid, p_request_id text, p_feature text, p_source text, p_user_id uuid, p_job_id uuid, p_model_id text, p_input_tokens bigint, p_output_tokens bigint, p_cache_tokens bigint, p_price_nanos bigint, p_metadata jsonb, p_at timestamp with time zone, p_cost_nanos bigint, p_provider text, p_cache_read_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint, p_provider_usage jsonb, p_pricing_status text) to service_role;

revoke all on function public.claim_ai_auto_recharge(p_org uuid, p_cooldown_seconds integer, p_max_per_day integer, p_stale_seconds integer, p_trigger text) from public, anon, authenticated, service_role; grant execute on function public.claim_ai_auto_recharge(p_org uuid, p_cooldown_seconds integer, p_max_per_day integer, p_stale_seconds integer, p_trigger text) to service_role;

revoke all on function public.finish_ai_auto_recharge(p_recharge uuid, p_status text, p_payment_intent_id text, p_charge_id text, p_amount_cents integer, p_currency text, p_credit_nanos bigint, p_failure_code text, p_failure_message text) from public, anon, authenticated, service_role; grant execute on function public.finish_ai_auto_recharge(p_recharge uuid, p_status text, p_payment_intent_id text, p_charge_id text, p_amount_cents integer, p_currency text, p_credit_nanos bigint, p_failure_code text, p_failure_message text) to service_role;

revoke all on function private.calculate_metering_period_unchecked(p_org uuid, p_period_start date) from public, anon, authenticated, service_role;

revoke all on function private.customer_metering_summary_unchecked(p_org uuid) from public, anon, authenticated, service_role;

revoke all on function public.customer_metering_summary_for_member(p_org uuid, p_user uuid) from public, anon, authenticated, service_role; grant execute on function public.customer_metering_summary_for_member(p_org uuid, p_user uuid) to service_role;

revoke all on function public.computer_audit_events_append_only() from public, anon, authenticated, service_role; grant execute on function public.computer_audit_events_append_only() to service_role;

revoke all on function private.user_can_access_job(p_job_id uuid) from public, anon, authenticated, service_role; grant execute on function private.user_can_access_job(p_job_id uuid) to authenticated;

revoke all on function private.org_internal_reason(p_org uuid) from public, anon, authenticated, service_role;

revoke all on function private.analytics_in_scope(p_org uuid, p_include_internal boolean) from public, anon, authenticated, service_role;

revoke all on function private.atmosphere_catalog_mrr_cents(p_plan text, p_interval text, p_extra_seats integer) from public, anon, authenticated, service_role;

revoke all on function private.atmosphere_plan_name(p_plan text) from public, anon, authenticated, service_role;

revoke all on function private.org_mrr_cents(p_status subscription_status, p_subscription_id text, p_livemode boolean, p_stripe_mrr_cents integer, p_atmosphere_plan text, p_interval text, p_extra_seats integer, p_legacy_plan text, p_legacy_interval billing_interval, p_legacy_seats integer) from public, anon, authenticated, service_role;

revoke all on function private.org_billing_mrr_cents(b org_billing) from public, anon, authenticated, service_role;

revoke all on function private.org_billing_fc_seats(b org_billing) from public, anon, authenticated, service_role;

revoke all on function private.org_billing_label(b org_billing) from public, anon, authenticated, service_role;

revoke all on function private.ai_feature_catalog_key(p_feature text) from public, anon, authenticated, service_role;

revoke all on function private.org_last_active_at(p_org uuid) from public, anon, authenticated, service_role;

revoke all on function private.mrr_cents_at(p_at timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role;

revoke all on function private.paying_orgs_at(p_at timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role;

revoke all on function private.seats_at(p_at timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role;

revoke all on function private.churned_orgs_between(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role;

revoke all on function private.job_proofs_first_analysed() from public, anon, authenticated, service_role;

revoke all on function public.analytics_internal_orgs() from public, anon, authenticated, service_role; grant execute on function public.analytics_internal_orgs() to service_role;

revoke all on function public.analytics_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) to service_role;

revoke all on function public.analytics_monthly(p_months integer, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_monthly(p_months integer, p_include_internal boolean) to service_role;

revoke all on function public.analytics_features(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_features(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) to service_role;

revoke all on function public.analytics_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_include_internal boolean) to service_role;

revoke all on function public.analytics_account_detail(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function public.analytics_account_detail(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) to service_role;

revoke all on function public.analytics_plan_mix(p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_plan_mix(p_include_internal boolean) to service_role;

revoke all on function public.analytics_retention(p_months integer, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_retention(p_months integer, p_include_internal boolean) to service_role;

revoke all on function public.analytics_product_health(p_weeks integer, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.analytics_product_health(p_weeks integer, p_include_internal boolean) to service_role;

revoke all on function public.admin_token_usage_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.admin_token_usage_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) to service_role;

revoke all on function public.admin_metering_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) from public, anon, authenticated, service_role; grant execute on function public.admin_metering_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_include_internal boolean) to service_role;

revoke all on function private.job_dup_remap_jsonb(p jsonb) from public, anon, authenticated, service_role;

revoke all on function public.duplicate_job_file_contents(p_org_id uuid, p_source_job_id uuid, p_target_job_id uuid, p_actor_id uuid, p_actor_label text) from public, anon, authenticated, service_role; grant execute on function public.duplicate_job_file_contents(p_org_id uuid, p_source_job_id uuid, p_target_job_id uuid, p_actor_id uuid, p_actor_label text) to service_role;

revoke all on function private.has_job_progress_grant(p_job_id uuid) from public, anon, authenticated, service_role; grant execute on function private.has_job_progress_grant(p_job_id uuid) to authenticated;

revoke all on function private.revoke_job_progress_grants_on_share() from public, anon, authenticated, service_role;

grant usage on schema public to anon,authenticated,service_role;

grant usage on schema private to service_role;

grant usage on schema memory to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('job-proofs','job-proofs',false,85899345920,null) on conflict (id) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('avatars','avatars',true,2097152,'{image/jpeg,image/png,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon}'::text[]) on conflict (id) do nothing;
