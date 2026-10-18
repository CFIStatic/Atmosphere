-- ---------------------------------------------------------------------------
-- Dataset layer: rights, privacy, provenance, registry, examples, exports
-- ---------------------------------------------------------------------------
-- Separates operational verification data from training/evaluation preparation.
-- No record enters the dataset layer without rights + privacy eligibility.
-- Released dataset versions are immutable.

-- Pipeline stages for dataset path
do $$ begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'privacy_scan'
  ) then
    alter type verification_processing_stage add value 'privacy_scan';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'evaluate_dataset_eligibility'
  ) then
    alter type verification_processing_stage add value 'evaluate_dataset_eligibility';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'create_dataset_examples'
  ) then
    alter type verification_processing_stage add value 'create_dataset_examples';
  end if;
end $$;

do $$ begin
  create type rights_category as enum (
    'operational_only',
    'internal_improvement',
    'evaluation_allowed',
    'training_allowed',
    'restricted',
    'pending_review',
    'revoked'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type privacy_status as enum (
    'unknown',
    'pending',
    'clear',
    'findings_present',
    'redacted',
    'export_safe',
    'blocked',
    'review_required'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type dataset_version_status as enum (
    'draft',
    'validating',
    'ready',
    'released',
    'deprecated',
    'revoked'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type dataset_split as enum (
    'train',
    'validation',
    'test',
    'benchmark',
    'holdout',
    'private_evaluation'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Rights manifests
-- ---------------------------------------------------------------------------

create table if not exists public.rights_manifests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid references public.crm_jobs (id) on delete set null,
  video_id        uuid references public.verification_videos (id) on delete set null,
  result_id       uuid references public.verification_results (id) on delete set null,

  category        rights_category not null default 'operational_only',
  operational_processing boolean not null default true,
  internal_improvement boolean not null default false,
  evaluation_allowed boolean not null default false,
  training_allowed boolean not null default false,
  third_party_transfer boolean not null default false,
  derivative_allowed boolean not null default false,
  deidentification_allowed boolean not null default false,

  retention_days  integer check (retention_days is null or retention_days > 0),
  geographic_restrictions text[] not null default '{}',
  field_of_use_restrictions text[] not null default '{}',
  agreement_ref   text,
  consent_source  text,
  consent_at      timestamptz,
  policy_version  text not null default 'v1',
  revoked_at      timestamptz,
  revoke_reason   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rights_manifests_org_idx
  on public.rights_manifests (org_id, category);
create index if not exists rights_manifests_video_idx
  on public.rights_manifests (video_id)
  where video_id is not null;

-- ---------------------------------------------------------------------------
-- Privacy findings
-- ---------------------------------------------------------------------------

create table if not exists public.privacy_findings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  video_id        uuid not null references public.verification_videos (id) on delete cascade,
  frame_id        uuid references public.verification_frames (id) on delete set null,

  finding_type    text not null,
  confidence      numeric(5, 4) check (confidence is null or (confidence between 0 and 1)),
  detection_model text,
  timestamp_seconds numeric(10, 3),
  region          jsonb not null default '{}'::jsonb,
  action_taken    text not null default 'flagged'
                    check (action_taken in ('flagged', 'redacted', 'cleared', 'blocked', 'review')),
  review_status   text not null default 'open'
                    check (review_status in ('open', 'accepted', 'dismissed')),
  created_at      timestamptz not null default now()
);

create index if not exists privacy_findings_video_idx
  on public.privacy_findings (video_id, finding_type);

alter table public.verification_videos
  add column if not exists privacy_status privacy_status not null default 'unknown',
  add column if not exists rights_manifest_id uuid references public.rights_manifests (id) on delete set null,
  add column if not exists quarantine_reason text;

alter table public.verification_results
  add column if not exists privacy_status privacy_status not null default 'unknown',
  add column if not exists rights_manifest_id uuid references public.rights_manifests (id) on delete set null,
  add column if not exists dataset_eligible boolean,
  add column if not exists eligibility_reason text;

-- ---------------------------------------------------------------------------
-- Provenance (append-friendly)
-- ---------------------------------------------------------------------------

create table if not exists public.provenance_records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  entity_type     text not null,
  entity_id       uuid not null,
  parent_type     text,
  parent_id       uuid,
  transformation  text not null,
  transformation_version text not null default 'v1',
  model_name      text,
  prompt_version  text,
  rule_version    text,
  ontology_version text,
  code_version    text,
  checksum        text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists provenance_records_entity_idx
  on public.provenance_records (entity_type, entity_id);
create index if not exists provenance_records_parent_idx
  on public.provenance_records (parent_type, parent_id)
  where parent_id is not null;

-- ---------------------------------------------------------------------------
-- Dataset registry
-- ---------------------------------------------------------------------------

create table if not exists public.dataset_registry (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs (id) on delete cascade, -- null = platform-wide
  name            text not null,
  purpose         text not null default 'temporal_work_verification',
  description     text,
  created_at      timestamptz not null default now(),
  constraint dataset_registry_name unique (org_id, name)
);

create table if not exists public.dataset_versions (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      uuid not null references public.dataset_registry (id) on delete cascade,
  version         text not null,
  status          dataset_version_status not null default 'draft',
  ontology_version text not null default 'v1',
  schema_version  text not null default '1.0.0',
  rights_policy_version text not null default 'v1',
  privacy_policy_version text not null default 'v1',
  quality_policy_version text not null default 'v1',
  split_policy_version text not null default 'v1',
  split_seed      text not null default 'atmosphere-split-v1',
  example_count   integer not null default 0,
  checksum_manifest text,
  release_notes   text,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint dataset_versions_unique unique (dataset_id, version),
  constraint dataset_versions_release_immutable check (
    status <> 'released' or released_at is not null
  )
);

create table if not exists public.dataset_examples (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  dataset_version_id uuid not null references public.dataset_versions (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  result_id       uuid references public.verification_results (id) on delete set null,
  video_id        uuid references public.verification_videos (id) on delete set null,
  rights_manifest_id uuid references public.rights_manifests (id) on delete set null,
  provenance_root_id uuid references public.provenance_records (id) on delete set null,

  task_type       text not null default 'temporal_work_verification',
  split           dataset_split not null,
  ontology_version text not null default 'v1',
  schema_version  text not null default '1.0.0',

  canonical       jsonb not null,
  quality_score   numeric(5, 4),
  quality_breakdown jsonb not null default '{}'::jsonb,
  privacy_status  privacy_status not null default 'export_safe',
  eligibility_passed boolean not null default true,

  created_at      timestamptz not null default now(),
  constraint dataset_examples_result_once unique (dataset_version_id, result_id)
);

create index if not exists dataset_examples_version_split_idx
  on public.dataset_examples (dataset_version_id, split);
create index if not exists dataset_examples_job_idx
  on public.dataset_examples (job_id);

create table if not exists public.dataset_example_media (
  id              uuid primary key default gen_random_uuid(),
  example_id      uuid not null references public.dataset_examples (id) on delete cascade,
  role            text not null check (role in ('before', 'during', 'after', 'context', 'clip')),
  frame_id        uuid references public.verification_frames (id) on delete set null,
  clip_id         uuid references public.video_clips (id) on delete set null,
  video_timestamp_seconds numeric(10, 3),
  storage_path    text,
  created_at      timestamptz not null default now()
);

create index if not exists dataset_example_media_example_idx
  on public.dataset_example_media (example_id);

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------

create table if not exists public.export_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs (id) on delete cascade,
  dataset_version_id uuid not null references public.dataset_versions (id) on delete cascade,
  format          text not null default 'jsonl'
                    check (format in ('jsonl', 'parquet', 'csv', 'webdataset')),
  split_filter    dataset_split,
  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  storage_path    text,
  example_count   integer not null default 0,
  byte_size       bigint,
  checksum_sha256 text,
  error           text,
  schema_version  text not null default '1.0.0',
  ontology_version text not null default 'v1',
  code_version    text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create table if not exists public.export_manifests (
  id              uuid primary key default gen_random_uuid(),
  export_job_id   uuid not null references public.export_jobs (id) on delete cascade,
  file_name       text not null,
  storage_path    text not null,
  checksum_sha256 text not null,
  byte_size       bigint not null,
  record_count    integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.eligibility_decisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  result_id       uuid not null references public.verification_results (id) on delete cascade,
  video_id        uuid references public.verification_videos (id) on delete set null,
  eligible        boolean not null,
  reasons         text[] not null default '{}',
  rights_category rights_category,
  privacy_status  privacy_status,
  policy_version  text not null default 'v1',
  created_at      timestamptz not null default now()
);

create index if not exists eligibility_decisions_result_idx
  on public.eligibility_decisions (result_id, created_at desc);

-- Released versions: block updates that would mutate content after release
create or replace function private.dataset_versions_protect_released()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists dataset_versions_immutable_release on public.dataset_versions;
create trigger dataset_versions_immutable_release
  before update or delete on public.dataset_versions
  for each row execute function private.dataset_versions_protect_released();

-- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'rights_manifests',
    'privacy_findings',
    'provenance_records',
    'dataset_examples',
    'export_jobs',
    'eligibility_decisions'
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
    if t not in ('eligibility_decisions', 'provenance_records') then
      execute format('drop policy if exists %I_update on public.%I', t, t);
      execute format(
        'create policy %I_update on public.%I for update to authenticated
           using (private.is_org_member(org_id))
           with check (private.is_org_member(org_id))', t, t);
    end if;
  end loop;

  execute 'alter table public.dataset_registry enable row level security';
  execute 'drop policy if exists dataset_registry_select on public.dataset_registry';
  execute
    'create policy dataset_registry_select on public.dataset_registry for select to authenticated
       using (org_id is null or private.is_org_member(org_id))';
  execute 'drop policy if exists dataset_registry_insert on public.dataset_registry';
  execute
    'create policy dataset_registry_insert on public.dataset_registry for insert to authenticated
       with check (org_id is not null and private.is_org_member(org_id))';

  execute 'alter table public.dataset_versions enable row level security';
  execute 'drop policy if exists dataset_versions_select on public.dataset_versions';
  execute
    'create policy dataset_versions_select on public.dataset_versions for select to authenticated
       using (
         exists (
           select 1 from public.dataset_registry d
           where d.id = dataset_id
             and (d.org_id is null or private.is_org_member(d.org_id))
         )
       )';
  execute 'drop policy if exists dataset_versions_insert on public.dataset_versions';
  execute
    'create policy dataset_versions_insert on public.dataset_versions for insert to authenticated
       with check (
         exists (
           select 1 from public.dataset_registry d
           where d.id = dataset_id and d.org_id is not null and private.is_org_member(d.org_id)
         )
       )';
  execute 'drop policy if exists dataset_versions_update on public.dataset_versions';
  execute
    'create policy dataset_versions_update on public.dataset_versions for update to authenticated
       using (
         exists (
           select 1 from public.dataset_registry d
           where d.id = dataset_id and d.org_id is not null and private.is_org_member(d.org_id)
         )
       )';

  execute 'alter table public.dataset_example_media enable row level security';
  execute 'drop policy if exists dataset_example_media_select on public.dataset_example_media';
  execute
    'create policy dataset_example_media_select on public.dataset_example_media for select to authenticated
       using (
         exists (
           select 1 from public.dataset_examples e
           where e.id = example_id and private.is_org_member(e.org_id)
         )
       )';
  execute 'drop policy if exists dataset_example_media_insert on public.dataset_example_media';
  execute
    'create policy dataset_example_media_insert on public.dataset_example_media for insert to authenticated
       with check (
         exists (
           select 1 from public.dataset_examples e
           where e.id = example_id and private.is_org_member(e.org_id)
         )
       )';
  execute 'drop policy if exists dataset_example_media_update on public.dataset_example_media';
  execute
    'create policy dataset_example_media_update on public.dataset_example_media for update to authenticated
       using (
         exists (
           select 1 from public.dataset_examples e
           where e.id = example_id and private.is_org_member(e.org_id)
         )
       )
       with check (
         exists (
           select 1 from public.dataset_examples e
           where e.id = example_id and private.is_org_member(e.org_id)
         )
       )';

  execute 'alter table public.export_manifests enable row level security';
  execute 'drop policy if exists export_manifests_select on public.export_manifests';
  execute
    'create policy export_manifests_select on public.export_manifests for select to authenticated
       using (
         exists (
           select 1 from public.export_jobs j
           where j.id = export_job_id
             and (j.org_id is null or private.is_org_member(j.org_id))
         )
       )';
  execute 'drop policy if exists export_manifests_insert on public.export_manifests';
  execute
    'create policy export_manifests_insert on public.export_manifests for insert to authenticated
       with check (
         exists (
           select 1 from public.export_jobs j
           where j.id = export_job_id
             and j.org_id is not null and private.is_org_member(j.org_id)
         )
       )';
end $$;
