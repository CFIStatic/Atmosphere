-- Construction Estimator
--
-- Two tables: the encrypted vendor credentials the agent signs in with, and the
-- runs it produces. Both are org-scoped and protected by Row Level Security, so
-- the database — not application code — is the boundary between organizations.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the SQL
-- editor. Safe to re-run.

-- Membership predicate used by every policy below.
--
-- It lives in a private schema and is SECURITY DEFINER for the same reason the
-- onboarding helpers do: evaluating a policy on `estimator_*` must not re-enter
-- RLS on `org_members`, and nothing here should be reachable as an RPC.
create schema if not exists private;

create or replace function private.estimator_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

revoke all on function private.estimator_is_org_member(uuid) from public, anon, authenticated;
grant execute on function private.estimator_is_org_member(uuid) to authenticated;

-- Roles permitted to connect the organization to a third-party system. A stored
-- credential acts on behalf of the whole org, so this is not something every
-- member should be able to change.
create or replace function private.estimator_can_manage_credentials(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('project_manager', 'office_manager')
  );
$$;

revoke all on function private.estimator_can_manage_credentials(uuid) from public, anon, authenticated;
grant execute on function private.estimator_can_manage_credentials(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
--
-- Only ciphertext is stored. The AES-256-GCM key lives in the server's
-- ESTIMATOR_CREDENTIAL_KEY environment variable and deliberately never reaches
-- Postgres, so a database leak alone yields nothing usable. `base_url` and
-- `fingerprint` sit outside the sealed blob so the UI can show which host and
-- which secret are configured without decrypting anything.

create table if not exists public.estimator_credentials (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  provider     text not null check (provider in ('docusketch', 'dash', 'xactimate')),
  label        text,
  ciphertext   text not null,
  iv           text not null,
  auth_tag     text not null,
  fingerprint  text not null,
  base_url     text,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One credential per provider per org: the agent signs in as the
  -- organization, not as an individual.
  unique (org_id, provider)
);

create index if not exists estimator_credentials_org_idx
  on public.estimator_credentials (org_id);

alter table public.estimator_credentials enable row level security;

drop policy if exists estimator_credentials_select on public.estimator_credentials;
create policy estimator_credentials_select
  on public.estimator_credentials
  for select
  to authenticated
  using (private.estimator_is_org_member(org_id));

drop policy if exists estimator_credentials_insert on public.estimator_credentials;
create policy estimator_credentials_insert
  on public.estimator_credentials
  for insert
  to authenticated
  with check (private.estimator_can_manage_credentials(org_id));

drop policy if exists estimator_credentials_update on public.estimator_credentials;
create policy estimator_credentials_update
  on public.estimator_credentials
  for update
  to authenticated
  using (private.estimator_can_manage_credentials(org_id))
  with check (private.estimator_can_manage_credentials(org_id));

drop policy if exists estimator_credentials_delete on public.estimator_credentials;
create policy estimator_credentials_delete
  on public.estimator_credentials
  for delete
  to authenticated
  using (private.estimator_can_manage_credentials(org_id));


-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
--
-- One row per estimator run, updated in place as each stage completes. The
-- intermediate artefacts (scan, job, observations, mitigation) are persisted
-- rather than held in memory so a run that stops for review can resume without
-- re-downloading the scan or re-reading forty photos.

create table if not exists public.estimator_runs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs (id) on delete cascade,
  created_by          uuid not null references auth.users (id) on delete cascade,

  status              text not null default 'running'
                        check (status in ('running', 'awaiting_review', 'complete', 'failed', 'cancelled')),
  stage               text not null default 'queued',

  scan_project_id     text not null,
  crm_job_id          text,
  match_score         numeric(5, 1),
  match_needs_review  boolean not null default false,
  match_candidates    jsonb not null default '[]'::jsonb,
  match_reason        text,

  scan_project        jsonb,
  job                 jsonb,
  observations        jsonb not null default '[]'::jsonb,
  mitigation          jsonb,
  estimate            jsonb,

  -- Reference returned by the estimating platform once the estimate is written.
  -- Its presence is the record that this run touched a customer's account.
  export_ref          text,
  error               text,
  events              jsonb not null default '[]'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists estimator_runs_org_created_idx
  on public.estimator_runs (org_id, created_at desc);

alter table public.estimator_runs enable row level security;

-- Runs are visible to the whole organization: an estimate is team work, and a
-- PM has to be able to review a run a field tech started.
drop policy if exists estimator_runs_select on public.estimator_runs;
create policy estimator_runs_select
  on public.estimator_runs
  for select
  to authenticated
  using (private.estimator_is_org_member(org_id));

drop policy if exists estimator_runs_insert on public.estimator_runs;
create policy estimator_runs_insert
  on public.estimator_runs
  for insert
  to authenticated
  with check (
    private.estimator_is_org_member(org_id)
    and created_by = auth.uid()
  );

drop policy if exists estimator_runs_update on public.estimator_runs;
create policy estimator_runs_update
  on public.estimator_runs
  for update
  to authenticated
  using (private.estimator_is_org_member(org_id))
  with check (private.estimator_is_org_member(org_id));

drop policy if exists estimator_runs_delete on public.estimator_runs;
create policy estimator_runs_delete
  on public.estimator_runs
  for delete
  to authenticated
  using (private.estimator_is_org_member(org_id));
