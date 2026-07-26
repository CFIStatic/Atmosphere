-- ============================================================================
-- Atmosphere — Web Access
--
-- Org-scoped connections to external websites (carrier portals, supplier
-- sites, vendor dashboards) that the AI signs into on the org's behalf to pull
-- data out of and enter data into.
--
-- Run this once against the Supabase project (SQL editor, or psql). It is
-- idempotent: re-running it is safe.
--
-- Three tables, all with RLS enabled and reachable only through the caller's
-- JWT — same rule as the rest of the schema, so one org can never see another
-- org's connections or runs at the database layer.
--
--   web_connections  — the site, its label, and the username we sign in with.
--   web_credentials  — the sealed password. Split into its own table so a
--                      routine `select *` on a connection can never carry the
--                      secret material with it. The backend reads this table
--                      in exactly one place (the run executor).
--   web_runs         — one row per task the AI was asked to perform, with its
--                      step-by-step trace and result.
--
-- The stored password is sealed with AES-256-GCM by the backend before it ever
-- reaches Postgres, under a key (WEB_ACCESS_KEY) that lives only in the server
-- environment. A database leak alone therefore yields no usable credentials —
-- the same separation the device PIN pepper buys for PIN sign-in.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
create table if not exists public.web_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  created_by       uuid not null references auth.users (id) on delete cascade,

  label            text not null check (char_length(label) between 2 and 80),
  -- Where a run starts. Also the origin that bounds where the AI may navigate.
  site_url         text not null,
  -- The page carrying the sign-in form, when it differs from site_url.
  login_url        text,
  username         text not null,

  status           text not null default 'unverified'
                     check (status in ('unverified', 'verified', 'failed')),
  last_verified_at timestamptz,
  last_error       text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One label per org keeps the picker unambiguous when a team runs several
  -- logins against the same carrier.
  unique (org_id, label)
);

create index if not exists web_connections_org_idx on public.web_connections (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Sealed credentials
-- ---------------------------------------------------------------------------
create table if not exists public.web_credentials (
  connection_id uuid primary key references public.web_connections (id) on delete cascade,
  -- Denormalised so the RLS policy can be evaluated without joining back to
  -- the parent row (and so a policy can never be satisfied by a dangling row).
  org_id        uuid not null references public.orgs (id) on delete cascade,

  ciphertext    text not null,
  iv            text not null,
  auth_tag      text not null,
  key_version   integer not null default 1,

  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
create table if not exists public.web_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  connection_id uuid not null references public.web_connections (id) on delete cascade,
  created_by    uuid not null references auth.users (id) on delete cascade,

  -- 'pull' reads data out of the site; 'push' enters data into it.
  kind          text not null check (kind in ('pull', 'push')),
  instruction   text not null check (char_length(instruction) between 4 and 4000),
  -- Rows to enter, for a push. Null for a pull.
  input_data    jsonb,

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'succeeded', 'failed')),
  -- What the AI reported back: the extracted records, or a summary of what it
  -- entered.
  result        jsonb,
  -- Ordered trace of every action taken, so a run is auditable after the fact.
  steps         jsonb not null default '[]'::jsonb,
  error         text,

  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists web_runs_org_idx on public.web_runs (org_id, created_at desc);
create index if not exists web_runs_connection_idx on public.web_runs (connection_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Membership is read straight off org_members. That table's own policies still
-- apply to the subquery, so this cannot be used to widen a caller's view — and
-- because none of these policies read the table they protect, there is no
-- recursion to work around.
-- ---------------------------------------------------------------------------
alter table public.web_connections enable row level security;
alter table public.web_credentials enable row level security;
alter table public.web_runs        enable row level security;

drop policy if exists web_connections_rw on public.web_connections;
create policy web_connections_rw on public.web_connections
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists web_credentials_rw on public.web_credentials;
create policy web_credentials_rw on public.web_credentials
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists web_runs_rw on public.web_runs;
create policy web_runs_rw on public.web_runs
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.web_access_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists web_connections_touch on public.web_connections;
create trigger web_connections_touch
  before update on public.web_connections
  for each row execute function public.web_access_touch_updated_at();

drop trigger if exists web_credentials_touch on public.web_credentials;
create trigger web_credentials_touch
  before update on public.web_credentials
  for each row execute function public.web_access_touch_updated_at();
