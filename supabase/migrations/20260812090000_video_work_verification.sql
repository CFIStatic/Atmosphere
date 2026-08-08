-- ---------------------------------------------------------------------------
-- Video work verification pipeline
-- ---------------------------------------------------------------------------
-- Extends the existing proof-of-work media layer (job_proofs / job_proof_frames)
-- with a durable, multi-stage verification pipeline: server-side frame
-- extraction, quality filtering, scene grouping, AI observations, temporal
-- comparison, rules-based verification, confidence scoring, and human review.
--
-- Design commitments:
--
--   job_proofs remains the source-of-truth video record and payment gate.
--   verification_videos references a proof when one exists, so the payment
--   path and the analysis path stay linked without duplicating bytes.
--
--   Model output is never the verdict. Observations come from AI; verification
--   status comes from the rules engine (and optionally a human). Both are
--   stored separately and neither overwrites the other.
--
--   Audit and review decisions are append-only. Historical reports stay
--   reproducible because rule versions, prompt versions, and raw model output
--   are retained.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type verification_video_status as enum (
    'uploaded',
    'queued',
    'processing',
    'completed',
    'failed',
    'needs_review',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_processing_stage as enum (
    'validate_video',
    'extract_metadata',
    'extract_frames',
    'score_frame_quality',
    'deduplicate_frames',
    'classify_scenes',
    'analyze_frames',
    'compare_timeline',
    'generate_verifications',
    'calculate_confidence',
    'finalize_report'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_step_status as enum (
    'pending',
    'running',
    'completed',
    'failed',
    'skipped',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_result_status as enum (
    'verified',
    'likely_verified',
    'uncertain',
    'contradicted',
    'rejected',
    'human_verified',
    'needs_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type human_review_status as enum (
    'open',
    'in_progress',
    'approved',
    'rejected',
    'edited',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Videos (pipeline-facing wrapper around proof media)
-- ---------------------------------------------------------------------------

create table if not exists public.verification_videos (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  -- Optional link to the payment-gate proof row. Null for org-initiated
  -- uploads that are not part of a before/after sub day.
  proof_id        uuid references public.job_proofs (id) on delete set null,
  party_id        uuid references public.job_parties (id) on delete set null,
  uploader_id     uuid references public.profiles (id) on delete set null,

  file_name       text not null check (length(btrim(file_name)) between 1 and 260),
  file_size       bigint check (file_size is null or file_size > 0),
  mime_type       text not null default 'video/mp4'
                    check (mime_type in (
                      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'
                    )),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  capture_date    timestamptz,
  upload_date     timestamptz not null default now(),
  device_metadata jsonb not null default '{}'::jsonb,
  latitude        double precision check (latitude is null or (latitude between -90 and 90)),
  longitude       double precision check (longitude is null or (longitude between -180 and 180)),

  storage_path    text not null,
  content_hash    text,
  thumbnail_path  text,

  status          verification_video_status not null default 'uploaded',
  status_detail   text,
  processing_error text,

  -- Retention: null means inherit org policy; explicit date wins.
  retain_until    timestamptz,
  deleted_at      timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint verification_videos_proof_unique unique (proof_id)
);

create index if not exists verification_videos_org_idx
  on public.verification_videos (org_id, created_at desc);
create index if not exists verification_videos_job_idx
  on public.verification_videos (job_id, created_at desc);
create index if not exists verification_videos_status_idx
  on public.verification_videos (org_id, status, created_at desc);
create index if not exists verification_videos_hash_idx
  on public.verification_videos (org_id, content_hash)
  where content_hash is not null;

comment on table public.verification_videos is
  'Pipeline-facing video records. Prefer linking to job_proofs so custody and '
  'payment gates stay on the existing proof row; this table tracks analysis.';

-- ---------------------------------------------------------------------------
-- Processing jobs and steps (durable, idempotent pipeline)
-- ---------------------------------------------------------------------------

create table if not exists public.video_processing_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,

  -- Idempotency key: re-queueing the same video+pipeline version is a no-op.
  idempotency_key text not null,
  pipeline_version text not null default 'v1',

  status          verification_step_status not null default 'pending',
  current_stage   verification_processing_stage,
  attempt_count   integer not null default 0 check (attempt_count >= 0),
  max_attempts    integer not null default 3 check (max_attempts >= 1),

  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  cancelled_at    timestamptz,
  cancel_reason   text,

  config          jsonb not null default '{}'::jsonb,
  result_summary  jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint video_processing_jobs_idempotent unique (org_id, idempotency_key)
);

create index if not exists video_processing_jobs_video_idx
  on public.video_processing_jobs (video_id, created_at desc);
create index if not exists video_processing_jobs_status_idx
  on public.video_processing_jobs (org_id, status, created_at desc)
  where status in ('pending', 'running', 'failed');

create table if not exists public.video_processing_steps (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  processing_job_id uuid not null references public.video_processing_jobs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,

  stage           verification_processing_stage not null,
  status          verification_step_status not null default 'pending',
  attempt_count   integer not null default 0 check (attempt_count >= 0),

  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  output_digest   text, -- hash of outputs for idempotent retries
  output          jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint video_processing_steps_once unique (processing_job_id, stage)
);

create index if not exists video_processing_steps_job_idx
  on public.video_processing_steps (processing_job_id, stage);
create index if not exists video_processing_steps_status_idx
  on public.video_processing_steps (org_id, status)
  where status in ('pending', 'running', 'failed');

-- ---------------------------------------------------------------------------
-- Scenes / room groups
-- ---------------------------------------------------------------------------

create table if not exists public.verification_scenes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  -- Prefer existing job_locations when the org has a floor plan / room tree.
  location_id     uuid references public.job_locations (id) on delete set null,

  sequence_index  integer not null check (sequence_index >= 0),
  room_type       text not null default 'unidentified'
                    check (length(btrim(room_type)) between 1 and 80),
  label           text check (label is null or length(label) <= 120),
  start_seconds   numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds     numeric(10, 3) not null check (end_seconds >= start_seconds),
  confidence      numeric(5, 4) check (confidence is null or (confidence between 0 and 1)),
  source          text not null default 'auto'
                    check (source in ('auto', 'user', 'floor_plan', 'gps', 'mixed')),
  user_corrected  boolean not null default false,
  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint verification_scenes_seq unique (video_id, sequence_index)
);

create index if not exists verification_scenes_video_idx
  on public.verification_scenes (video_id, sequence_index);
create index if not exists verification_scenes_job_room_idx
  on public.verification_scenes (job_id, room_type);

-- ---------------------------------------------------------------------------
-- Frames (quality-scored, analysis-selected)
-- ---------------------------------------------------------------------------

create table if not exists public.verification_frames (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  scene_id        uuid references public.verification_scenes (id) on delete set null,
  -- Optional bridge to device-extracted proof frames.
  proof_frame_id  uuid references public.job_proof_frames (id) on delete set null,

  timestamp_seconds numeric(10, 3) not null check (timestamp_seconds >= 0),
  sequence_number integer not null check (sequence_number >= 0),
  storage_path    text not null,
  width           integer check (width is null or width > 0),
  height          integer check (height is null or height > 0),

  quality_score   numeric(5, 4) check (quality_score is null or (quality_score between 0 and 1)),
  blur_score      numeric(5, 4) check (blur_score is null or (blur_score between 0 and 1)),
  brightness_score numeric(5, 4) check (brightness_score is null or (brightness_score between 0 and 1)),
  motion_score    numeric(5, 4) check (motion_score is null or (motion_score between 0 and 1)),

  is_duplicate    boolean not null default false,
  duplicate_of    uuid references public.verification_frames (id) on delete set null,
  selected_for_analysis boolean not null default false,
  rejection_reason text,

  perceptual_hash text,
  content_hash    text,

  created_at      timestamptz not null default now(),

  constraint verification_frames_seq unique (video_id, sequence_number),
  constraint verification_frames_ts unique (video_id, timestamp_seconds)
);

create index if not exists verification_frames_video_idx
  on public.verification_frames (video_id, timestamp_seconds);
create index if not exists verification_frames_selected_idx
  on public.verification_frames (video_id)
  where selected_for_analysis = true;
create index if not exists verification_frames_phash_idx
  on public.verification_frames (org_id, perceptual_hash)
  where perceptual_hash is not null;
create index if not exists verification_frames_scene_idx
  on public.verification_frames (scene_id)
  where scene_id is not null;

create table if not exists public.frame_embeddings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  frame_id        uuid not null references public.verification_frames (id) on delete cascade,
  model_name      text not null,
  model_version   text,
  dimensions      integer not null check (dimensions > 0),
  -- Stored as jsonb array of numbers for portability without pgvector dependency.
  embedding       jsonb not null,
  created_at      timestamptz not null default now(),

  constraint frame_embeddings_once unique (frame_id, model_name)
);

create index if not exists frame_embeddings_frame_idx
  on public.frame_embeddings (frame_id);

-- ---------------------------------------------------------------------------
-- AI analysis runs and frame observations
-- ---------------------------------------------------------------------------

create table if not exists public.ai_analysis_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  processing_job_id uuid references public.video_processing_jobs (id) on delete set null,

  purpose         text not null
                    check (purpose in (
                      'frame_analysis', 'sequence_analysis', 'comparison',
                      'escalation', 'cache_hit'
                    )),
  provider        text not null,
  model_name      text not null,
  model_version   text,
  prompt_version  text not null,

  input_frame_ids uuid[] not null default '{}',
  input_digest    text, -- hash(frame hashes + prompt version) for cache

  raw_response    text,
  parsed_response jsonb,
  schema_valid    boolean,
  validation_error text,

  input_tokens    integer check (input_tokens is null or input_tokens >= 0),
  output_tokens   integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  latency_ms      integer check (latency_ms is null or latency_ms >= 0),
  provider_request_id text,
  error           text,

  created_at      timestamptz not null default now()
);

