-- ---------------------------------------------------------------------------
-- Field Capture recording-on-property disclosure acknowledgments
-- ---------------------------------------------------------------------------
-- Separate from terms_acceptances (worker ToS). Crew must acknowledge a
-- versioned disclosure before recording on a job site. One row per
-- (job, actor user, work day, disclosure version).
-- ---------------------------------------------------------------------------

create table if not exists public.recording_acknowledgments (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  job_id               uuid not null references public.crm_jobs (id) on delete cascade,
  property_id          uuid references public.crm_properties (id) on delete set null,
  actor_user_id        uuid not null references auth.users (id) on delete cascade,
  actor_party_id       uuid,
  disclosure_version   text not null
    check (char_length(disclosure_version) between 1 and 64),
  work_date            date not null,
  acknowledged_at      timestamptz not null default now(),
  ip                   text,
  user_agent           text,
  created_at           timestamptz not null default now(),
  unique (job_id, actor_user_id, work_date, disclosure_version)
);

comment on table public.recording_acknowledgments is
  'Field Capture recording-on-property disclosure acks. Separate from worker ToS. '
  'One row per job, crew user, work day, and disclosure version.';

comment on column public.recording_acknowledgments.disclosure_version is
  'Version string the crew acknowledged, e.g. recording-disclosure-v1.';

comment on column public.recording_acknowledgments.actor_party_id is
  'Optional job_parties id when the ack was filed through a Field Capture / share party.';

create index if not exists recording_acknowledgments_job_day_idx
  on public.recording_acknowledgments (job_id, work_date, disclosure_version);

create index if not exists recording_acknowledgments_party_day_idx
  on public.recording_acknowledgments (job_id, actor_party_id, work_date, disclosure_version)
  where actor_party_id is not null;

create index if not exists recording_acknowledgments_org_idx
  on public.recording_acknowledgments (org_id, acknowledged_at desc);

alter table public.recording_acknowledgments enable row level security;

revoke all on table public.recording_acknowledgments from public, anon;
grant select, insert, update on table public.recording_acknowledgments to authenticated;
grant all on table public.recording_acknowledgments to service_role;

drop policy if exists recording_acknowledgments_self_select on public.recording_acknowledgments;
create policy recording_acknowledgments_self_select on public.recording_acknowledgments
  for select to authenticated
  using (auth.uid() = actor_user_id);

drop policy if exists recording_acknowledgments_self_insert on public.recording_acknowledgments;
create policy recording_acknowledgments_self_insert on public.recording_acknowledgments
  for insert to authenticated
  with check (auth.uid() = actor_user_id);

drop policy if exists recording_acknowledgments_self_update on public.recording_acknowledgments;
create policy recording_acknowledgments_self_update on public.recording_acknowledgments
  for update to authenticated
  using (auth.uid() = actor_user_id)
  with check (auth.uid() = actor_user_id);

drop policy if exists recording_acknowledgments_org_select on public.recording_acknowledgments;
create policy recording_acknowledgments_org_select on public.recording_acknowledgments
  for select to authenticated
  using (private.is_org_member(org_id));
