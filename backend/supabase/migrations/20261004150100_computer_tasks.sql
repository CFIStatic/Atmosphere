-- ============================================================================
-- Computer tasks: a Chat agent that fills out forms on any website
-- ============================================================================
-- An org member asks Chat to do something on a website ("fill out the claim
-- form on the carrier portal for this job"). The BFF queues a computer task;
-- a worker drives a hosted browser with a computer-use model. Logins live in
-- one persistent browser context per org: the customer signs in themselves
-- through the live view, and no password is ever stored here.
--
-- Any submit / send / pay / delete / sign / accept-terms / upload click needs
-- a human approval first (computer_approvals). Every step is written to
-- computer_audit_events, which is append-only.
--
-- All four tables are service-role only: deny-all RLS and no grants to anon
-- or authenticated. Members reach them through /api/chat-computer, which scopes
-- every read and write to the caller's org.
--
-- 1. classify_token_feature: 'computer*' sources map to 'computer'.
-- 2. computer_sessions, computer_tasks, computer_approvals,
--    computer_audit_events.
--
-- Safe to re-run.
-- ============================================================================

-- 1. Billing bucket ----------------------------------------------------------
-- Same CASE as 20261003190100 plus a computer branch first, so a source like
-- 'computer_session' never falls through to the video regex.
create or replace function public.classify_token_feature(p_feature text)
returns public.token_usage_feature
language sql
immutable
as $$
  select case
    when p_feature is null or btrim(p_feature) = '' then 'other'::public.token_usage_feature
    when lower(p_feature) in (
      'computer', 'computer_use', 'computer_agent', 'computer_session', 'computer_browser'
    )
      or lower(p_feature) ~ '^computer([_-]|$)'
      then 'computer'::public.token_usage_feature
    when lower(p_feature) in (
      'web_search', 'web-search', 'tavily', 'tavily_search', 'gemini_search'
    )
      then 'web_search'::public.token_usage_feature
    when lower(p_feature) in (
      'video_analysis', 'verification', 'llm_verifier', 'vision', 'analyzer',
      'proof_analysis', 'frame_analysis', 'video', 'vision_analyzer',
      'work_event_verification', 'escalation', 'clip_analysis'
    )
      or lower(p_feature) ~ '(^|[_-])(video|verif|analys|vision|frame)([_-]|$)'
      then 'video_analysis'::public.token_usage_feature
    when lower(p_feature) in (
      'ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask', 'research'
    )
      or lower(p_feature) ~ '(^|[_-])ask([_-]|$)'
      then 'ask'::public.token_usage_feature
    when lower(p_feature) in (
      'chat', 'model_completion', 'field_assistant', 'technician',
      'voice', 'assist', 'field-assistant', 'technician_assist', 'field_assist'
    )
      or lower(p_feature) ~ '(chat|assist|voice|completion)'
      then 'chat'::public.token_usage_feature
    else 'other'::public.token_usage_feature
  end;
$$;

-- 2a. Browser sessions -------------------------------------------------------
-- One row per hosted browser session. provider_context_id is the org's
-- persistent browser profile (cookies, local storage); the newest row's
-- context is reused so logins stick. At most one live session per org,
-- because a context must not be open in two browsers at once.
create table if not exists public.computer_sessions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  provider             text not null check (provider in ('browserbase', 'mock')),
  provider_session_id  text,
  provider_context_id  text,
  status               text not null default 'starting'
                         check (status in ('starting', 'active', 'ended', 'failed')),
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  browser_seconds      integer check (browser_seconds is null or browser_seconds >= 0),
  metered_at           timestamptz,
  created_at           timestamptz not null default now()
);

create unique index if not exists computer_sessions_one_live_per_org
  on public.computer_sessions (org_id)
  where status in ('starting', 'active');

create index if not exists computer_sessions_org_context_idx
  on public.computer_sessions (org_id, provider, created_at desc);

comment on table public.computer_sessions is
  'Hosted browser sessions for Computer tasks. provider_context_id is the org''s '
  'persistent browser profile; no passwords or live-view URLs are stored.';

-- 2b. Tasks ------------------------------------------------------------------
create table if not exists public.computer_tasks (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  job_id               uuid references public.crm_jobs (id) on delete cascade,
  created_by           uuid references public.profiles (id) on delete set null,
  instructions         text not null check (length(btrim(instructions)) between 1 and 4000),
  start_url            text check (start_url is null or length(start_url) <= 2048),
  job_projection       jsonb not null default '[]'::jsonb,
  status               text not null default 'queued'
                         check (status in (
                           'queued', 'running', 'awaiting_approval', 'needs_you',
                           'succeeded', 'failed', 'canceled'
                         )),
  status_detail        text check (status_detail is null or length(status_detail) <= 500),
  needs_you            jsonb,
  human_control_by     uuid references public.profiles (id) on delete set null,
  human_control_since  timestamptz,
  resume_requested_at  timestamptz,
  cancel_requested_at  timestamptz,
  session_id           uuid references public.computer_sessions (id) on delete set null,
  model_id             text not null,
  step_count           integer not null default 0 check (step_count >= 0),
  max_steps            integer not null check (max_steps between 1 and 500),
  budget_nanos         bigint not null check (budget_nanos > 0),
  cost_nanos           bigint not null default 0 check (cost_nanos >= 0),
  last_action          text check (last_action is null or length(last_action) <= 300),
  current_url          text check (current_url is null or length(current_url) <= 2048),
  result_summary       text check (result_summary is null or length(result_summary) <= 4000),
  error                text check (error is null or length(error) <= 1000),
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  heartbeat_at         timestamptz,
  updated_at           timestamptz not null default now()
);

