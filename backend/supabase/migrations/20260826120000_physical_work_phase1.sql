-- ---------------------------------------------------------------------------
-- Physical-work Phase 1 — world state, evidence pointers, annotations, day outcome
-- ---------------------------------------------------------------------------
-- work_episodes is already the TaskEpisode. This migration fills the four
-- gaps that keep a filmed day from being a structured physical-work record:
--
--   1. World state before and after (what the place was, what it became)
--   2. Evidence assets as pointers at job_proofs — not a second blob store
--   3. Append-only annotation history (model v1 vs v2 vs a person)
--   4. Immediate day outcome — AI-inferred, explicitly not ground truth
--
-- Ground truth stays on episode_verifications. Later callbacks stay on
-- episode_outcomes. Rights stay on work_episodes. Nothing here replaces a
-- table that already works.

-- ---------------------------------------------------------------------------
-- World state
-- ---------------------------------------------------------------------------

create table if not exists public.episode_world_states (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,
  kind          text not null check (kind in ('before', 'after')),
  source_proof_id uuid references public.job_proofs (id) on delete set null,

  summary       text check (summary is null or length(summary) <= 2000),
  opening       text check (opening is null or length(opening) <= 40),
  visible_conditions jsonb not null default '[]'::jsonb,
  changes       jsonb not null default '[]'::jsonb,
  concerns      jsonb not null default '[]'::jsonb,
  uncertainties jsonb not null default '[]'::jsonb,
  objects       jsonb not null default '[]'::jsonb,
  payload       jsonb not null default '{}'::jsonb,

  source        text not null default 'ai' check (source in ('ai', 'human', 'derived')),
  model         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (episode_id, kind)
);

create index if not exists episode_world_states_episode_idx
  on public.episode_world_states (episode_id, kind);

drop trigger if exists episode_world_states_touch on public.episode_world_states;
create trigger episode_world_states_touch
  before update on public.episode_world_states
  for each row execute function public.touch_updated_at();

alter table public.episode_world_states enable row level security;

drop policy if exists episode_world_states_all on public.episode_world_states;
create policy episode_world_states_all on public.episode_world_states
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

comment on table public.episode_world_states is
  'Structured before/after reading of the work area. Media stays on job_proofs.';

-- ---------------------------------------------------------------------------
-- Evidence assets — pointers
-- ---------------------------------------------------------------------------

create table if not exists public.episode_evidence_assets (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,
  proof_id      uuid references public.job_proofs (id) on delete set null,

  kind          text not null default 'video'
                  check (kind in ('video', 'photo', 'audio', 'transcript', 'document', 'note', 'frame')),
  phase         text,
  content_hash  text,
  storage_path  text,
  duration_seconds numeric(10, 2),
  byte_size     bigint,
  captured_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (episode_id, proof_id, kind)
);

create index if not exists episode_evidence_assets_episode_idx
  on public.episode_evidence_assets (episode_id, kind);

drop trigger if exists episode_evidence_assets_touch on public.episode_evidence_assets;
create trigger episode_evidence_assets_touch
  before update on public.episode_evidence_assets
  for each row execute function public.touch_updated_at();

alter table public.episode_evidence_assets enable row level security;

drop policy if exists episode_evidence_assets_all on public.episode_evidence_assets;
create policy episode_evidence_assets_all on public.episode_evidence_assets
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

comment on table public.episode_evidence_assets is
  'Pointers at existing proof media. Hash and path travel with the row so an '
  'export can cite evidence without copying the blob store.';

-- ---------------------------------------------------------------------------
-- Annotations — append-only
-- ---------------------------------------------------------------------------

create table if not exists public.episode_annotations (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,

  kind          text not null check (kind in (
                  'ai_world_state', 'ai_actions', 'ai_immediate_outcome',
                  'ai_resources', 'human'
                )),
  model         text,
  payload_hash  text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists episode_annotations_dedup
  on public.episode_annotations (episode_id, kind, payload_hash);

create index if not exists episode_annotations_episode_idx
  on public.episode_annotations (episode_id, created_at);

create or replace function private.episode_annotations_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'An annotation is a record of what a model or person said. Add a new one.';
end;
$$;

drop trigger if exists episode_annotations_immutable on public.episode_annotations;
create trigger episode_annotations_immutable
  before update or delete on public.episode_annotations
  for each row execute function private.episode_annotations_append_only();

alter table public.episode_annotations enable row level security;

drop policy if exists episode_annotations_select on public.episode_annotations;
create policy episode_annotations_select on public.episode_annotations
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists episode_annotations_insert on public.episode_annotations;
create policy episode_annotations_insert on public.episode_annotations
  for insert to authenticated with check (private.is_org_member(org_id));

comment on table public.episode_annotations is
  'Append-only history of structured readings. Same payload hash is a no-op; '
  'a new model version is a new row.';

-- ---------------------------------------------------------------------------
-- Immediate day outcome — not ground truth
-- ---------------------------------------------------------------------------

create table if not exists public.episode_immediate_outcomes (
  episode_id    uuid primary key references public.work_episodes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,

  status        text not null check (status in (
                  'appears_complete', 'in_progress', 'not_visible',
                  'mixed', 'changed', 'unknown'
                )),
  material_change text,
  summary       text check (summary is null or length(summary) <= 2000),
  scope_verdicts jsonb not null default '[]'::jsonb,

  source        text not null default 'ai' check (source in ('ai', 'human', 'derived')),
  -- Stored as a column so a query never has to remember the rule: this row
  -- is what the model thought at the end of the day. Inspectors write
  -- episode_verifications.
  is_ground_truth boolean not null default false,
  model         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint episode_immediate_outcome_not_truth
    check (is_ground_truth = false)
);

drop trigger if exists episode_immediate_outcomes_touch on public.episode_immediate_outcomes;
create trigger episode_immediate_outcomes_touch
  before update on public.episode_immediate_outcomes
  for each row execute function public.touch_updated_at();

alter table public.episode_immediate_outcomes enable row level security;

drop policy if exists episode_immediate_outcomes_all on public.episode_immediate_outcomes;
create policy episode_immediate_outcomes_all on public.episode_immediate_outcomes
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

comment on table public.episode_immediate_outcomes is
  'AI-inferred result of the day. Never ground truth. Inspectors use episode_verifications.';

revoke all on public.episode_world_states, public.episode_evidence_assets,
              public.episode_annotations, public.episode_immediate_outcomes
  from anon;
