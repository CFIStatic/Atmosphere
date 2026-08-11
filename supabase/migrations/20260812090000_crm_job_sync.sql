-- ---------------------------------------------------------------------------
-- Job files sync in from the CRM the customer already runs
-- ---------------------------------------------------------------------------
-- Most companies that buy work verification already have a CRM, and the job
-- file should exist before the first video without anybody retyping an
-- address. So the CRM becomes a *source* of job identity — never a system of
-- record for evidence.
--
-- Two tables, two different trust levels:
--
-- crm_sync_connections holds the sealed credential for the customer's own
-- CRM account, one row per org per system. Same construction as
-- crm_oauth_grants and for the same reason: the credential belongs to one
-- customer, so it has to be stored — AES-256-GCM sealed with a key that
-- lives only in the server environment, deny-all RLS, service role only.
-- What the UI may know (which system, whose account, when, how the last
-- sync went) is served by the API, never read from this table by a user.
--
-- crm_job_links is the reconciliation ledger: which external CRM job became
-- which Atmosphere job file. Members may read it — provenance is not a
-- secret, and "where did this job file come from" is a fair question — but
-- only the service role writes it, because sync is the only writer.
--
-- Three rules the link table encodes:
--
--   The CRM supplies identity only. Title, claim number, address. Evidence,
--   scope, custody and status transitions are never written by sync.
--
--   An address is load-bearing once footage exists. The "filmed on site"
--   check measures against the job's property coordinates, so a CRM-side
--   address edit on a job that already holds evidence does not apply — it
--   parks in `pending` until a person decides. Moving a geofence under
--   existing evidence is not an update, it is a decision.
--
--   Evidence outlives the CRM row. A job deleted in the CRM archives the
--   link; it never deletes the job file. Footage does not evaporate because
--   somebody tidied their pipeline.

create table if not exists public.crm_sync_connections (
  org_id        uuid not null references public.orgs (id) on delete cascade,
  system        text not null check (system in ('jobnimbus', 'acculynx', 'dash', 'servicetitan')),
  iv            text not null,
  tag           text not null,
  ciphertext    text not null,
  account_label text,
  connected_by  uuid references public.profiles (id) on delete set null,
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz,
  last_summary  jsonb,
  primary key (org_id, system)
);

comment on table public.crm_sync_connections is
  'Sealed credentials for a customer''s own CRM, used to sync job identity. '
  'Deny-all RLS: the connect flow writes it, the sync path reads it, and no '
  'request in between ever needs to see it.';

alter table public.crm_sync_connections enable row level security;

-- Deny-all for users, exactly like crm_oauth_grants: the presence of a
-- select policy that always refuses makes the intent auditable.
drop policy if exists crm_sync_connections_no_user_access on public.crm_sync_connections;
create policy crm_sync_connections_no_user_access on public.crm_sync_connections
  for select to authenticated using (false);

revoke all on public.crm_sync_connections from anon;

create table if not exists public.crm_job_links (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  system        text not null check (system in ('jobnimbus', 'acculynx', 'dash', 'servicetitan')),
  external_id   text not null check (length(btrim(external_id)) between 1 and 120),
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,
  -- Hash of the identity fields as last applied; an unchanged hash is a
  -- sync no-op, which is what makes re-running sync free.
  identity_hash text not null,
  -- A parked change awaiting a person: today only an address move on a job
  -- that already holds evidence. The payload is the incoming address.
  pending       jsonb,
  pending_kind  text check (pending_kind in ('address_moved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Set when the external job disappears from the CRM. The link is kept as
  -- the record that it existed; the job file is not touched.
  archived_at   timestamptz,
  constraint crm_job_links_one_external unique (org_id, system, external_id),
  -- A parked change always says what kind it is, and a kind always has a
  -- payload — half a conflict is a bug.
  constraint crm_job_links_pending_pair check ((pending is null) = (pending_kind is null))
);

create index if not exists crm_job_links_job_idx on public.crm_job_links (job_id);
create index if not exists crm_job_links_pending_idx
  on public.crm_job_links (org_id) where pending is not null;

comment on table public.crm_job_links is
  'Which external CRM job became which Atmosphere job file. Sync is the only '
  'writer; members may read their org''s rows because provenance is not a secret.';
comment on column public.crm_job_links.pending is
  'An incoming change that will not apply itself: an address move on a job '
  'with evidence waits here for a person, because the geofence hangs off it.';

alter table public.crm_job_links enable row level security;

drop policy if exists crm_job_links_select on public.crm_job_links;
create policy crm_job_links_select on public.crm_job_links
  for select to authenticated using (private.is_org_member(org_id));

-- No insert/update/delete policies for authenticated: the service role is
-- the only writer, which is the point.

revoke all on public.crm_job_links from anon;
