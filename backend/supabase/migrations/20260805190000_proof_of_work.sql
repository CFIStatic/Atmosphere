-- ---------------------------------------------------------------------------
-- Proof of work
-- ---------------------------------------------------------------------------
-- A subcontractor films the site before they start and again when they finish,
-- every day they are on the job. The general contractor gets a record, and
-- money moves against it.
--
-- That last clause changes everything about how this is built. The moment a
-- video releases a payment, the video is worth money, and every cheap way to
-- cheat has to fail:
--
--   film a different house · re-upload yesterday's after as today's before ·
--   film at 7am and upload at 7pm to claim a day that was two hours ·
--   four seconds of a clean room · film the after first
--
-- So the row carries the facts those checks need — position, capture time, byte
-- hash, duration — and it carries them as recorded rather than as asserted. The
-- device says when it was filmed; the server says when it arrived; both are
-- stored, because the gap between them is itself evidence.
--
-- Nothing here computes a verdict. The checks live in code (proofVerifier.ts)
-- where they are testable, and the results are written back as findings. A
-- schema that stored "verified: true" would be storing an opinion as a fact,
-- and the whole point is the difference between the two.

do $$ begin
  create type job_proof_phase as enum ('before', 'after');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_proof_state as enum (
    'uploaded',   -- the file is here, nothing has looked at it
    'checked',    -- the verifier has run
    'analysed',   -- the model has read the frames
    'accepted',   -- a human signed off. Only this releases money.
    'rejected'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.job_proofs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,
  party_id     uuid not null references public.job_parties (id) on delete cascade,

  -- The day this is filed against, in the site's local reckoning. Separate from
  -- captured_at on purpose: a crew finishing at 1am is still working Tuesday,
  -- and the mismatch between the two is one of the things worth checking.
  work_date    date not null,
  phase        job_proof_phase not null,

  -- Where the file lives. Videos never pass through the API — the device
  -- uploads to storage directly and posts the key here.
  storage_path text not null,
  byte_size    bigint check (byte_size is null or byte_size > 0),
  duration_seconds numeric(8, 2) check (duration_seconds is null or duration_seconds >= 0),
  -- SHA-256 of the file. The cheapest fraud is the same bytes twice, and this
  -- is the cheapest way to catch it.
  content_hash text,

  -- What the device claims, and what the server observed. Both, always.
  captured_at  timestamptz,
  received_at  timestamptz not null default now(),

  lat          double precision check (lat is null or (lat between -90 and 90)),
  lon          double precision check (lon is null or (lon between -180 and 180)),
  accuracy_m   double precision check (accuracy_m is null or accuracy_m >= 0),

  state        job_proof_state not null default 'uploaded',
  -- The verifier's findings, as written by proofVerifier.ts. Stored rather than
  -- recomputed so the record shows what was known at the time a human decided.
  checks       jsonb not null default '[]'::jsonb,

  -- What the model saw. Null until analysed, and null is honest — a day with no
  -- analysis reads as "not analysed", where a fabricated one reads as evidence.
  ai_summary   text,
  ai_findings  jsonb,
  ai_model     text,

  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  decided_note text check (decided_note is null or length(decided_note) <= 1000),

  created_at   timestamptz not null default now(),

  -- One before and one after per party per day. A second attempt has to
  -- replace deliberately rather than pile up, because two "after" videos with
  -- different content is an argument nobody can settle.
  constraint job_proofs_one_per_phase unique (party_id, work_date, phase),
  -- A decision has to say who and when. Without it the state is an assertion.
  constraint job_proofs_decided_together check (
    (state in ('accepted', 'rejected')) = (decided_at is not null)
  )
);

create index if not exists job_proofs_job_idx on public.job_proofs (job_id, work_date desc);
create index if not exists job_proofs_party_idx on public.job_proofs (party_id, work_date desc);
-- The re-upload check reads this on every upload, so it has to be an index
-- lookup rather than a scan of a season's video history.
create index if not exists job_proofs_hash_idx on public.job_proofs (job_id, content_hash)
  where content_hash is not null;

