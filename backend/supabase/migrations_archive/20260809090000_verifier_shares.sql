-- ---------------------------------------------------------------------------
-- Verifier shares
-- ---------------------------------------------------------------------------
-- The evidence portal's outward door. An adjuster settling a supplement or an
-- attorney reading a job back later does not get an account and does not get
-- the console — they get a link scoped to one job's evidence, revocable, with
-- an expiry, and every open on the record.
--
-- Same construction as the subcontractor's job link, and for the same reason:
-- the token never touches PostgREST. It is exchanged server-side for a scoped
-- read, so a leaked link exposes exactly one job's evidence until somebody
-- revokes it — never a session, never the org.

create table if not exists public.verifier_shares (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,

  -- Who this link is for, in words the custody log will carry forever:
  -- "R. Calloway — Alliance Mutual". Required, because an access log entry
  -- reading "someone with the link" is barely a log entry.
  label         text not null check (length(btrim(label)) between 2 and 200),

  access_token  text not null unique default encode(gen_random_bytes(24), 'hex'),

  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Null means the share lives until revoked. The route defaults to 30 days;
  -- open-ended is a deliberate choice, not an accident of omission.
  expires_at    timestamptz,
  revoked_at    timestamptz,

  -- Bookkeeping for the management list, updated on exchange. The per-clip
  -- record lives in job_evidence_access, not here.
  last_opened_at timestamptz,
  open_count     integer not null default 0
);

create index if not exists verifier_shares_job_idx
  on public.verifier_shares (job_id, created_at desc);

comment on table public.verifier_shares is
  'Scoped external access to one job''s evidence. The token is exchanged '
  'server-side, never used against PostgREST directly.';

alter table public.verifier_shares enable row level security;

-- Members manage their org's shares. The token column is visible to them —
-- they created the link and have to be able to copy it — but no anon or
-- external path can query this table at all.
drop policy if exists verifier_shares_select on public.verifier_shares;
create policy verifier_shares_select on public.verifier_shares
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists verifier_shares_insert on public.verifier_shares;
create policy verifier_shares_insert on public.verifier_shares
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists verifier_shares_update on public.verifier_shares;
create policy verifier_shares_update on public.verifier_shares
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

revoke all on public.verifier_shares from anon;