create index if not exists ai_analysis_runs_video_idx
  on public.ai_analysis_runs (video_id, created_at desc);
create index if not exists ai_analysis_runs_cache_idx
  on public.ai_analysis_runs (org_id, input_digest)
  where input_digest is not null and schema_valid = true;
create index if not exists ai_analysis_runs_org_cost_idx
  on public.ai_analysis_runs (org_id, created_at desc);

create table if not exists public.frame_observations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  frame_id        uuid not null references public.verification_frames (id) on delete cascade,
  analysis_run_id uuid not null references public.ai_analysis_runs (id) on delete cascade,
  scene_id        uuid references public.verification_scenes (id) on delete set null,

  room_type       text,
  observed_conditions text[] not null default '{}',
  damage_types    text[] not null default '{}',
  work_activities text[] not null default '{}',
  materials_present text[] not null default '{}',
  equipment_present text[] not null default '{}',
  completion_indicators text[] not null default '{}',
  safety_issues   text[] not null default '{}',
  visible_text    text[] not null default '{}',
  uncertainty_reasons text[] not null default '{}',
  evidence_regions jsonb not null default '[]'::jsonb,

  model_confidence numeric(5, 4) check (model_confidence is null or (model_confidence between 0 and 1)),
  model_name      text not null,
  model_version   text,
  prompt_version  text not null,
  parsed          jsonb not null,

  created_at      timestamptz not null default now(),

  -- One observation row per frame per analysis run (escalations create new runs).
  constraint frame_observations_once unique (analysis_run_id, frame_id)
);

