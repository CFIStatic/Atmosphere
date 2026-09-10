# Schema simplification (Work Verification + Field Capture)

**Date:** 2026-09-10  
**Goal:** Make Supabase Schema Visualizer readable for the sold path only.

## Kept domains (public)

| Domain | Examples |
| --- | --- |
| Tenancy | `orgs`, `org_members`, `org_invites`, `profiles` |
| Job file | `crm_jobs`, `crm_properties`, `crm_audit_log`, `crm_counters`, `job_*` |
| Field Capture | `field_*`, `device_credentials` |
| Evidence / shares | `evidence_*`, `verifier_shares`, `media_*` |
| Billing | `billing_plans`, `org_billing`, `org_metering`, `metering_*`, `payments`, `token_usage_events`, `terms_acceptances` |
| Pipeline | `verification_*`, `video_processing_*`, `video_clips`, `work_episodes`, `episode_*`, `ai_analysis_runs`, `human_review_*`, `llm_verification_runs`, `temporal_change_events`, `frame_observations` |
| Support | analytics / legal / memory tables still needed in prod; `private.*` cost/metering |

## Dropped (this PR)

Idempotent `DROP … IF EXISTS` matching live project `ccxatzfsvzetciiwsjlj`:

- Archive batch of 14 dead tables (public and/or `archive.*` when schema exists)
- Experiments, agent audit ledger, dataset/ontology, `homeowner_portal_*`, all `pm_*`
- Crew/geometry/twins/zip, legacy `credit_*`
- Views `crew_live_positions`, `crm_job_delivery`
- Legacy `usage_events` / `usage_daily` / `model_rate_card` (token metering remains)

Billing RPCs that touched the credit wallet were rewritten or stubbed (`credit_balance` zeros; `record_usage` no longer writes the dropped ledger).

## App surface

Unmounted non-sold-path routers: `/api/portal`, `/api/geometry`, `/api/audit`.  
Credit purchase HTTP endpoints return **410**. Experiment telemetry returns **410**.

## Follow-up (not this PR)

Dual migration trees (`supabase/migrations` ↔ `backend/supabase/migrations`) stay mirrored byte-for-byte. **Full dual-tree unification** (single canonical directory) is deferred — too large for this cleanup PR.