-- One active task per org: the org's browser context is single-use.
create unique index if not exists computer_tasks_one_active_per_org
  on public.computer_tasks (org_id)
  where status in ('running', 'awaiting_approval', 'needs_you');

create index if not exists computer_tasks_queue_idx
  on public.computer_tasks (created_at)
  where status = 'queued';

create index if not exists computer_tasks_org_job_idx
  on public.computer_tasks (org_id, job_id, created_at desc);

comment on table public.computer_tasks is
  'Chat Computer tasks. job_projection holds only the allowlisted job fields '
  'the agent may type. Status is polled by /api/chat-computer/tasks/:id.';

-- 2c. Approvals --------------------------------------------------------------
-- The agent cannot submit, send, pay, delete, sign, accept terms or upload
-- without an approved row here. A row is single use: the worker flips it to
-- 'consumed' in the same update that lets the click through.
create table if not exists public.computer_approvals (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  task_id              uuid not null references public.computer_tasks (id) on delete cascade,
  status               text not null default 'pending'
                         check (status in ('pending', 'approved', 'canceled', 'expired', 'consumed')),
  action_kind          text not null
                         check (action_kind in ('submit', 'send', 'pay', 'delete', 'sign', 'accept_terms', 'upload')),
  button_label         text not null check (length(btrim(button_label)) between 1 and 200),
  summary              text not null check (length(btrim(summary)) between 1 and 1000),
  page_url             text check (page_url is null or length(page_url) <= 2048),
  page_origin          text check (page_origin is null or length(page_origin) <= 300),
  fields               jsonb not null default '[]'::jsonb,
  screenshot_jpeg_b64  text,
  token_hash           text,
  requested_at         timestamptz not null default now(),
  expires_at           timestamptz not null,
  decided_by           uuid references public.profiles (id) on delete set null,
  decided_at           timestamptz,
  consumed_at          timestamptz
);

create index if not exists computer_approvals_task_idx
  on public.computer_approvals (task_id, requested_at desc);

comment on table public.computer_approvals is
  'Human approval for one consequential browser click. token_hash is the sha256 '
  'of a single-use token the worker must present; the raw token is never stored.';

-- 2d. Audit (append-only) ----------------------------------------------------
-- No foreign key to tasks or jobs on purpose: the trail outlives a deleted
-- job. Rows go away only when the whole org is deleted.
create table if not exists public.computer_audit_events (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.orgs (id) on delete cascade,
  task_id         uuid,
  session_id      uuid,
  job_id          uuid,
  actor_kind      text not null check (actor_kind in ('agent', 'user', 'system')),
  actor_user_id   uuid,
  event           text not null check (length(btrim(event)) between 1 and 80),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists computer_audit_events_task_idx
  on public.computer_audit_events (task_id, id);

create index if not exists computer_audit_events_org_idx
  on public.computer_audit_events (org_id, created_at desc);

comment on table public.computer_audit_events is
  'Append-only trail of every Computer step, block, approval and live-view open. '
  'Live-view URLs, passwords and typed secrets are never written here.';

create or replace function public.computer_audit_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An org delete cascades here; let that through and nothing else.
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs o where o.id = old.org_id) then
      return old;
    end if;
  end if;
  raise exception 'computer_audit_events is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.computer_audit_events_append_only() from public, anon, authenticated;

drop trigger if exists computer_audit_events_no_update on public.computer_audit_events;
create trigger computer_audit_events_no_update
  before update or delete on public.computer_audit_events
  for each row execute function public.computer_audit_events_append_only();

drop trigger if exists computer_audit_events_no_truncate on public.computer_audit_events;
create trigger computer_audit_events_no_truncate
  before truncate on public.computer_audit_events
  for each statement execute function public.computer_audit_events_append_only();

-- 3. Service role only ---------------------------------------------------------
alter table public.computer_sessions enable row level security;
alter table public.computer_tasks enable row level security;
alter table public.computer_approvals enable row level security;
alter table public.computer_audit_events enable row level security;

drop policy if exists computer_sessions_no_user_access on public.computer_sessions;
create policy computer_sessions_no_user_access on public.computer_sessions
  for select to authenticated using (false);

drop policy if exists computer_tasks_no_user_access on public.computer_tasks;
create policy computer_tasks_no_user_access on public.computer_tasks
  for select to authenticated using (false);

drop policy if exists computer_approvals_no_user_access on public.computer_approvals;
create policy computer_approvals_no_user_access on public.computer_approvals
  for select to authenticated using (false);

drop policy if exists computer_audit_events_no_user_access on public.computer_audit_events;
create policy computer_audit_events_no_user_access on public.computer_audit_events
  for select to authenticated using (false);

revoke all on public.computer_sessions from anon, authenticated;
revoke all on public.computer_tasks from anon, authenticated;
revoke all on public.computer_approvals from anon, authenticated;
revoke all on public.computer_audit_events from anon, authenticated;