create index if not exists frame_observations_video_idx
  on public.frame_observations (video_id, created_at desc);
create index if not exists frame_observations_frame_idx
  on public.frame_observations (frame_id);
create index if not exists frame_observations_activities_idx
  on public.frame_observations using gin (work_activities);

-- ---------------------------------------------------------------------------
-- Temporal change events
-- ---------------------------------------------------------------------------

create table if not exists public.temporal_change_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  scene_id        uuid references public.verification_scenes (id) on delete set null,
  location_id     uuid references public.job_locations (id) on delete set null,
  room_or_area    text not null,

  before_frame_ids uuid[] not null default '{}',
  after_frame_ids  uuid[] not null default '{}',
  before_video_id uuid references public.verification_videos (id) on delete set null,
  after_video_id  uuid references public.verification_videos (id) on delete set null,

  before_state    text not null,
  after_state     text not null,
  inferred_activity text not null,
  first_observed_at timestamptz,
  last_observed_at  timestamptz,

  confidence      numeric(5, 4) check (confidence is null or (confidence between 0 and 1)),
  evidence        jsonb not null default '[]'::jsonb,
  conflicting_evidence jsonb not null default '[]'::jsonb,
  verification_status verification_result_status not null default 'uncertain',

  created_at      timestamptz not null default now()
);

