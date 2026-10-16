-- ---------------------------------------------------------------------------
-- One subcontractor, six general contractors — and how a job gets here at all
-- ---------------------------------------------------------------------------
-- Two problems that look separate and are not.
--
-- THE SUB'S SIDE. A general contractor requires their subs to use this, so a
-- drywall crew that works for six GCs gets six invitations, on three jobs
-- each, as eighteen text messages containing eighteen links. Today the system
-- has no object that means "this sub" — job_parties is per (org, job), by
-- design, because subs do not keep accounts with their general contractors.
-- That design is right and stays. What it lacks is a way for the sub to find
-- the link for the house they are parked in front of.
--
-- So: an IDENTITY, keyed on a channel the sub actually controls (their phone
-- or their email), which tokens attach themselves to when claimed. The token
-- remains the credential for first contact — a sub can read the scope and
-- film without ever verifying anything, and that zero-friction first open is
-- the whole reason the GC can get their subs onto it. Verifying is what buys
-- the sub one screen with every job on it, across every GC.
--
-- Three rules keep this from becoming a leak:
--
--   Identity is only ever a verified channel. Two GCs both typing "Mike's
--   Drywall" is not evidence they mean the same company, and merging on a
--   typed name would silently join two businesses' job lists. Names are
--   never matched. Only a code sent to a phone or an inbox creates identity.
--
--   A general contractor sees claims on their own invitations and nothing
--   else. Which of their links got claimed, and by which channel, is theirs —
--   it answers "did they ever actually open it". That a sub also works for a
--   competitor is not theirs, and no policy here exposes it. The sub's own
--   cross-GC list is served through the service role against a session the
--   sub holds, so the isolation is structural rather than a filtered query
--   somebody must remember to write.
--
--   One party, one claimant. A token that two people claim is a token whose
--   "who saw this" is worthless, so the claim is unique on the party.
--
-- THE OFFICE'S SIDE. A job arrives one of three ways: synced from the
-- customer's CRM, read out of an uploaded scope document, or typed by a
-- person before the crew leaves. All three are legitimate; they are not
-- equally good, and until now nothing recorded which happened or what it
-- cost. A job with no address can be filmed but never checked as on-site. A
-- job with no scope can be filmed but never judged. The crew finds out
-- afterwards, which is the worst possible time.
--
-- job_intake records the provenance. Readiness is computed from it in
-- application code, and it never blocks filming — it forecasts, before the
-- truck leaves, the strongest verdict this job can currently produce. That is
-- the same rule the analyst already follows (unknown is not a pass), moved
-- earlier in time where it is still cheap to fix.

-- ---------------------------------------------------------------------------
-- Who the sub is, across every general contractor
-- ---------------------------------------------------------------------------

create table if not exists public.field_identities (
  id          uuid primary key default gen_random_uuid(),
  -- 'sms' or 'email'. The channel is part of the key: a phone and an inbox
  -- are different proofs of control and are never treated as the same person
  -- unless the sub verifies both.
  channel     text not null check (channel in ('sms', 'email')),
  -- Normalized at the edge: E.164 for phones, lowercased for email. Stored
  -- normalized so the unique index below actually means what it says.
  address     text not null check (length(btrim(address)) between 3 and 254),
  -- What to call them. Taken from the first party row they claim, and only
  -- ever a convenience — never used to match or merge.
  display_name text,
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint field_identities_channel_address_unique unique (channel, address)
);

comment on table public.field_identities is
  'A subcontractor as themselves, not as a row on one GC''s job. Keyed on a '
  'verified phone or inbox; never matched on company name.';

alter table public.field_identities enable row level security;

-- Deny-all for users. These rows span organizations by construction, so no
-- org-scoped policy could be correct: the service role is the only reader,
-- and it always reads one identity resolved from a session the sub holds.
drop policy if exists field_identities_no_user_access on public.field_identities;
create policy field_identities_no_user_access on public.field_identities
  for select to authenticated using (false);

revoke all on public.field_identities from anon;

-- ---------------------------------------------------------------------------
-- Proving control of the channel
-- ---------------------------------------------------------------------------
-- Short-lived, hashed, attempt-capped. The code is never stored in a form
-- that reading this table would reveal, expiry is a column rather than a
-- cleanup job's promise, and a burned code is consumed rather than deleted so
-- that replaying it fails loudly instead of looking like a fresh request.

create table if not exists public.field_identity_codes (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('sms', 'email')),
  address     text not null,
  -- sha256 of the six digits. Stored hex.
  code_hash   text not null check (length(code_hash) = 64),
  -- Which invitation this claim is for. A code is good for one party, so a
  -- code intercepted from one job cannot be spent on another.
  party_id    uuid not null references public.job_parties (id) on delete cascade,
  attempts    smallint not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists field_identity_codes_lookup
  on public.field_identity_codes (party_id, address, created_at desc)
  where consumed_at is null;

comment on table public.field_identity_codes is
  'One-time codes proving a sub controls the phone or inbox they claimed with. '
  'Hashed, expiring, attempt-capped, and scoped to a single invitation.';

