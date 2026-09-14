-- ---------------------------------------------------------------------------
-- Silent panic / wellness check (extends safety_incidents from #427)
-- ---------------------------------------------------------------------------
-- Long no-motion + alone-on-site (or similar capture/telemetry signals) →
-- nudge the office with a safety_incidents row. Configurable org thresholds.
-- Ack/dismiss reuse the existing safety API. Atmosphere never calls 911.

alter type public.safety_incident_category add value if not exists 'silent_panic_wellness';
alter type public.safety_incident_source add value if not exists 'wellness_heartbeat';

alter table public.orgs
  add column if not exists wellness_check_enabled boolean not null default true,
  add column if not exists wellness_no_motion_seconds integer not null default 300
    check (wellness_no_motion_seconds between 60 and 7200),
  add column if not exists wellness_critical_after_seconds integer not null default 600
    check (wellness_critical_after_seconds between 60 and 14400),
  add column if not exists wellness_require_alone boolean not null default true;

comment on column public.orgs.wellness_check_enabled is
  'When true, Field Capture wellness heartbeats can open silent_panic_wellness incidents.';
comment on column public.orgs.wellness_no_motion_seconds is
  'Seconds of no significant motion (alone if required) before a watch wellness nudge. Default 300.';
comment on column public.orgs.wellness_critical_after_seconds is
  'Seconds of no motion before severity escalates to critical (still no auto-911). Default 600.';
comment on column public.orgs.wellness_require_alone is
  'When true, wellness alerts only fire if alone_on_site is reported. Default true.';

create table if not exists public.wellness_session_state (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs (id) on delete cascade,
  job_id                    uuid not null references public.crm_jobs (id) on delete cascade,
  party_id                  uuid,
  clip_id                   text,
  last_motion_at            timestamptz not null default now(),
  last_heartbeat_at         timestamptz not null default now(),
  alone_on_site             boolean not null default true,
  last_motion_score         numeric(6,4),
  person_count_estimate     integer
    check (person_count_estimate is null or person_count_estimate between 0 and 50),
  recording_active          boolean not null default true,
  lat                       double precision,
  lon                       double precision,
  location_label            text check (location_label is null or length(location_label) <= 400),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.wellness_session_state is
  'Latest Field Capture wellness heartbeat per job/clip. Used to detect long '
  'no-motion + alone-on-site silent panic conditions. Never triggers 911.';

create unique index if not exists wellness_session_state_job_clip_uidx
  on public.wellness_session_state (org_id, job_id, clip_id)
  where clip_id is not null;

create unique index if not exists wellness_session_state_job_noclip_uidx
  on public.wellness_session_state (org_id, job_id)
  where clip_id is null;

create index if not exists wellness_session_state_org_job_idx
  on public.wellness_session_state (org_id, job_id, updated_at desc);

alter table public.wellness_session_state enable row level security;

drop policy if exists wellness_session_state_select_member on public.wellness_session_state;
create policy wellness_session_state_select_member on public.wellness_session_state
  for select to authenticated
  using (private.is_org_member(org_id));

grant select on public.wellness_session_state to authenticated;
grant all on public.wellness_session_state to service_role;