create index if not exists temporal_change_events_job_idx
  on public.temporal_change_events (job_id, first_observed_at);
create index if not exists temporal_change_events_activity_idx
  on public.temporal_change_events (org_id, inferred_activity);
create index if not exists temporal_change_events_status_idx
  on public.temporal_change_events (job_id, verification_status);

-- ---------------------------------------------------------------------------
-- Verification rules (versioned)
-- ---------------------------------------------------------------------------

create table if not exists public.verification_rules (
  id              uuid primary key default gen_random_uuid(),
  -- Null org_id = global built-in rule; org-specific overrides set org_id.
  org_id          uuid references public.orgs (id) on delete cascade,

  activity_type   text not null,
  version         text not null,
  name            text not null,
  description     text,

  required_observations text[] not null default '{}',
  required_before_states text[] not null default '{}',
  required_after_states  text[] not null default '{}',
  min_supporting_frames integer not null default 2 check (min_supporting_frames >= 1),
  min_confidence  numeric(5, 4) not null default 0.70 check (min_confidence between 0 and 1),
  contradictory_observations text[] not null default '{}',
  allowed_room_types text[] not null default '{}',
  project_requirements jsonb not null default '{}'::jsonb,
  human_review_triggers text[] not null default '{}',

  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- NULLS DISTINCT would allow duplicate global rules; coalesce keeps one version.
create unique index if not exists verification_rules_version_uidx
  on public.verification_rules (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), activity_type, version);

create index if not exists verification_rules_activity_idx
  on public.verification_rules (activity_type, is_active);

-- ---------------------------------------------------------------------------
-- Verification results + evidence
-- ---------------------------------------------------------------------------

create table if not exists public.verification_results (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  video_id        uuid references public.verification_videos (id) on delete set null,
  change_event_id uuid references public.temporal_change_events (id) on delete set null,
  rule_id         uuid references public.verification_rules (id) on delete set null,
  rule_version    text,

  activity_type   text not null,
  room_or_area    text,
  title           text not null,
  summary         text,

  status          verification_result_status not null default 'uncertain',
  model_confidence numeric(5, 4) check (model_confidence is null or (model_confidence between 0 and 1)),
  system_confidence numeric(5, 4) check (system_confidence is null or (system_confidence between 0 and 1)),
  confidence_breakdown jsonb not null default '{}'::jsonb,

  observed_at     timestamptz,
  first_evidence_at timestamptz,
  last_evidence_at  timestamptz,

  -- Immutable AI/rules snapshot; human edits create new rows or review decisions.
  ai_observation  jsonb,
  rules_result    jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists verification_results_job_idx
  on public.verification_results (job_id, observed_at);
create index if not exists verification_results_status_idx
  on public.verification_results (org_id, status, created_at desc);
create index if not exists verification_results_video_idx
  on public.verification_results (video_id)
  where video_id is not null;

create table if not exists public.verification_evidence (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  result_id       uuid not null references public.verification_results (id) on delete cascade,
  frame_id        uuid references public.verification_frames (id) on delete set null,
  video_id        uuid references public.verification_videos (id) on delete set null,
  analysis_run_id uuid references public.ai_analysis_runs (id) on delete set null,

  role            text not null default 'supporting'
                    check (role in ('supporting', 'contradicting', 'before', 'after', 'context')),
  video_timestamp_seconds numeric(10, 3),
  image_hash      text,
  note            text,
  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists verification_evidence_result_idx
  on public.verification_evidence (result_id);
create index if not exists verification_evidence_frame_idx
  on public.verification_evidence (frame_id)
  where frame_id is not null;

-- ---------------------------------------------------------------------------
-- Human review
-- ---------------------------------------------------------------------------

create table if not exists public.human_review_tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  result_id       uuid references public.verification_results (id) on delete set null,
  video_id        uuid references public.verification_videos (id) on delete set null,
  change_event_id uuid references public.temporal_change_events (id) on delete set null,

  reason          text not null,
  priority        text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'critical')),
  status          human_review_status not null default 'open',
  assigned_to     uuid references public.profiles (id) on delete set null,

  context         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists human_review_tasks_org_status_idx
  on public.human_review_tasks (org_id, status, priority, created_at desc);
