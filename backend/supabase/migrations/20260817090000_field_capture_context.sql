-- ---------------------------------------------------------------------------
-- Field Capture context
-- ---------------------------------------------------------------------------
-- Everything Apple lets the Field Capture app attest while a crew films the
-- day — device, permissions, capabilities, environment, location trail, and
-- motion — organized so the office can read it without hunting through a blob.
--
-- Facts stay facts. Verdicts stay in checks. This layer never invents a
-- "verified device" flag; it stores what the phone reported and when.

alter table public.job_proofs
  add column if not exists device_context jsonb not null default '{}'::jsonb;

comment on column public.job_proofs.device_context is
  'Organized Apple-allowed capture context snapshotted with the day film '
  '(device, permissions, capabilities, environment, location/motion summaries).';

do $$ begin
  create type field_capture_session_status as enum (
    'open',
    'completed',
    'abandoned'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.field_capture_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,
  party_id      uuid references public.job_parties (id) on delete set null,
  user_id       uuid references public.profiles (id) on delete set null,
  proof_id      uuid references public.job_proofs (id) on delete set null,

  work_date     date,
  status        field_capture_session_status not null default 'open',
  platform      text not null check (platform in ('ios', 'web')),
  app_version   text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,

  -- Organized bundles. Each key group is one section in the admin portal.
  device        jsonb not null default '{}'::jsonb,
  permissions   jsonb not null default '{}'::jsonb,
  capabilities  jsonb not null default '{}'::jsonb,
  environment   jsonb not null default '{}'::jsonb,
  capture       jsonb not null default '{}'::jsonb,
  location_summary jsonb not null default '{}'::jsonb,
  motion_summary   jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists field_capture_sessions_org_started_idx
  on public.field_capture_sessions (org_id, started_at desc);
create index if not exists field_capture_sessions_job_idx
  on public.field_capture_sessions (job_id, started_at desc);
create index if not exists field_capture_sessions_proof_idx
  on public.field_capture_sessions (proof_id)
  where proof_id is not null;

comment on table public.field_capture_sessions is
  'One Field Capture filming window with organized Apple-allowed context '
  'bundles for office review.';

create table if not exists public.field_location_samples (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs (id) on delete cascade,
  session_id          uuid not null references public.field_capture_sessions (id) on delete cascade,
  recorded_at         timestamptz not null,
  lat                 double precision not null check (lat between -90 and 90),
  lon                 double precision not null check (lon between -180 and 180),
  accuracy_m          double precision check (accuracy_m is null or accuracy_m >= 0),
  altitude_m          double precision,
  altitude_accuracy_m double precision check (altitude_accuracy_m is null or altitude_accuracy_m >= 0),
  speed_mps           double precision check (speed_mps is null or speed_mps >= 0),
  course_deg          double precision check (course_deg is null or (course_deg >= 0 and course_deg <= 360)),
  floor               integer,
  created_at          timestamptz not null default now()
);

create index if not exists field_location_samples_session_idx
  on public.field_location_samples (session_id, recorded_at);

comment on table public.field_location_samples is
  'Time-series GPS points while a Field Capture day film is rolling '
  '(when-in-use location only).';

create table if not exists public.field_motion_samples (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  session_id           uuid not null references public.field_capture_sessions (id) on delete cascade,
  recorded_at          timestamptz not null,
  activity             text,
  confidence           double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  pitch_deg            double precision,
  roll_deg             double precision,
  yaw_deg              double precision,
  pressure_hpa         double precision,
  relative_altitude_m  double precision,
  step_count           integer check (step_count is null or step_count >= 0),
  created_at           timestamptz not null default now()
);

create index if not exists field_motion_samples_session_idx
  on public.field_motion_samples (session_id, recorded_at);

comment on table public.field_motion_samples is
  'Sparse motion / barometer / pedometer samples during a Field Capture session.';

alter table public.field_capture_sessions enable row level security;
alter table public.field_location_samples enable row level security;
alter table public.field_motion_samples enable row level security;

do $$ begin
  create policy field_capture_sessions_select_member on public.field_capture_sessions
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy field_location_samples_select_member on public.field_location_samples
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy field_motion_samples_select_member on public.field_motion_samples
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

-- Writes go through the BFF with the service role (same pattern as job_proofs
-- filing). Members read via RLS for the admin portal.
