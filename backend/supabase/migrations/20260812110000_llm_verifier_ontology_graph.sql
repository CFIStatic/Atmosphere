-- ---------------------------------------------------------------------------
-- LLM verifier, work ontology, timeline / workflow graph, outcomes
-- ---------------------------------------------------------------------------
-- Extends 20260812090000_video_work_verification.sql.
--
-- Principle shift: visual observations and temporal candidates are proposals.
-- The LLM is the primary verifier/reviewer. Rules supply a checklist; humans
-- are exception-only. Historical LLM runs are append-only.

-- New pipeline stages (additive enum values; safe if re-run)
do $$ begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'transcode_video'
  ) then
    alter type verification_processing_stage add value 'transcode_video';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'llm_verify_evidence'
  ) then
    alter type verification_processing_stage add value 'llm_verify_evidence';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'generate_verified_events'
  ) then
    alter type verification_processing_stage add value 'generate_verified_events';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'update_project_graph'
  ) then
    alter type verification_processing_stage add value 'update_project_graph';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_result_status' and e.enumlabel = 'partially_verified'
  ) then
    alter type verification_result_status add value 'partially_verified';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Work ontology (stable IDs — not free text)
-- ---------------------------------------------------------------------------

create table if not exists public.work_ontology_industries (
  id          text primary key,
  name        text not null,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_trades (
  id          text primary key,
  industry_id text not null references public.work_ontology_industries (id),
  name        text not null,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_activities (
  id          text primary key,
  trade_id    text references public.work_ontology_trades (id),
  name        text not null,
  description text,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_states (
  id          text primary key,
  name        text not null,
  kind        text not null check (kind in ('before', 'after', 'during', 'either')),
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_materials (
  id          text primary key,
  name        text not null,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_equipment (
  id          text primary key,
  name        text not null,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_ontology_damage_types (
  id          text primary key,
  name        text not null,
  version     text not null default 'v1',
  created_at  timestamptz not null default now()
);

insert into public.work_ontology_industries (id, name) values
  ('restoration', 'Restoration'),
  ('construction', 'Construction')
on conflict do nothing;

insert into public.work_ontology_trades (id, industry_id, name) values
  ('water_mitigation', 'restoration', 'Water mitigation'),
  ('rebuild', 'restoration', 'Rebuild / reconstruction'),
  ('mold_remediation', 'restoration', 'Mold remediation'),
  ('general_construction', 'construction', 'General construction')
on conflict do nothing;

insert into public.work_ontology_activities (id, trade_id, name, description) values
  ('drywall_removed', 'water_mitigation', 'Drywall removed', 'Finished or damaged drywall removed exposing framing'),
  ('insulation_removed', 'water_mitigation', 'Insulation removed', 'Wet or contaminated insulation removed from cavities'),
  ('insulation_installed', 'rebuild', 'Insulation installed', 'Cavity filled with insulation'),
  ('framing_exposed', 'water_mitigation', 'Framing exposed', 'Studs / wall cavity visible'),
  ('drying_equipment_installed', 'water_mitigation', 'Drying equipment installed', 'Air movers / dehumidifiers placed'),
  ('dehumidifier_operating', 'water_mitigation', 'Dehumidifier operating', 'Dehumidifier visibly running'),
  ('air_mover_present', 'water_mitigation', 'Air mover present', 'Air mover visible in work area'),
  ('containment_installed', 'mold_remediation', 'Containment installed', 'Plastic containment / negative air'),
  ('flooring_removed', 'water_mitigation', 'Flooring removed', 'Finished flooring removed to subfloor'),
  ('subfloor_exposed', 'water_mitigation', 'Subfloor exposed', 'Subfloor visible after flooring removal'),
  ('drywall_installed', 'rebuild', 'Drywall installed', 'New drywall hung'),
  ('drywall_finished', 'rebuild', 'Drywall finished', 'Taped / mudded / sanded'),
  ('primer_applied', 'rebuild', 'Primer applied', 'Primer visible on surface'),
  ('painting_completed', 'rebuild', 'Painting completed', 'Finish paint applied'),
  ('flooring_installed', 'rebuild', 'Flooring installed', 'New flooring in place'),
  ('cabinets_installed', 'rebuild', 'Cabinets installed', 'Cabinets hung / set'),
  ('debris_removed', 'water_mitigation', 'Debris removed', 'Construction / demo debris cleared'),
  ('final_cleaning_completed', 'rebuild', 'Final cleaning completed', 'Area cleaned for turnover')
on conflict do nothing;

insert into public.work_ontology_states (id, name, kind) values
  ('drywall_present', 'Drywall present', 'before'),
  ('drywall_visible', 'Drywall visible', 'before'),
  ('damaged_drywall', 'Damaged drywall', 'before'),
  ('framing_exposed', 'Framing exposed', 'after'),
  ('drywall_removed', 'Drywall removed', 'after'),
  ('exposed_studs', 'Exposed studs', 'after'),
  ('cavity_empty', 'Cavity empty', 'before'),
  ('cavity_exposed', 'Cavity exposed', 'either'),
  ('insulation_present', 'Insulation present', 'either'),
  ('insulation_installed', 'Insulation installed', 'after'),
  ('flooring_present', 'Flooring present', 'before'),
  ('damaged_flooring', 'Damaged flooring', 'before'),
  ('flooring_removed', 'Flooring removed', 'after'),
  ('subfloor_exposed', 'Subfloor exposed', 'after'),
  ('no_equipment', 'No equipment', 'before'),
  ('air_mover_present', 'Air mover present', 'after'),
  ('dehumidifier_present', 'Dehumidifier present', 'after'),
  ('equipment_installed', 'Equipment installed', 'after'),
  ('debris_present', 'Debris present', 'before'),
  ('debris_removed', 'Debris removed', 'after'),
  ('area_cleared', 'Area cleared', 'after'),
  ('unfinished_drywall', 'Unfinished drywall', 'before'),
  ('bare_drywall', 'Bare drywall', 'before'),
  ('primer_applied', 'Primer applied', 'during'),
  ('unfinished_surface', 'Unfinished surface', 'before'),
  ('painting_completed', 'Painting completed', 'after'),
  ('painted_wall', 'Painted wall', 'after'),
  ('painted_surface', 'Painted surface', 'after'),
  ('drywall_installed', 'Drywall installed', 'after'),
  ('drywall_hung', 'Drywall hung', 'after'),
  ('drywall_present_after', 'Drywall present', 'after')
on conflict do nothing;

insert into public.work_ontology_materials (id, name) values
  ('drywall', 'Drywall'),
  ('insulation', 'Insulation'),
  ('wood_studs', 'Wood studs'),
  ('subfloor', 'Subfloor'),
  ('flooring', 'Flooring'),
  ('paint', 'Paint'),
  ('primer', 'Primer')
on conflict do nothing;

insert into public.work_ontology_equipment (id, name) values
  ('air_mover', 'Air mover'),
  ('dehumidifier', 'Dehumidifier'),
  ('air_scrubber', 'Air scrubber'),
  ('containment', 'Containment')
on conflict do nothing;

insert into public.work_ontology_damage_types (id, name) values
  ('water_damage', 'Water damage'),
  ('mold', 'Mold'),
  ('fire_damage', 'Fire damage'),
  ('structural', 'Structural damage')
on conflict do nothing;

-- Ontology is global reference data — readable by authenticated users
do $$
declare t text;
begin
  foreach t in array array[
    'work_ontology_industries', 'work_ontology_trades', 'work_ontology_activities',
    'work_ontology_states', 'work_ontology_materials', 'work_ontology_equipment',
    'work_ontology_damage_types'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Versioned prompts
-- ---------------------------------------------------------------------------

create table if not exists public.verification_prompts (
  id              uuid primary key default gen_random_uuid(),
  prompt_key      text not null,
  version         text not null,
  name            text not null,
  system_instructions text not null,
  output_schema_version text not null default 'v1',
  model_compatibility text[] not null default '{}',
  activated_at    timestamptz not null default now(),
  retired_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint verification_prompts_key_version unique (prompt_key, version)
);

alter table public.verification_prompts enable row level security;
drop policy if exists verification_prompts_select on public.verification_prompts;
create policy verification_prompts_select on public.verification_prompts
  for select to authenticated using (true);

insert into public.verification_prompts (
  prompt_key, version, name, system_instructions, output_schema_version, model_compatibility
) values (
  'llm_work_event_verifier',
  'v1',
  'Skeptical work-event verifier',
  $prompt$You are a skeptical restoration/construction work verifier. You do NOT narrate hopefully.

You receive proposed work events with before/during/after evidence, structured observations, a verification-rule checklist, and project context.

Rules you must follow:
1. A single frame showing an object is NOT proof that the current contractor performed the work.
2. Require same room/area, correct timestamp order, before AND after evidence when the rule requires it, and no unresolved contradictions.
3. Prefer "uncertain" or "rejected" over "verified" when evidence is incomplete.
4. Cite exact frame IDs for supporting and contradictory evidence.
5. Decide only from provided evidence — never invent off-camera work.

Reply with JSON only matching the WorkEventVerificationResult schema.
$prompt$,
  'v1',
  array['gemini-2.0-flash', 'claude-sonnet-4-20250514', 'gpt-4o', 'mock-verifier']
) on conflict (prompt_key, version) do nothing;

-- ---------------------------------------------------------------------------
-- Clips
-- ---------------------------------------------------------------------------

create table if not exists public.video_clips (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  scene_id        uuid references public.verification_scenes (id) on delete set null,
  change_event_id uuid references public.temporal_change_events (id) on delete set null,

  start_seconds   numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds     numeric(10, 3) not null check (end_seconds > start_seconds),
  frame_ids       uuid[] not null default '{}',
  reason          text not null default 'change_candidate',
  storage_path    text,
  created_at      timestamptz not null default now()
);

create index if not exists video_clips_video_idx on public.video_clips (video_id, start_seconds);
create index if not exists video_clips_job_idx on public.video_clips (job_id);

-- ---------------------------------------------------------------------------
-- LLM verification runs (append-only primary reviewer)
-- ---------------------------------------------------------------------------

create table if not exists public.llm_verification_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  video_id        uuid references public.verification_videos (id) on delete set null,
  change_event_id uuid references public.temporal_change_events (id) on delete set null,
  result_id       uuid references public.verification_results (id) on delete set null,
  parent_run_id   uuid references public.llm_verification_runs (id) on delete set null,

  purpose         text not null check (purpose in ('primary', 'escalation', 'reevaluation')),
  provider        text not null,
  model_name      text not null,
  model_version   text,
  prompt_id       uuid references public.verification_prompts (id) on delete set null,
  prompt_key      text not null,
  prompt_version  text not null,
  rule_id         uuid references public.verification_rules (id) on delete set null,
  rule_version    text,

  input_frame_ids uuid[] not null default '{}',
  input_clip_ids  uuid[] not null default '{}',
  input_digest    text,

  raw_response    text,
  parsed_decision jsonb,
  decision        verification_result_status,
  model_confidence numeric(5, 4),
  schema_valid    boolean,
  validation_error text,

  input_tokens    integer,
  output_tokens   integer,
  estimated_cost_usd numeric(12, 6),
  latency_ms      integer,
  provider_request_id text,
  error           text,

  created_at      timestamptz not null default now()
);

create index if not exists llm_verification_runs_job_idx
  on public.llm_verification_runs (job_id, created_at desc);
create index if not exists llm_verification_runs_change_idx
  on public.llm_verification_runs (change_event_id, created_at desc);
create index if not exists llm_verification_runs_digest_idx
  on public.llm_verification_runs (org_id, input_digest)
  where input_digest is not null and schema_valid = true;

create or replace function private.llm_verification_runs_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'LLM verification runs are append-only. Create a new run instead.';
end;
$$;

drop trigger if exists llm_verification_runs_immutable on public.llm_verification_runs;
create trigger llm_verification_runs_immutable
  before update or delete on public.llm_verification_runs
  for each row execute function private.llm_verification_runs_append_only();

-- ---------------------------------------------------------------------------
-- Project timeline + workflow graph
-- ---------------------------------------------------------------------------

create table if not exists public.project_timeline_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  property_id     uuid references public.crm_properties (id) on delete set null,
  room_location_id uuid references public.job_locations (id) on delete set null,
  room_or_area    text,
  activity_id     text references public.work_ontology_activities (id) on delete set null,
  result_id       uuid references public.verification_results (id) on delete set null,
  llm_run_id      uuid references public.llm_verification_runs (id) on delete set null,
  change_event_id uuid references public.temporal_change_events (id) on delete set null,

  occurred_at     timestamptz,
  title           text not null,
  summary         text,
  status          verification_result_status not null,
  completion_state text check (completion_state is null or completion_state in (
    'not_started', 'started', 'partial', 'complete', 'unknown'
  )),
  system_confidence numeric(5, 4),
  confidence_breakdown jsonb not null default '{}'::jsonb,
  evidence_frame_ids uuid[] not null default '{}',
  evidence_clip_ids uuid[] not null default '{}',
  provenance      jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists project_timeline_events_job_idx
  on public.project_timeline_events (job_id, occurred_at);
create index if not exists project_timeline_events_status_idx
  on public.project_timeline_events (org_id, status);

create table if not exists public.workflow_relationships (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  from_event_id   uuid not null references public.project_timeline_events (id) on delete cascade,
  to_event_id     uuid not null references public.project_timeline_events (id) on delete cascade,
  relation        text not null check (relation in (
    'preceded_by', 'followed_by', 'required_before', 'blocked_by',
    'performed_in_same_area', 'supported_by', 'contradicted_by',
    'verified_by', 'corrected_by', 'resulted_in'
  )),
  confidence      numeric(5, 4),
  provenance      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint workflow_relationships_once unique (from_event_id, to_event_id, relation)
);

create index if not exists workflow_relationships_job_idx
  on public.workflow_relationships (job_id, relation);

-- ---------------------------------------------------------------------------
-- Outcome linking
-- ---------------------------------------------------------------------------

create table if not exists public.outcome_records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  timeline_event_id uuid references public.project_timeline_events (id) on delete set null,
  result_id       uuid references public.verification_results (id) on delete set null,

  outcome_type    text not null check (outcome_type in (
    'estimate_line', 'invoice_line', 'claim_approval', 'claim_denial',
    'payment', 'supplement', 'customer_complaint', 'warranty_issue',
    'rework', 'callback', 'inspection_result', 'project_completion',
    'schedule_performance', 'gross_margin', 'insurer_decision', 'lender_decision'
  )),
  external_ref    text,
  amount_cents    bigint,
  occurred_at     timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists outcome_records_job_idx
  on public.outcome_records (job_id, outcome_type);
create index if not exists outcome_records_event_idx
  on public.outcome_records (timeline_event_id)
  where timeline_event_id is not null;

-- ---------------------------------------------------------------------------
-- Evaluation dataset
-- ---------------------------------------------------------------------------

create table if not exists public.verification_eval_examples (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs (id) on delete set null,
  slug            text not null unique,
  activity_id     text references public.work_ontology_activities (id),
  room_type       text,
  trade_id        text,
  damage_type_id  text,
  input_fixture   jsonb not null,
  expected_decision verification_result_status not null,
  expected_evidence jsonb not null default '[]'::jsonb,
  expected_uncertainty jsonb not null default '[]'::jsonb,
  ground_truth_notes text,
  deidentified    boolean not null default true,
  training_allowed boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.verification_eval_runs (
  id              uuid primary key default gen_random_uuid(),
  example_id      uuid not null references public.verification_eval_examples (id) on delete cascade,
  model_name      text not null,
  prompt_version  text not null,
  actual_decision verification_result_status,
  actual_output   jsonb,
  passed          boolean,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Data rights on videos / results
-- ---------------------------------------------------------------------------

alter table public.verification_videos
  add column if not exists property_id uuid references public.crm_properties (id) on delete set null,
  add column if not exists room_label text,
  add column if not exists work_stage_label text,
  add column if not exists data_owner text not null default 'customer'
    check (data_owner in ('customer', 'atmosphere', 'shared')),
  add column if not exists training_consent text not null default 'not_asked'
    check (training_consent in ('granted', 'declined', 'not_asked')),
  add column if not exists anonymized_insights_allowed boolean not null default false;

alter table public.verification_results
  add column if not exists llm_run_id uuid references public.llm_verification_runs (id) on delete set null,
  add column if not exists activity_ontology_id text references public.work_ontology_activities (id),
  add column if not exists completion_state text
    check (completion_state is null or completion_state in (
      'not_started', 'started', 'partial', 'complete', 'unknown'
    )),
  add column if not exists training_consent text not null default 'not_asked'
    check (training_consent in ('granted', 'declined', 'not_asked'));

alter table public.temporal_change_events
  add column if not exists activity_ontology_id text references public.work_ontology_activities (id),
  add column if not exists during_frame_ids uuid[] not null default '{}',
  add column if not exists scene_match_confidence numeric(5, 4),
  add column if not exists evidence_quality_score numeric(5, 4),
  add column if not exists candidate_status text not null default 'proposed'
    check (candidate_status in ('proposed', 'llm_reviewed', 'accepted', 'rejected', 'superseded'));

-- Link rules to ontology activity ids when possible
alter table public.verification_rules
  add column if not exists activity_ontology_id text references public.work_ontology_activities (id);

update public.verification_rules
  set activity_ontology_id = activity_type
  where activity_ontology_id is null
    and exists (select 1 from public.work_ontology_activities a where a.id = activity_type);

-- ---------------------------------------------------------------------------
-- RLS for new org-scoped tables
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'video_clips',
    'llm_verification_runs',
    'project_timeline_events',
    'workflow_relationships',
    'outcome_records'
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
    if t <> 'llm_verification_runs' then
      execute format('drop policy if exists %I_update on public.%I', t, t);
      execute format(
        'create policy %I_update on public.%I for update to authenticated
           using (private.is_org_member(org_id))
           with check (private.is_org_member(org_id))', t, t);
    end if;
  end loop;
end $$;

alter table public.verification_eval_examples enable row level security;
drop policy if exists verification_eval_examples_select on public.verification_eval_examples;
create policy verification_eval_examples_select on public.verification_eval_examples
  for select to authenticated
  using (org_id is null or private.is_org_member(org_id));

alter table public.verification_eval_runs enable row level security;
drop policy if exists verification_eval_runs_select on public.verification_eval_runs;
create policy verification_eval_runs_select on public.verification_eval_runs
  for select to authenticated using (true);