create index if not exists human_review_tasks_job_idx
  on public.human_review_tasks (job_id, status);

create table if not exists public.human_review_decisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  task_id         uuid not null references public.human_review_tasks (id) on delete cascade,
  result_id       uuid references public.verification_results (id) on delete set null,

  reviewer_id     uuid not null references public.profiles (id) on delete restrict,
  decision        text not null
                    check (decision in (
                      'approve', 'reject', 'edit_activity', 'adjust_room',
                      'add_evidence', 'request_reanalysis', 'comment'
                    )),
  edited_activity text,
  adjusted_room   text,
  additional_frame_ids uuid[] not null default '{}',
  comment         text check (comment is null or length(comment) <= 4000),
  reason          text,
  final_status    verification_result_status,

  created_at      timestamptz not null default now()
);

create index if not exists human_review_decisions_task_idx
  on public.human_review_decisions (task_id, created_at);

-- Decisions are a permanent record of what a person decided. Editing them
-- afterwards is how "you signed off" becomes unanswerable.
create or replace function private.human_review_decisions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Human review decisions are append-only. Record a new decision instead.';
end;
$$;

drop trigger if exists human_review_decisions_immutable on public.human_review_decisions;
create trigger human_review_decisions_immutable
  before update or delete on public.human_review_decisions
  for each row execute function private.human_review_decisions_append_only();

-- ---------------------------------------------------------------------------
-- Audit events (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.verification_audit_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid references public.crm_jobs (id) on delete set null,
  video_id        uuid references public.verification_videos (id) on delete set null,
  result_id       uuid references public.verification_results (id) on delete set null,
  actor_id        uuid references public.profiles (id) on delete set null,

  event_type      text not null,
  entity_type     text not null,
  entity_id       uuid,
  payload         jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists verification_audit_events_org_idx
  on public.verification_audit_events (org_id, created_at desc);
create index if not exists verification_audit_events_video_idx
  on public.verification_audit_events (video_id, created_at)
  where video_id is not null;
create index if not exists verification_audit_events_result_idx
  on public.verification_audit_events (result_id, created_at)
  where result_id is not null;

create or replace function private.verification_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Verification audit events are append-only.';
end;
$$;

drop trigger if exists verification_audit_immutable on public.verification_audit_events;
create trigger verification_audit_immutable
  before update or delete on public.verification_audit_events
  for each row execute function private.verification_audit_append_only();

-- ---------------------------------------------------------------------------
-- AI cost tracking / usage limits
-- ---------------------------------------------------------------------------

create table if not exists public.verification_ai_costs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid references public.verification_videos (id) on delete set null,
  job_id          uuid references public.crm_jobs (id) on delete set null,
  analysis_run_id uuid references public.ai_analysis_runs (id) on delete set null,

  provider        text not null,
  model_name      text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  period_month    date not null, -- first day of month for rollups

  created_at      timestamptz not null default now()
);

create index if not exists verification_ai_costs_org_month_idx
  on public.verification_ai_costs (org_id, period_month);
create index if not exists verification_ai_costs_video_idx
  on public.verification_ai_costs (video_id)
  where video_id is not null;

