-- ---------------------------------------------------------------------------
-- The shared job record
-- ---------------------------------------------------------------------------
-- One job, two companies, and everything that goes wrong between them.
--
-- A general contractor hires subs. The money is lost in a narrow set of places
-- and they are all the same failure underneath — the two sides were working
-- from different facts:
--
--   "Who told you to demo that wall?"        Work done that was never in scope.
--   "The super said it was fine."            A decision with no record.
--   "I was working off the old scope."       A change nobody was told about.
--   "We were never approved for that."       Work started before the gate.
--
-- None of these are communication problems in the sense of people not talking.
-- They are record problems: everything was said out loud, on a phone, in a
-- truck, and nothing survived it. So this is not a chat feature with a job
-- attached. It is a record, with a conversation attached.
--
-- Three ideas run through the whole schema:
--
--   Out of scope is written down. A scope list that only says what to do
--   leaves "and nothing else" to be inferred. The most expensive line on a job
--   is the one somebody assumed was included, so exclusions are first-class
--   rows a sub has to acknowledge, not an absence.
--
--   Acknowledgement is a fact with a timestamp. "They knew" is an argument.
--   "Accepted 14:22 on the 3rd, revision 4" is a record. And when a revision
--   supersedes what was accepted, the acknowledgement lapses rather than
--   silently carrying over.
--
--   Decisions happen before the work, or they are not decisions. A change
--   request is raised, priced and answered while the crew is still standing
--   there. Approving it afterwards is a negotiation, which is what everyone is
--   trying to avoid.

-- ---------------------------------------------------------------------------
-- Who is on the job, from the other company
-- ---------------------------------------------------------------------------
-- Subs do not have seats. They work for six general contractors and will not
-- keep an account with any of them, so access is a per-job, per-party token —
-- the same shape as the unsubscribe token, and revocable the same way.

create table if not exists public.job_parties (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,

  company      text not null check (length(btrim(company)) between 1 and 160),
  -- The trade, as it would be said on site: 'framing', 'electrical', 'drywall'.
  trade        text check (trade is null or length(trade) <= 60),
  contact_name text,
  email        text,
  phone        text,

  role         text not null default 'subcontractor'
                 check (role in ('general_contractor', 'subcontractor', 'owner', 'adjuster')),

  -- Random, never derived from anything about the party. Deriving it would let
  -- anyone who knows an email address guess their way into a job record.
  access_token text not null default encode(gen_random_bytes(24), 'base64'),
  invited_at   timestamptz,
  last_seen_at timestamptz,
  -- Set rather than deleted: who had access during any past window is part of
  -- the record, and a dispute six months out asks exactly that.
  revoked_at   timestamptz,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists job_parties_token_unique on public.job_parties (access_token);
create index if not exists job_parties_job_idx on public.job_parties (job_id, created_at);
create index if not exists job_parties_org_idx on public.job_parties (org_id, job_id);

comment on table public.job_parties is
  'A company on the other side of a job. Access is a per-job token because subs '
  'do not keep accounts with their general contractors.';

-- ---------------------------------------------------------------------------
-- The facts, versioned
-- ---------------------------------------------------------------------------
-- Address, claim number, permit, approved amount, site access, who to call.
-- Dull, and the single most common thing to be out of date on one side.
--
-- A new revision rather than an edit, because "the scope changed and nobody
-- told me" is only answerable if there is a before. Revisions are append-only;
-- the trigger below refuses updates outright.

create table if not exists public.job_briefs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,

  revision     integer not null,
  -- Free-shaped on purpose: what matters differs by trade, and forcing a
  -- roofer's facts into a plumber's columns produces empty fields and lies.
  facts        jsonb not null default '{}'::jsonb,
  note         text check (note is null or length(note) <= 2000),

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint job_briefs_revision_unique unique (job_id, revision)
);

create index if not exists job_briefs_job_idx on public.job_briefs (job_id, revision desc);

create or replace function private.job_brief_next_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.revision is null or new.revision = 0 then
    select coalesce(max(revision), 0) + 1 into new.revision
    from public.job_briefs where job_id = new.job_id;
  end if;
  return new;
end;
$$;

drop trigger if exists job_briefs_number on public.job_briefs;
create trigger job_briefs_number
  before insert on public.job_briefs
  for each row execute function private.job_brief_next_revision();

create or replace function private.job_briefs_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A brief revision is a record of what was true. Publish a new revision instead.';
end;
$$;

drop trigger if exists job_briefs_immutable on public.job_briefs;
create trigger job_briefs_immutable
  before update or delete on public.job_briefs
  for each row execute function private.job_briefs_append_only();

-- ---------------------------------------------------------------------------
-- Scope, including what is deliberately not in it
-- ---------------------------------------------------------------------------

do $$ begin
  create type job_scope_state as enum (
    'included',   -- do this
    'excluded',   -- explicitly do NOT do this
    'proposed',   -- somebody has asked; nobody has answered
    'approved',   -- asked and answered yes, with a price
    'declined'    -- asked and answered no
  );
exception when duplicate_object then null; end $$;

