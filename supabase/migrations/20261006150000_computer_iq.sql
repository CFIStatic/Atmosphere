-- Computer IQ: daily practice runs, replayable site playbooks, playbook drafts
-- from demonstrations, and per-step model routing.
--
-- Hard rules carried from computer_site_playbooks (#662): playbooks and drafts
-- never hold passwords, codes, customer / homeowner / job data, email or CRM
-- content, money figures, or anything typed into a field. Typed steps store a
-- slot name (for example "job.claimNumber"), never the value.
--
-- Practice runs, screens and drafts are service-role only (RLS on, no member
-- grants). Staff read them through the internal analytics API.

-- 1. Practice metadata on a Computer task (null for every customer task).
alter table public.computer_tasks
  add column if not exists practice jsonb;

comment on column public.computer_tasks.practice is
  'Practice run metadata: {runId, taskKey, mode}. Null for customer tasks. Practice tasks never ask a person and never submit.';

-- 2. Replayable steps and versioning on the shared site playbooks.
alter table public.computer_site_playbooks
  add column if not exists version integer not null default 1,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists source text not null default 'success',
  add column if not exists replay_success_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_failure_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'computer_site_playbooks_status_check') then
    alter table public.computer_site_playbooks
      add constraint computer_site_playbooks_status_check check (status in ('active', 'retired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'computer_site_playbooks_source_check') then
    alter table public.computer_site_playbooks
      add constraint computer_site_playbooks_source_check check (source in ('success', 'demonstration', 'handoff'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'computer_site_playbooks_version_check') then
    alter table public.computer_site_playbooks
      add constraint computer_site_playbooks_version_check check (version >= 1);
  end if;
end $$;

-- 3. Daily practice runs (demo org only; enforced in code by COMPUTER_PRACTICE_ORG_ID).
create table if not exists public.computer_practice_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs (id) on delete cascade,
  run_date          date not null,
  site              text not null check (length(btrim(site)) between 1 and 120),
  task_key          text not null check (length(btrim(task_key)) between 1 and 80),
  task_type         text not null check (length(btrim(task_type)) between 1 and 60),
  mode              text not null check (mode in ('read_only', 'stop_before_submit')),
  status            text not null default 'running'
                      check (status in ('running', 'succeeded', 'failed', 'needs_login', 'skipped')),
  failed_step       integer check (failed_step is null or failed_step >= 0),
  failure_reason    text check (failure_reason is null or length(failure_reason) <= 500),
  steps             jsonb not null default '[]'::jsonb,
  task_id           uuid references public.computer_tasks (id) on delete set null,
  playbook_id       uuid references public.computer_site_playbooks (id) on delete set null,
  playbook_version  integer,
  used_playbook     boolean not null default false,
  model_calls       integer not null default 0 check (model_calls >= 0),
  cost_nanos        bigint not null default 0 check (cost_nanos >= 0),
  duration_ms       integer check (duration_ms is null or duration_ms >= 0),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint computer_practice_runs_once_per_day unique (org_id, run_date, task_key)
);

create index if not exists computer_practice_runs_date_idx
  on public.computer_practice_runs (run_date desc, site, task_key);

comment on table public.computer_practice_runs is
  'One row per practice task per day for the practice org. Staff-only dashboard source. No customer data.';

alter table public.computer_practice_runs enable row level security;
revoke all on public.computer_practice_runs from anon, authenticated;

-- 4. Screenshots for a practice run (small JPEGs, capped).
create table if not exists public.computer_practice_screens (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references public.computer_practice_runs (id) on delete cascade,
  step_index  integer not null check (step_index >= 0),
  label       text not null check (length(btrim(label)) between 1 and 200),
  jpeg_b64    text not null check (length(jpeg_b64) <= 600000),
  created_at  timestamptz not null default now()
);

create index if not exists computer_practice_screens_run_idx
  on public.computer_practice_screens (run_id, step_index);

alter table public.computer_practice_screens enable row level security;
revoke all on public.computer_practice_screens from anon, authenticated;

-- 5. Playbook drafts from a person's demonstration or a handoff. Used only after a person approves.
create table if not exists public.computer_playbook_drafts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  task_id      uuid references public.computer_tasks (id) on delete set null,
  site         text not null check (length(btrim(site)) between 1 and 120),
  task_type    text not null check (length(btrim(task_type)) between 1 and 60),
  source       text not null check (source in ('demonstration', 'handoff')),
  steps        jsonb not null default '[]'::jsonb,
  step_count   integer not null default 0 check (step_count >= 0),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text check (review_note is null or length(review_note) <= 500),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  playbook_id  uuid references public.computer_site_playbooks (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists computer_playbook_drafts_status_idx
  on public.computer_playbook_drafts (status, created_at desc);

comment on table public.computer_playbook_drafts is
  'PII-scrubbed playbook drafts recorded from Take control. Never used until a person approves.';

alter table public.computer_playbook_drafts enable row level security;
revoke all on public.computer_playbook_drafts from anon, authenticated;

-- 6. Per-step model routing for Computer (mirrors ask_route_decisions).
create table if not exists public.computer_route_decisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.orgs (id) on delete set null,
  task_id     uuid references public.computer_tasks (id) on delete cascade,
  step        integer not null check (step >= 0),
  route       text not null check (route in ('fast', 'strong', 'verify', 'fallback', 'replay')),
  model       text not null check (length(btrim(model)) between 1 and 120),
  reason      text not null check (length(btrim(reason)) between 1 and 200),
  created_at  timestamptz not null default now()
);

create index if not exists computer_route_decisions_task_idx
  on public.computer_route_decisions (task_id, step);

create index if not exists computer_route_decisions_org_idx
  on public.computer_route_decisions (org_id, created_at desc);

alter table public.computer_route_decisions enable row level security;

drop policy if exists computer_route_decisions_select on public.computer_route_decisions;
create policy computer_route_decisions_select on public.computer_route_decisions
  for select to authenticated
  using (org_id is not null and private.is_org_member(org_id));

revoke all on public.computer_route_decisions from anon;
revoke insert, update, delete on public.computer_route_decisions from authenticated;
grant select on public.computer_route_decisions to authenticated;