comment on table public.job_proofs is
  'One video per party per day per phase. Carries what the device claimed and '
  'what the server observed, because the gap between them is evidence.';

-- ---------------------------------------------------------------------------
-- Frames
-- ---------------------------------------------------------------------------
-- Extracted on the device, not the server. A phone can already draw a video
-- frame to a canvas; doing it there means the server needs no video toolchain,
-- and a handful of stills is both what a vision model can read and a fraction
-- of the bytes of the clip they came from.

create table if not exists public.job_proof_frames (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  proof_id     uuid not null references public.job_proofs (id) on delete cascade,

  at_seconds   numeric(8, 2) not null check (at_seconds >= 0),
  storage_path text not null,

  created_at   timestamptz not null default now(),
  constraint job_proof_frames_once unique (proof_id, at_seconds)
);

create index if not exists job_proof_frames_proof_idx
  on public.job_proof_frames (proof_id, at_seconds);

-- ---------------------------------------------------------------------------
-- Questions a project manager asked
-- ---------------------------------------------------------------------------
-- Kept, because the answer was given from a record that will keep growing. Six
-- weeks later "you told me the subfloor was done" needs the question, the
-- answer, and the date it was answered on.

create table if not exists public.job_proof_questions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,

  question     text not null check (length(btrim(question)) between 3 and 1000),
  answer       text,
  model        text,
  -- Which days the answer was drawn from, so it can be checked rather than
  -- trusted.
  grounded_on  jsonb not null default '[]'::jsonb,

  asked_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists job_proof_questions_job_idx
  on public.job_proof_questions (job_id, created_at desc);

-- A question and its answer are a record of what somebody was told. Editing
-- either afterwards is how "you said it was done" becomes unanswerable.
create or replace function private.job_proof_questions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A question and its answer are a record of what somebody was told. Ask again instead.';
end;
$$;

drop trigger if exists job_proof_questions_immutable on public.job_proof_questions;
create trigger job_proof_questions_immutable
  before delete on public.job_proof_questions
  for each row execute function private.job_proof_questions_append_only();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Seat-holders read and write within their org. The subcontractor uploading
-- never reaches these tables directly — their token is exchanged at the API for
-- a narrowed, server-side write, same as the rest of the shared record.

do $$
declare t text;
begin
  foreach t in array array['job_proofs', 'job_proof_frames', 'job_proof_questions'] loop
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

  -- Only proofs are updated by a seat-holder — accepting or rejecting a day.
  execute 'drop policy if exists job_proofs_update on public.job_proofs';
  execute
    'create policy job_proofs_update on public.job_proofs for update to authenticated
       using (private.is_org_member(org_id))
       with check (private.is_org_member(org_id))';
end $$;

-- ---------------------------------------------------------------------------
-- The day view
-- ---------------------------------------------------------------------------
-- Proof is filed per video; it is read per day, because a day is the unit of
-- work and the unit of payment. Pairing them in a view keeps that join in one
-- place rather than in every caller.

create or replace view public.job_proof_days
with (security_invoker = true) as
select
  p.org_id,
  p.job_id,
  p.party_id,
  p.work_date,
  max(case when p.phase = 'before' then p.id end)         as before_id,
  max(case when p.phase = 'after'  then p.id end)         as after_id,
  max(case when p.phase = 'before' then p.captured_at end) as before_at,
  max(case when p.phase = 'after'  then p.captured_at end) as after_at,
  -- Accepted only when a human accepted both halves. Anything less is a day
  -- somebody has not finished looking at.
  bool_and(p.state = 'accepted')                           as accepted,
  bool_or(p.state = 'rejected')                            as rejected,
  count(*)                                                 as videos,
  max(p.ai_summary) filter (where p.phase = 'after')       as summary
from public.job_proofs p
group by p.org_id, p.job_id, p.party_id, p.work_date;

comment on view public.job_proof_days is
  'Before and after paired by day, which is the unit of work and of payment.';