create table if not exists public.job_scope_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,
  -- Which party this line is for. Null means it applies to everyone on the job.
  party_id     uuid references public.job_parties (id) on delete cascade,

  state        job_scope_state not null default 'included',
  title        text not null check (length(btrim(title)) between 2 and 200),
  detail       text check (detail is null or length(detail) <= 4000),
  amount       numeric(12, 2) check (amount is null or amount >= 0),

  -- The reason an exclusion exists. "Owner is handling flooring" prevents the
  -- helpful sub who does it anyway; "not in scope" does not.
  reason       text check (reason is null or length(reason) <= 1000),

  -- Which brief revision this line belongs to, so an acknowledgement can be
  -- tied to a version of the truth rather than to a moment in time.
  revision     integer not null default 1,

  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- An answered line has to say who answered it and when. Without this the
  -- state is an assertion; with it, it is a record.
  constraint job_scope_decided_together check (
    (state in ('approved', 'declined')) = (decided_at is not null)
  ),
  -- Approving work without a number is how a backcharge argument starts.
  constraint job_scope_approved_has_amount check (
    state <> 'approved' or amount is not null
  )
);

create index if not exists job_scope_job_idx on public.job_scope_items (job_id, state, created_at);
create index if not exists job_scope_party_idx on public.job_scope_items (party_id, state);

comment on table public.job_scope_items is
  'What to do, and what deliberately not to do. Exclusions are rows rather than '
  'an absence, because the expensive line is the one somebody assumed.';

-- ---------------------------------------------------------------------------
-- Acknowledgement
-- ---------------------------------------------------------------------------
-- Tied to a brief revision. When a newer revision is published the old
-- acknowledgement stays true about what it covered and stops being true about
-- what is current — which is precisely what the dashboard needs to show.

create table if not exists public.job_acknowledgements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,
  party_id     uuid not null references public.job_parties (id) on delete cascade,

  revision     integer not null,
  -- Copied in at the time. Resolving who by join would rewrite history the
  -- first time somebody changes their contact name.
  acknowledged_name text,
  acknowledged_at   timestamptz not null default now(),

  constraint job_ack_once unique (party_id, revision)
);

create index if not exists job_ack_job_idx on public.job_acknowledgements (job_id, revision desc);

-- ---------------------------------------------------------------------------
-- The conversation
-- ---------------------------------------------------------------------------
-- Immutable, because a record that can be edited afterwards is not a record.
-- Corrections are new messages, which is how a paper file works and how every
-- dispute over one is settled.

create table if not exists public.job_messages (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,

  -- Exactly one of these. A message is from a seat-holder or from a party.
  author_id    uuid references public.profiles (id) on delete set null,
  party_id     uuid references public.job_parties (id) on delete set null,
  author_label text not null check (length(btrim(author_label)) between 1 and 160),

  body         text not null check (length(btrim(body)) between 1 and 4000),
  -- A message can hang off a scope line or a change request, which is what
  -- turns "we discussed it" into "we discussed this line".
  scope_item_id uuid references public.job_scope_items (id) on delete set null,

  -- Marks the message as the thing that answered a question, so a thread does
  -- not have to be re-read to find out how it ended.
  is_decision  boolean not null default false,

  created_at   timestamptz not null default now()
);

create index if not exists job_messages_job_idx on public.job_messages (job_id, created_at desc);
create index if not exists job_messages_scope_idx on public.job_messages (scope_item_id, created_at);

create or replace function private.job_messages_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Messages on a shared job record cannot be edited or deleted. Post a correction.';
end;
$$;

drop trigger if exists job_messages_immutable on public.job_messages;
create trigger job_messages_immutable
  before update or delete on public.job_messages
  for each row execute function private.job_messages_append_only();

comment on table public.job_messages is
  'The thread on a shared job. Append-only: a record that can be edited after '
  'the fact settles no argument.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Every table is org-scoped for seat-holders. The external party never reaches
-- these through PostgREST at all — their token is exchanged at the API for a
-- narrowed, server-side read. A token that granted direct table access would be
-- a bearer credential for a whole org's row set, sitting in an email.

do $$
declare t text;
begin
  foreach t in array array[
    'job_parties', 'job_briefs', 'job_scope_items', 'job_acknowledgements', 'job_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t || '_insert', t);
  end loop;

  -- Updates only where a row is meant to change. Briefs and messages have
  -- triggers that refuse regardless; the absence of a policy is the first line.
  foreach t in array array['job_parties', 'job_scope_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_org_member(org_id))
         with check (private.is_org_member(org_id))', t || '_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- What needs attention
-- ---------------------------------------------------------------------------
-- The dashboard's whole job in one view: per job and party, whether they are
-- working from the current facts and whether anything is waiting on an answer.

create or replace view public.job_share_status
with (security_invoker = true) as
select
  p.org_id,
  p.job_id,
  p.id                            as party_id,
  p.company,
  p.trade,
  p.role,
  p.invited_at,
  p.last_seen_at,
  p.revoked_at,
  b.revision                      as current_revision,
  a.revision                      as acknowledged_revision,
  -- The line that matters. Not "did they ever accept" but "have they accepted
  -- what is true now".
  (a.revision is not null and a.revision = b.revision) as up_to_date,
  coalesce(s.proposed, 0)         as awaiting_answer,
  coalesce(s.excluded, 0)         as exclusions
from public.job_parties p
left join lateral (
  select max(revision) as revision from public.job_briefs where job_id = p.job_id
) b on true
left join lateral (
  select max(revision) as revision from public.job_acknowledgements where party_id = p.id
) a on true
left join lateral (
  select
    count(*) filter (where state = 'proposed') as proposed,
    count(*) filter (where state = 'excluded') as excluded
  from public.job_scope_items
  where job_id = p.job_id and (party_id is null or party_id = p.id)
) s on true;

comment on view public.job_share_status is
  'Per party: are they working from the current revision, and is anything '
  'waiting on an answer. The two questions the shared dashboard exists to ask.';