alter table public.field_identity_codes enable row level security;

drop policy if exists field_identity_codes_no_user_access on public.field_identity_codes;
create policy field_identity_codes_no_user_access on public.field_identity_codes
  for select to authenticated using (false);

revoke all on public.field_identity_codes from anon;

-- ---------------------------------------------------------------------------
-- The claim: this invitation belongs to this person
-- ---------------------------------------------------------------------------

create table if not exists public.job_party_claims (
  id          uuid primary key default gen_random_uuid(),
  -- Denormalized from the party so a general contractor's policy can be
  -- written without a join, and so revoking access to an org's rows is a
  -- single predicate rather than a traversal.
  org_id      uuid not null references public.orgs (id) on delete cascade,
  party_id    uuid not null references public.job_parties (id) on delete cascade,
  identity_id uuid not null references public.field_identities (id) on delete cascade,
  claimed_at  timestamptz not null default now(),

  -- One party, one claimant: a link two people hold is a link whose access
  -- record means nothing.
  constraint job_party_claims_one_per_party unique (party_id)
);

create index if not exists job_party_claims_identity_idx
  on public.job_party_claims (identity_id, claimed_at desc);
create index if not exists job_party_claims_org_idx on public.job_party_claims (org_id);

comment on table public.job_party_claims is
  'A per-job invitation, claimed by a verified identity. The GC may read '
  'claims on their own invitations; nothing here exposes a sub''s other GCs.';

alter table public.job_party_claims enable row level security;

-- A general contractor sees who claimed the links they sent. That is the
-- audit answer to "did they ever open it" and it stops at their own org.
drop policy if exists job_party_claims_select on public.job_party_claims;
create policy job_party_claims_select on public.job_party_claims
  for select to authenticated using (private.is_org_member(org_id));

-- No write policies: claiming happens through the service role after a code
-- is verified, which is the only place the verification can be enforced.

revoke all on public.job_party_claims from anon;

-- ---------------------------------------------------------------------------
-- The sub's session
-- ---------------------------------------------------------------------------
-- After verifying once, the phone keeps an opaque token. Hashed at rest for
-- the same reason the codes are: a leaked backup of this table must not be a
-- set of working credentials.

create table if not exists public.field_sessions (
  id          uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.field_identities (id) on delete cascade,
  token_hash  text not null check (length(token_hash) = 64),
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,

  constraint field_sessions_token_unique unique (token_hash)
);

create index if not exists field_sessions_identity_idx
  on public.field_sessions (identity_id) where revoked_at is null;

comment on table public.field_sessions is
  'The durable credential a subcontractor''s phone keeps after verifying once, '
  'so finding today''s job is one tap instead of eighteen text messages.';

alter table public.field_sessions enable row level security;

drop policy if exists field_sessions_no_user_access on public.field_sessions;
create policy field_sessions_no_user_access on public.field_sessions
  for select to authenticated using (false);

revoke all on public.field_sessions from anon;

-- ---------------------------------------------------------------------------
-- How the job got here
-- ---------------------------------------------------------------------------
-- One row per job, written by whichever path created it. The source is a
-- closed set because an open one degrades into free text nobody can count,
-- and counting is the point: an org whose jobs are 90% 'manual' has a CRM
-- connector waiting to be sold to them.

create table if not exists public.job_intake (
  job_id     uuid primary key references public.crm_jobs (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,

  -- Three values, and all three are written by real code paths. A vocabulary
  -- with a value nothing can produce is a vocabulary that lies to whoever
  -- counts it.
  --
  --   crm_sync       the connector created this job file from the customer's
  --                  own system of record.
  --   manual         somebody typed it, generally standing next to a truck.
  --   scope_document the earliest recorded origin of this job's information
  --                  is a document somebody uploaded and confirmed — used
  --                  when a job predates intake tracking and a scope document
  --                  is the first provenance it ever gets.
  source     text not null check (source in ('crm_sync', 'scope_document', 'manual')),
  -- Where exactly: {"system":"jobnimbus","externalId":"..."} for a sync,
  -- {"documentId":"..."} for a document. Free-form because each source knows
  -- different things, but always present enough to trace the job back.
  source_detail jsonb not null default '{}'::jsonb,

  entered_by uuid references public.profiles (id) on delete set null,
  entered_at timestamptz not null default now()
);

create index if not exists job_intake_org_source_idx on public.job_intake (org_id, source);

comment on table public.job_intake is
  'How this job file came to exist: synced, read from a document, or typed. '
  'Readiness is computed from it — a job may always be filmed, but what can '
  'be concluded from the footage depends on what arrived with the job.';

alter table public.job_intake enable row level security;

drop policy if exists job_intake_select on public.job_intake;
create policy job_intake_select on public.job_intake
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists job_intake_insert on public.job_intake;
create policy job_intake_insert on public.job_intake
  for insert to authenticated with check (private.is_org_member(org_id));

revoke all on public.job_intake from anon;
