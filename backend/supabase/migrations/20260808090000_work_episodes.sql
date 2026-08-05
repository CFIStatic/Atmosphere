-- ---------------------------------------------------------------------------
-- Work episodes
-- ---------------------------------------------------------------------------
-- The atomic unit stops being "a video" and becomes an episode of work that
-- answers ten questions: what was supposed to be done, where, what condition
-- existed first, who did it, what steps they took, with what tools and
-- materials, what physically changed, whether it passed, whether it later
-- failed, and what it cost.
--
-- Media is not the record. Media is *evidence attached to* the record. That
-- inversion is the whole point of this migration: a pile of photos is
-- unqueryable and unsellable, while an episode with a task classification, a
-- location, an action sequence and a ground-truth result is both.
--
-- Nothing here replaces what already works. job_proofs remains the media and
-- verification layer; an episode references proofs as observations. The
-- shipped before/after flow keeps working and starts producing episodes.
--
-- Two design commitments worth stating up front:
--
--   Ground truth is a separate table from AI conclusions. A dataset that
--   cannot distinguish "the model said it looks done" from "the inspector
--   passed it" teaches activity, not quality.
--
--   Rights are recorded per episode, from the first row. Footage of a person
--   working cannot be licensed later on the strength of a policy nobody
--   captured at the time. `data_rights` defaults to the narrowest setting and
--   is widened only by an explicit act.

-- ---------------------------------------------------------------------------
-- Where work happens
-- ---------------------------------------------------------------------------
-- A job id is too coarse to be useful: "the drywall failed" means nothing
-- without which wall. This is a self-referencing tree — building, floor, room,
-- surface, assembly — so an observation attaches to the finest place known and
-- still rolls up.

do $$ begin
  create type work_location_kind as enum (
    'site', 'building', 'floor', 'zone', 'room', 'surface', 'assembly'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.job_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  parent_id   uuid references public.job_locations (id) on delete cascade,

  kind        work_location_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 120),
  -- e.g. 'north', 'ceiling', 'wall-2'. Free text because buildings are.
  detail      text check (detail is null or length(detail) <= 200),

  -- The external model's identity for this element, when one exists. Named
  -- generically: this will be an IFC GUID for some customers and a Matterport
  -- or DocuSketch element id for others, and the column should not have to
  -- change when it does.
  model_element_id text,
  model_source     text check (model_source is null or length(model_source) <= 40),

  created_at  timestamptz not null default now()
);

create index if not exists job_locations_job_idx on public.job_locations (job_id, kind);
create index if not exists job_locations_parent_idx on public.job_locations (parent_id);

-- A location cannot contain itself, however the rows were written. Same guard
-- as the account hierarchy, and for the same reason: a cycle here makes every
-- roll-up query hang rather than fail.
create or replace function private.job_location_no_cycle()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists job_locations_acyclic on public.job_locations;
create trigger job_locations_acyclic
  before insert or update of parent_id on public.job_locations
  for each row execute function private.job_location_no_cycle();

alter table public.job_locations enable row level security;

drop policy if exists job_locations_all on public.job_locations;
create policy job_locations_all on public.job_locations
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- The episode
-- ---------------------------------------------------------------------------

do $$ begin
  create type work_episode_status as enum (
    'planned',      -- intent recorded, nothing observed
    'in_progress',  -- at least one observation, no completion claim
    'complete',
    'partial',
    'complete_with_exception',
    'failed',
    'unverifiable',        -- observed, but the evidence cannot settle it
    'needs_human_review'
  );
exception when duplicate_object then null; end $$;

