-- ============================================================================
-- Mitigation Estimator
--
-- Apply with:  supabase db push
--        or:   paste into the Supabase SQL editor
--
-- Follows the same contract as the rest of the schema: every table has RLS on,
-- every policy resolves membership through `private.is_org_member`, and nothing
-- is reachable with the anon role. An estimate contains a claim number, a loss
-- address and an insured's name, so cross-organization visibility has to be
-- impossible at the database layer rather than merely absent from the queries.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Membership helpers
--
-- Kept in a private schema (not exposed as RPCs) so policies can call them
-- without widening the API surface, and marked STABLE + SECURITY DEFINER so a
-- policy on org_members does not recurse into itself.
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- Parameter name must match earlier migrations (p_org). CREATE OR REPLACE
-- FUNCTION cannot rename arguments (42P13) — that broke Supabase Preview.
create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table if not exists public.estimator_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  created_by      uuid not null references auth.users (id) on delete cascade,
  -- The agent's own job identifier, so re-running the same job updates rather
  -- than duplicating it.
  external_job_id text not null,
  name            text not null,
  claim_number    text,
  status          text not null default 'draft'
                    check (status in ('draft', 'review', 'submitted', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, external_job_id)
);

create index if not exists estimator_jobs_org_created_idx
  on public.estimator_jobs (org_id, created_at desc);

alter table public.estimator_jobs enable row level security;

drop policy if exists estimator_jobs_select on public.estimator_jobs;
create policy estimator_jobs_select on public.estimator_jobs
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists estimator_jobs_insert on public.estimator_jobs;
create policy estimator_jobs_insert on public.estimator_jobs
  for insert to authenticated
  with check (private.is_org_member(org_id) and created_by = auth.uid());

drop policy if exists estimator_jobs_update on public.estimator_jobs;
create policy estimator_jobs_update on public.estimator_jobs
  for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Estimates
--
-- The full estimate is stored as JSONB rather than shredded into line-item rows.
-- An estimate is an immutable snapshot — the assessment, the scope, the prices
-- and the settings that produced them, all at one moment. Re-running it later
-- against a newer price list must produce a *new* estimate, not silently mutate
-- the one that was already sent to a carrier. Denormalised totals are copied out
-- as columns so a list view never has to open the payload.
-- ---------------------------------------------------------------------------

create table if not exists public.estimator_estimates (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.estimator_jobs (id) on delete cascade,
  org_id              uuid not null references public.orgs (id) on delete cascade,
  created_by          uuid not null references auth.users (id) on delete cascade,
  payload             jsonb not null,
  subtotal            numeric(12, 2) not null default 0,
  total               numeric(12, 2) not null default 0,
  gross_margin        numeric(6, 4) not null default 0,
  recoverable_revenue numeric(12, 2) not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists estimator_estimates_job_idx
  on public.estimator_estimates (job_id, created_at desc);
create index if not exists estimator_estimates_org_idx
  on public.estimator_estimates (org_id, created_at desc);

alter table public.estimator_estimates enable row level security;

drop policy if exists estimator_estimates_select on public.estimator_estimates;
create policy estimator_estimates_select on public.estimator_estimates
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists estimator_estimates_insert on public.estimator_estimates;
create policy estimator_estimates_insert on public.estimator_estimates
  for insert to authenticated
  with check (private.is_org_member(org_id) and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Org estimating settings
-- ---------------------------------------------------------------------------

create table if not exists public.estimator_settings (
  org_id     uuid primary key references public.orgs (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.estimator_settings enable row level security;

drop policy if exists estimator_settings_select on public.estimator_settings;
create policy estimator_settings_select on public.estimator_settings
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists estimator_settings_write on public.estimator_settings;
create policy estimator_settings_write on public.estimator_settings
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Xactimate connection
--
-- `sealed_credential` holds an AES-256-GCM envelope whose key lives only in the
-- server's environment (XACTIMATE_ENC_KEY), never here — the same separation
-- that keeps the PIN table inert on its own. It is NULL for session-only
-- connections, which is the default and the recommended mode.
--
-- The policies are scoped to `user_id = auth.uid()`, deliberately narrower than
-- every other table in this file: an org's members can all see the org's
-- estimates, but nobody sees anyone else's Xactimate grant.
-- ---------------------------------------------------------------------------

create table if not exists public.xactimate_connections (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  org_id              uuid references public.orgs (id) on delete set null,
  consent_id          uuid not null,
  xactimate_username  text not null,
  scopes              text[] not null default '{}',
  storage_mode        text not null default 'session'
                        check (storage_mode in ('session', 'stored')),
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  granted_ip          text,
  granted_user_agent  text,
  sealed_credential   jsonb,
  price_list_id       text,
  -- Belt and braces: a revoked grant must never keep a credential, whatever a
  -- future code path forgets to null out.
  constraint xactimate_revoked_has_no_credential
    check (revoked_at is null or sealed_credential is null),
  -- A session-only connection has nothing to store, by definition.
  constraint xactimate_session_mode_stores_nothing
    check (storage_mode = 'stored' or sealed_credential is null)
);

alter table public.xactimate_connections enable row level security;

drop policy if exists xactimate_connections_own on public.xactimate_connections;
create policy xactimate_connections_own on public.xactimate_connections
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Xactimate activity log
--
-- Every action taken in a user's Xactimate account under their grant. Insert and
-- select only: an audit trail that can be edited is not an audit trail, so there
-- is deliberately no update or delete policy.
-- ---------------------------------------------------------------------------

create table if not exists public.xactimate_audit (
  id         uuid primary key default gen_random_uuid(),
  consent_id uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  scope      text not null,
  action     text not null,
  detail     text not null default '',
  succeeded  boolean not null default true,
  at         timestamptz not null default now()
);

create index if not exists xactimate_audit_user_idx
  on public.xactimate_audit (user_id, at desc);

alter table public.xactimate_audit enable row level security;

drop policy if exists xactimate_audit_select on public.xactimate_audit;
create policy xactimate_audit_select on public.xactimate_audit
  for select to authenticated using (user_id = auth.uid());

drop policy if exists xactimate_audit_insert on public.xactimate_audit;
create policy xactimate_audit_insert on public.xactimate_audit
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Price lists
--
-- Shared across the org: one person syncs, everyone estimates against the same
-- prices. That is the whole point — an org where each estimator carries their
-- own idea of the price list produces estimates that disagree with each other.
-- ---------------------------------------------------------------------------

create table if not exists public.xactimate_price_lists (
  org_id         uuid not null references public.orgs (id) on delete cascade,
  price_list_id  text not null,
  name           text not null,
  effective_date date,
  entries        jsonb not null default '[]'::jsonb,
  synced_by      uuid references auth.users (id) on delete set null,
  synced_at      timestamptz not null default now(),
  primary key (org_id, price_list_id)
);

alter table public.xactimate_price_lists enable row level security;

drop policy if exists xactimate_price_lists_select on public.xactimate_price_lists;
create policy xactimate_price_lists_select on public.xactimate_price_lists
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists xactimate_price_lists_write on public.xactimate_price_lists;
create policy xactimate_price_lists_write on public.xactimate_price_lists
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists estimator_jobs_touch on public.estimator_jobs;
create trigger estimator_jobs_touch
  before update on public.estimator_jobs
  for each row execute function public.touch_updated_at();

-- Nothing here is reachable without a session.
revoke all on public.estimator_jobs, public.estimator_estimates, public.estimator_settings,
              public.xactimate_connections, public.xactimate_audit, public.xactimate_price_lists
  from anon;
