-- Suggested work: job-aware suggestions with one-tap Approve.
--
-- 1. job_suggestions. One row per piece of work Atmosphere suggests on a job
--    ("Build the estimate in Xactimate", "Update the CRM with today's
--    walkthrough"). The evaluator decides from the job's state, not from each
--    upload, and records the state it saw as state_fingerprint. The same kind
--    of suggestion is never made twice for the same job state, whether the
--    first one is still open or was dismissed (unique job_id, kind,
--    state_fingerprint). At most one suggestion of a kind is open per job.
--
-- 2. job_suggestion_events. Append-only log of every create / approve /
--    dismiss / edit / supersede, with who did it. This is what per-company
--    playbook learning will read later; nothing reads it yet.
--
-- Both tables are written only by the server (service role) after it checks
-- the caller, as with the other job records since
-- 20261019150000_video_records_server_only.sql. Workspace members can read
-- their workspace's rows. Homeowners and subs are not workspace members, so
-- they never see a suggestion.

create table if not exists public.job_suggestions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs (id) on delete cascade,
  job_id            uuid not null references public.crm_jobs (id) on delete cascade,
  kind              text not null check (kind in (
                      'capture_missing', 'build_estimate', 'supplement_packet',
                      'crm_update', 'homeowner_update')),
  status            text not null default 'open'
                      check (status in ('open', 'approved', 'dismissed', 'superseded')),
  title             text not null check (length(title) between 1 and 200),
  detail            text check (detail is null or length(detail) <= 2000),
  reason            text check (reason is null or length(reason) <= 1000),
  prompt            text not null check (length(prompt) between 1 and 4000),
  handoff           text not null default 'chat' check (handoff in ('chat', 'computer')),
  state_fingerprint text not null check (length(state_fingerprint) between 1 and 128),
  evidence          jsonb not null default '{}'::jsonb,
  source            text not null default 'rules' check (source in ('rules', 'rules+model')),
  model             text,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references public.profiles (id) on delete set null,
  constraint job_suggestions_once_per_state unique (job_id, kind, state_fingerprint)
);

comment on table public.job_suggestions is
  'Work Atmosphere suggests on a job, decided from the job''s state. Written by the BFF (service role); office members read their workspace''s rows.';

create unique index if not exists job_suggestions_one_open_per_kind
  on public.job_suggestions (job_id, kind) where status = 'open';

create index if not exists job_suggestions_org_open_idx
  on public.job_suggestions (org_id, created_at desc) where status = 'open';

alter table public.job_suggestions enable row level security;

drop policy if exists job_suggestions_select on public.job_suggestions;
create policy job_suggestions_select on public.job_suggestions
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.job_suggestions from anon, authenticated;
revoke all on public.job_suggestions from anon;
grant select on public.job_suggestions to authenticated;
grant select, insert, update, delete on public.job_suggestions to service_role;

create table if not exists public.job_suggestion_events (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.orgs (id) on delete cascade,
  job_id         uuid not null references public.crm_jobs (id) on delete cascade,
  suggestion_id  uuid not null references public.job_suggestions (id) on delete cascade,
  kind           text not null,
  action         text not null check (action in ('created', 'approved', 'dismissed', 'edited', 'superseded')),
  user_id        uuid references public.profiles (id) on delete set null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.job_suggestion_events is
  'Append-only log of what people did with suggested work (approve, dismiss, edit). Feeds per-company playbook learning. Written by the BFF only.';

create index if not exists job_suggestion_events_org_idx
  on public.job_suggestion_events (org_id, created_at desc);

create index if not exists job_suggestion_events_suggestion_idx
  on public.job_suggestion_events (suggestion_id);

alter table public.job_suggestion_events enable row level security;

drop policy if exists job_suggestion_events_select on public.job_suggestion_events;
create policy job_suggestion_events_select on public.job_suggestion_events
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.job_suggestion_events from anon, authenticated;
revoke all on public.job_suggestion_events from anon;
grant select on public.job_suggestion_events to authenticated;
grant select, insert on public.job_suggestion_events to service_role;