create table if not exists public.verification_usage_limits (
  org_id          uuid primary key references public.orgs (id) on delete cascade,
  monthly_budget_usd numeric(12, 2) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  monthly_video_limit integer check (monthly_video_limit is null or monthly_video_limit >= 0),
  max_frames_per_video integer not null default 120 check (max_frames_per_video between 1 and 2000),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seed built-in verification rules (global, org_id null)
-- ---------------------------------------------------------------------------

insert into public.verification_rules (
  org_id, activity_type, version, name, description,
  required_observations, required_before_states, required_after_states,
  min_supporting_frames, min_confidence, contradictory_observations,
  allowed_room_types, human_review_triggers
) values
  (null, 'drywall_removed', 'v1', 'Drywall removal',
   'Requires earlier drywall visibility and later exposed studs in the same area.',
   array['drywall_visible','exposed_studs'],
   array['drywall_present'],
   array['framing_exposed','drywall_removed'],
   2, 0.75,
   array['drywall_intact_later'],
   array[]::text[],
   array['missing_before','missing_after','low_confidence','contradiction']),
  (null, 'insulation_installed', 'v1', 'Insulation installation',
   'Requires exposed cavity earlier and insulation visible later.',
   array['cavity_exposed','insulation_present'],
   array['framing_exposed','cavity_empty'],
   array['insulation_installed','insulation_present'],
   2, 0.70,
   array['cavity_still_empty'],
   array[]::text[],
   array['missing_before','low_confidence']),
  (null, 'drywall_installed', 'v1', 'Drywall installation',
   'Requires open framing earlier and hung drywall later.',
   array['framing_exposed','drywall_hung'],
   array['framing_exposed','insulation_present'],
   array['drywall_installed','drywall_present'],
   2, 0.75,
   array['framing_still_exposed'],
   array[]::text[],
   array['missing_before','contradiction']),
  (null, 'drying_equipment_installed', 'v1', 'Drying equipment present',
   'Air movers or dehumidifiers appear where none were present earlier.',
   array['air_mover_present','dehumidifier_present'],
   array['no_equipment'],
   array['equipment_installed','air_mover_present','dehumidifier_operating'],
   2, 0.65,
   array[]::text[],
   array[]::text[],
   array['safety_issue','high_value_claim']),
  (null, 'flooring_removed', 'v1', 'Flooring removal',
   'Damaged or finished flooring earlier; subfloor exposed later.',
   array['flooring_present','subfloor_exposed'],
   array['flooring_present','damaged_flooring'],
   array['flooring_removed','subfloor_exposed'],
   2, 0.75,
   array['flooring_intact_later'],
   array[]::text[],
   array['missing_before','contradiction']),
  (null, 'debris_removed', 'v1', 'Debris removal',
   'Debris visible earlier and cleared later in the same area.',
   array['debris_present','area_cleared'],
   array['debris_present'],
   array['debris_removed','area_cleared'],
   2, 0.65,
   array['debris_still_present'],
   array[]::text[],
   array['low_confidence']),
  (null, 'painting_completed', 'v1', 'Painting completed',
   'Unfinished or primed surface earlier; painted finish later.',
   array['unfinished_surface','painted_surface'],
   array['primer_applied','unfinished_drywall','bare_drywall'],
   array['painting_completed','painted_wall'],
   2, 0.70,
   array['still_unfinished'],
   array[]::text[],
   array['low_confidence','missing_before'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'verification_videos',
    'video_processing_jobs',
    'video_processing_steps',
    'verification_scenes',
    'verification_results',
    'human_review_tasks'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function private.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'verification_videos',
    'video_processing_jobs',
    'video_processing_steps',
    'verification_scenes',
    'verification_frames',
    'frame_embeddings',
    'ai_analysis_runs',
    'frame_observations',
    'temporal_change_events',
    'verification_results',
    'verification_evidence',
    'human_review_tasks',
    'human_review_decisions',
    'verification_audit_events',
    'verification_ai_costs',
    'verification_usage_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t, t);

    if t not in ('human_review_decisions', 'verification_audit_events', 'ai_analysis_runs', 'verification_ai_costs') then
      execute format('drop policy if exists %I_update on public.%I', t, t);
      execute format(
        'create policy %I_update on public.%I for update to authenticated
           using (private.is_org_member(org_id))
           with check (private.is_org_member(org_id))', t, t);
    end if;
  end loop;

  -- Global rules (org_id null) are readable by any authenticated member;
  -- org-specific rules stay tenancy-scoped.
  execute 'alter table public.verification_rules enable row level security';
  execute 'drop policy if exists verification_rules_select on public.verification_rules';
  execute
    'create policy verification_rules_select on public.verification_rules for select to authenticated
       using (org_id is null or private.is_org_member(org_id))';
  execute 'drop policy if exists verification_rules_insert on public.verification_rules';
  execute
    'create policy verification_rules_insert on public.verification_rules for insert to authenticated
       with check (org_id is not null and private.is_org_member(org_id))';
  execute 'drop policy if exists verification_rules_update on public.verification_rules';
  execute
    'create policy verification_rules_update on public.verification_rules for update to authenticated
       using (org_id is not null and private.is_org_member(org_id))
       with check (org_id is not null and private.is_org_member(org_id))';
end $$;
