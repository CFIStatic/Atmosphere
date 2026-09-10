-- Atmosphere schema visualizer cleanup — move dead/legacy tables to archive.
-- Idempotent: ALTER TABLE IF EXISTS no-ops when already moved (live project
-- ccxatzfsvzetciiwsjlj already has these in archive).
-- No DROP. Does not touch credit_*/experiments*/agent_runs*/dataset_*/
-- work_ontology_*/pm_*/homeowner_portal_*/crew_*/geometry/twins/zip.
-- Requires schemas from 20260910165509_schema_visualizer_archive_schemas.sql.

alter table if exists public.eligibility_decisions set schema archive;
alter table if exists public.estimator_jobs set schema archive;
alter table if exists public.export_jobs set schema archive;
alter table if exists public.export_manifests set schema archive;
alter table if exists public.frame_embeddings set schema archive;
alter table if exists public.outcome_records set schema archive;
alter table if exists public.privacy_findings set schema archive;
alter table if exists public.project_timeline_events set schema archive;
alter table if exists public.provenance_records set schema archive;
alter table if exists public.rights_manifests set schema archive;
alter table if exists public.verification_eval_examples set schema archive;
alter table if exists public.verification_eval_runs set schema archive;
alter table if exists public.verification_prompts set schema archive;
alter table if exists public.workflow_relationships set schema archive;