-- Who may use this episode beyond running the job it belongs to. Narrowest
-- first, and the default: an episode is job evidence until somebody with the
-- standing to say otherwise says otherwise.
do $$ begin
  create type work_data_rights as enum (
    'job_only',        -- this job, this contract, nothing else
    'org_analytics',   -- the org may learn from its own work
    'licensable'       -- may leave the org, subject to the consent below
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_consent_state as enum ('granted', 'declined', 'not_asked');
exception when duplicate_object then null; end $$;

create table if not exists public.work_episodes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,
  location_id   uuid references public.job_locations (id) on delete set null,

  -- 1. What was supposed to be done. Three independent sources of intent, all
  -- optional, because an episode with none of them is exactly the low-value
  -- case the tier engine should score down rather than reject.
  scope_item_id uuid references public.job_scope_items (id) on delete set null,
  estimate_id   uuid references public.estimator_estimates (id) on delete set null,
  -- The estimate line, by its id inside the payload. Not a foreign key because
  -- estimate lines live in jsonb; kept as text so the link survives anyway.
  estimate_line_id text,
  po_line_id    uuid references public.purchase_order_lines (id) on delete set null,
  intent_note   text check (intent_note is null or length(intent_note) <= 2000),

  -- The ontology classification. Text rather than a foreign key: the ontology
  -- is versioned code, not a table, so a task that is renamed in a later
  -- version must not silently rewrite what an old episode was classified as.
  trade         text,
  system        text,
  assembly      text,
  task_key      text,
  ontology_version text not null default 'v1',
  -- How the classification was arrived at. 'ai' labels are usable as weak
  -- supervision; 'human' labels are what a buyer pays for.
  task_label_source text not null default 'ai'
                      check (task_label_source in ('ai', 'human', 'rule')),

  -- 4. Who performed the work. Either a party on the job (a sub company) or a
  -- member of this org, and optionally the named person.
  party_id      uuid references public.job_parties (id) on delete set null,
  performer_id  uuid references public.profiles (id) on delete set null,
  performer_label text check (performer_label is null or length(performer_label) <= 160),
  -- 'human' today. The column exists because the point of the dataset is the
  -- day this is sometimes not a human, and a schema that cannot express that
  -- would have to be migrated exactly when it matters most.
  performer_kind text not null default 'human'
                   check (performer_kind in ('human', 'machine', 'mixed')),

  work_date     date not null,
  started_at    timestamptz,
  ended_at      timestamptz,
  constraint work_episode_time_order
    check (started_at is null or ended_at is null or ended_at >= started_at),

  status        work_episode_status not null default 'planned',

  -- 8/11. The completion claim, and who made it. Split deliberately: a claim
  -- made by a model and a claim made by an inspector are different facts, and
  -- the verifications table below is where the second kind lives.
  completion_note text check (completion_note is null or length(completion_note) <= 2000),

  -- Computed by tiers.ts and stored so the record shows what was known at the
  -- time. Recomputed on change; never hand-edited.
  tier          smallint not null default 1 check (tier between 1 and 5),
  confidence    jsonb not null default '{}'::jsonb,

  -- Rights. Consent is about the people visible in the media; data_rights is
  -- about what the org has agreed the episode may be used for. Both are needed
  -- and neither implies the other.
  worker_consent work_consent_state not null default 'not_asked',
  data_rights    work_data_rights not null default 'job_only',
  -- Widening rights is an act with a name attached to it.
  rights_set_by  uuid references public.profiles (id) on delete set null,
  rights_set_at  timestamptz,
  constraint work_episode_rights_attributed
    check (data_rights = 'job_only' or (rights_set_by is not null and rights_set_at is not null)),
  -- Licensing footage of a person who was never asked is not a thing this
  -- schema will hold a row for.
  constraint work_episode_licensable_needs_consent
    check (data_rights <> 'licensable' or worker_consent = 'granted'),

  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists work_episodes_job_idx
  on public.work_episodes (job_id, work_date desc);
create index if not exists work_episodes_task_idx
  on public.work_episodes (org_id, trade, task_key);
-- The query a dataset buyer's export runs.
create index if not exists work_episodes_tier_idx
  on public.work_episodes (org_id, tier desc, data_rights);

comment on table public.work_episodes is
  'The atomic unit of work: intent, place, performer, execution, result, and '
  'consequence. Media attaches to it as observations; it is not made of media.';

drop trigger if exists work_episodes_touch on public.work_episodes;
create trigger work_episodes_touch
  before update on public.work_episodes
  for each row execute function public.touch_updated_at();

alter table public.work_episodes enable row level security;

drop policy if exists work_episodes_all on public.work_episodes;
create policy work_episodes_all on public.work_episodes
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Observations — the states worth capturing
-- ---------------------------------------------------------------------------
-- Before and after are two of these, not the whole vocabulary. The expensive
-- defects are the concealed ones: fire-stopping before the wall closes,
-- waterproofing before tile, reinforcement before the pour. Those are
-- observations with a phase of their own, and once the next trade starts they
-- are unrecoverable at any price.

do $$ begin
  create type work_observation_phase as enum (
    'existing_condition',  -- before anyone touched it
    'in_progress',
    'pre_conceal',         -- the last moment this will ever be visible
    'complete',
    'verification',        -- a test or inspection being performed
    'failure',             -- something wrong, being documented
    'rework'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.episode_observations (
  id           uuid primary key default gen_random_uuid(),
  episode_id   uuid not null references public.work_episodes (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  location_id  uuid references public.job_locations (id) on delete set null,

  phase        work_observation_phase not null,

  -- The media, where it exists. A proof row already carries hash, GPS, capture
  -- time and the verifier's findings, so an observation does not duplicate any
  -- of it — it points at it.
  proof_id     uuid references public.job_proofs (id) on delete set null,
  evidence_kind text not null default 'video'
                  check (evidence_kind in
                    ('video', 'photo', 'audio', 'depth_scan', 'measurement',
                     'sensor', 'document', 'note')),

  -- Non-media observations: a moisture reading, a torque figure, a dimension.
  -- Structured rather than prose because the whole point is queryability.
  reading_name  text check (reading_name is null or length(reading_name) <= 80),
  reading_value numeric(14, 4),
  reading_unit  text check (reading_unit is null or length(reading_unit) <= 20),

  note         text check (note is null or length(note) <= 2000),
  observed_at  timestamptz not null default now(),
  recorded_by  uuid references public.profiles (id) on delete set null,

  created_at   timestamptz not null default now(),

  -- An observation that points at nothing and says nothing is not an
  -- observation.
  constraint episode_observation_has_substance
    check (proof_id is not null or reading_value is not null or note is not null)
);

create index if not exists episode_observations_episode_idx
  on public.episode_observations (episode_id, phase, observed_at);

alter table public.episode_observations enable row level security;

drop policy if exists episode_observations_all on public.episode_observations;
create policy episode_observations_all on public.episode_observations
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Actions — the step sequence
-- ---------------------------------------------------------------------------
-- One row per labelled action, from a controlled vocabulary (episodes/actions.ts).
-- Confidence and source travel with each row because a buyer training on this
-- needs to select the human-validated subset, and an episode is rarely
-- uniformly good — the model may be certain about "cut" and guessing at "flux".

create table if not exists public.episode_actions (
  id           uuid primary key default gen_random_uuid(),
  episode_id   uuid not null references public.work_episodes (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,

  sequence     integer not null,
  action       text not null check (length(btrim(action)) between 2 and 40),
  -- The thing acted upon, the tool, the material — as free text plus optional
  -- structured references, because a label is worth having before it resolves.
  object_label   text,
  tool_label     text,
  material_label text,
  po_line_id     uuid references public.purchase_order_lines (id) on delete set null,
  location_id    uuid references public.job_locations (id) on delete set null,

  started_at   timestamptz,
  ended_at     timestamptz,
  -- Offsets into the source video, when that is where the label came from.
  start_seconds numeric(10, 2),
  end_seconds   numeric(10, 2),
  proof_id      uuid references public.job_proofs (id) on delete set null,

  purpose      text check (purpose is null or length(purpose) <= 500),
  result       text check (result is null or length(result) <= 500),

  label_source text not null default 'ai' check (label_source in ('ai', 'human', 'tool')),
  confidence   numeric(4, 3) check (confidence is null or (confidence between 0 and 1)),
  -- Set when a person has actually looked at this label. Null is not "wrong",
  -- it is "unreviewed", and the tier engine treats them differently.
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,

  created_at   timestamptz not null default now(),

  unique (episode_id, sequence),
  constraint episode_action_time_order
    check (started_at is null or ended_at is null or ended_at >= started_at)
);

create index if not exists episode_actions_episode_idx
  on public.episode_actions (episode_id, sequence);

alter table public.episode_actions enable row level security;

drop policy if exists episode_actions_all on public.episode_actions;
create policy episode_actions_all on public.episode_actions
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Tools and materials actually used
-- ---------------------------------------------------------------------------
-- Separate from actions because the same action with a different material is a
-- different outcome, and because settings — torque, pressure, temperature —
-- are what make an episode reproducible by something that is not a person.

create table if not exists public.episode_resources (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,

  kind          text not null check (kind in ('tool', 'material')),
  name          text not null check (length(btrim(name)) between 1 and 200),
  manufacturer  text,
  model_or_sku  text,
  lot_number    text,

  quantity      numeric(12, 3),
  unit          text,

  -- Tool telemetry, when a tool reports any. Free-form on purpose: torque on a
  -- driver, pressure on a test pump, temperature on a torch — one column per
  -- possible instrument would be a schema that needs migrating per vendor.
  settings      jsonb not null default '{}'::jsonb,
  calibrated_at timestamptz,

  -- Where this came from: somebody typed it, the PO says so, or a tool told us.
  source        text not null default 'human'
                  check (source in ('human', 'ai', 'purchase_order', 'telemetry')),
  po_line_id    uuid references public.purchase_order_lines (id) on delete set null,

  created_at    timestamptz not null default now()
);

create index if not exists episode_resources_episode_idx
  on public.episode_resources (episode_id, kind);

alter table public.episode_resources enable row level security;

drop policy if exists episode_resources_all on public.episode_resources;
create policy episode_resources_all on public.episode_resources
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Ground truth
-- ---------------------------------------------------------------------------
-- The table that decides whether this dataset teaches quality or merely
-- activity. Deliberately not a column on the episode: there can be several
-- verdicts on one episode, they can disagree, and an inspector overruling a
-- model is the single most valuable row in the whole schema.

create table if not exists public.episode_verifications (
  id           uuid primary key default gen_random_uuid(),
  episode_id   uuid not null references public.work_episodes (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,

  kind         text not null check (kind in (
                 'ai_analysis', 'gc_acceptance', 'owner_acceptance',
                 'code_inspection', 'engineer_review', 'pressure_test',
                 'electrical_test', 'moisture_reading', 'thermal_scan',
                 'punch_list', 'third_party_test')),
  -- 'inconclusive' is a first-class answer. A verification that must resolve
  -- to pass or fail is a verification that will lie when it cannot tell.
  result       text not null check (result in ('pass', 'fail', 'inconclusive')),

  -- Who says so. An external inspector has no account here, so the name is
  -- text and the account link is optional.
  verifier_label text check (verifier_label is null or length(verifier_label) <= 200),
  verified_by    uuid references public.profiles (id) on delete set null,
  verified_at    timestamptz not null default now(),

  measurement_name  text,
  measurement_value numeric(14, 4),
  measurement_unit  text,
  tolerance_note    text check (tolerance_note is null or length(tolerance_note) <= 500),

  detail       text check (detail is null or length(detail) <= 2000),
  created_at   timestamptz not null default now()
);

create index if not exists episode_verifications_episode_idx
  on public.episode_verifications (episode_id, verified_at);

-- Ground truth is not editable. A record of what an inspector said, which can
-- later be adjusted, is not a record of what an inspector said.
create or replace function private.episode_verifications_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A verification result is a record of what someone found. Add a new one.';
end;
$$;

drop trigger if exists episode_verifications_immutable on public.episode_verifications;
create trigger episode_verifications_immutable
  before update or delete on public.episode_verifications
  for each row execute function private.episode_verifications_append_only();

alter table public.episode_verifications enable row level security;

drop policy if exists episode_verifications_select on public.episode_verifications;
create policy episode_verifications_select on public.episode_verifications
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists episode_verifications_insert on public.episode_verifications;
create policy episode_verifications_insert on public.episode_verifications
  for insert to authenticated with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- What happened afterwards
-- ---------------------------------------------------------------------------
-- The durability label, and the rarest thing in the schema. Work that passed
-- inspection and leaked in March is not a positive example, and a dataset that
-- cannot say so will confidently teach the mistake.
--
-- `no_failure_observed` is a row too: silence is not evidence of durability
-- unless somebody went and looked.

create table if not exists public.episode_outcomes (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,

  kind          text not null check (kind in (
                  'no_failure_observed', 'leak', 'crack', 'electrical_fault',
                  'water_intrusion', 'mold', 'material_failure', 'callback',
                  'warranty_claim', 'insurance_claim', 'customer_complaint',
                  'rework_ordered', 'litigation')),
  observed_at   timestamptz not null default now(),
  -- Denormalised because "failed 190 days later" is the query, and computing it
  -- against the episode every time is the kind of join that never gets written.
  days_after_work integer,

  detail        text check (detail is null or length(detail) <= 2000),
  -- Where the fault was attributed, when anyone attributed it. Null is honest:
  -- most failures are never formally assigned.
  responsible_party_id uuid references public.job_parties (id) on delete set null,
  cost_amount   numeric(12, 2) check (cost_amount is null or cost_amount >= 0),

  -- The rework episode, when one exists. Attempt → failure → diagnosis →
  -- correction → retest is the sequence worth learning, and this is the edge
  -- that makes it traversable.
  corrected_by_episode_id uuid references public.work_episodes (id) on delete set null,

  recorded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists episode_outcomes_episode_idx
  on public.episode_outcomes (episode_id, observed_at);
create index if not exists episode_outcomes_kind_idx
  on public.episode_outcomes (org_id, kind);

alter table public.episode_outcomes enable row level security;

drop policy if exists episode_outcomes_all on public.episode_outcomes;
create policy episode_outcomes_all on public.episode_outcomes
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- What it cost
-- ---------------------------------------------------------------------------
-- One row per episode. This is the column set that separates this dataset from
-- a pure robotics one: it says which physical mistakes actually cost money,
-- which is the only ranking that matters to the people paying for the work.

create table if not exists public.episode_economics (
  episode_id      uuid primary key references public.work_episodes (id) on delete cascade,
  org_id          uuid not null references public.orgs (id) on delete cascade,

  labor_hours     numeric(10, 2) check (labor_hours is null or labor_hours >= 0),
  labor_cost      numeric(12, 2),
  material_cost   numeric(12, 2),
  equipment_cost  numeric(12, 2),

  invoiced_amount numeric(12, 2),
  approved_amount numeric(12, 2),
  withheld_amount numeric(12, 2),
  change_order_amount numeric(12, 2),
  rework_cost     numeric(12, 2),
  delay_days      integer check (delay_days is null or delay_days >= 0),
  backcharge_amount numeric(12, 2),
  insurance_paid_amount numeric(12, 2),

  note            text check (note is null or length(note) <= 1000),
  updated_at      timestamptz not null default now()
);

alter table public.episode_economics enable row level security;

drop policy if exists episode_economics_all on public.episode_economics;
create policy episode_economics_all on public.episode_economics
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

revoke all on public.job_locations, public.work_episodes, public.episode_observations,
              public.episode_actions, public.episode_resources,
              public.episode_verifications, public.episode_outcomes,
              public.episode_economics
  from anon;
