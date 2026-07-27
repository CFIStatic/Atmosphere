-- ============================================================================
-- Atmosphere — Verifier
--
-- The second agent. Web Access marks a run `succeeded` on the strength of the
-- first agent calling `finish(succeeded: true)` — the model grading its own
-- homework. If it believed it submitted a form that the site quietly rejected,
-- the run still reads "succeeded" and nobody finds out until a human happens to
-- look.
--
-- The verifier closes that gap. After a run reports success it opens the site
-- again, in a fresh browser with a fresh sign-in, and checks the work is
-- actually there — against expectations derived from the ORIGINAL instruction,
-- never from the first agent's account of what it did. Three outcomes:
--
--   satisfied      the work is there. Done.
--   violated       the work is missing or wrong. Repair it, then re-check.
--   indeterminate  it cannot tell. Ask a human — never guess.
--
-- Run this once against the Supabase project (SQL editor, or psql), after
-- web_access.sql. It is idempotent: re-running it is safe.
--
--   web_verifications — one row per verification pass over a run, carrying the
--                       expectations checked, what was found for each, and the
--                       verifier's own browse trace.
--   web_escalations   — a question put to a human when the verifier could not
--                       settle it alone, with the evidence and the choices.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Verifications
-- ---------------------------------------------------------------------------
create table if not exists public.web_verifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  run_id          uuid not null references public.web_runs (id) on delete cascade,
  connection_id   uuid not null references public.web_connections (id) on delete cascade,

  -- Who asked for this pass. Null when the run finished and the verifier
  -- enqueued itself, which is the ordinary case — the whole point is that
  -- nobody has to know to ask.
  requested_by    uuid references auth.users (id) on delete set null,

  status          text not null default 'queued'
                    check (status in (
                      'queued',      -- waiting for a browser
                      'running',     -- observing, or repairing
                      'verified',    -- the work was there
                      'repaired',    -- it was not, the verifier fixed it, re-checked, and it is now
                      'escalated',   -- a human has been asked
                      'rejected',    -- a human looked and confirmed the work was not done
                      'failed',      -- the verifier itself could not run
                      'cancelled'    -- superseded, or the run/connection went away
                    )),

  -- The verdict of the most recent observation pass, across all expectations.
  verdict         text check (verdict in ('satisfied', 'violated', 'indeterminate')),

  -- The checkable claims this pass was testing, derived from the run's original
  -- instruction and input data. Stored so a reader can see what "verified"
  -- actually meant, and so a re-check tests the same thing.
  expectations    jsonb not null default '[]'::jsonb,
  -- One finding per expectation: its verdict, the evidence, and where it was
  -- seen. This is what makes a verdict auditable rather than an assertion.
  findings        jsonb not null default '[]'::jsonb,
  -- The verifier's own trace, kept separate from the run's. Two independent
  -- accounts of the same site is the point; merging them would lose that.
  steps           jsonb not null default '[]'::jsonb,

  -- Bounded, and recorded: a verifier that can retry forever is a verifier that
  -- can hammer someone else's system forever.
  repair_attempts integer not null default 0,

  summary         text,
  error           text,

  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists web_verifications_org_idx
  on public.web_verifications (org_id, created_at desc);
create index if not exists web_verifications_run_idx
  on public.web_verifications (run_id, created_at desc);

-- A run may be verified more than once — a re-check after a human resolves an
-- escalation is a new pass, and keeping both is the audit trail. But only one
-- may be in flight at a time: two browsers verifying the same run would double
-- any repair they decided to make.
create unique index if not exists web_verifications_one_active_per_run
  on public.web_verifications (run_id)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Escalations
--
-- What the verifier does when it is unsure. Deliberately not a log line: it
-- carries a question, the evidence behind it, and the specific choices a human
-- can pick from, because "something looked wrong with run 41" is not something
-- anyone can act on three days later.
-- ---------------------------------------------------------------------------
create table if not exists public.web_escalations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  verification_id uuid not null references public.web_verifications (id) on delete cascade,
  run_id          uuid not null references public.web_runs (id) on delete cascade,

  -- Why it stopped. One of:
  --   indeterminate    the site did not clearly show whether the work landed
  --   unsafe_repair    the fix would destroy or duplicate something
  --   repair_exhausted repairs ran out without the check passing
  --   repair_failed    the repair attempt itself errored
  reason          text not null default 'indeterminate'
                    check (reason in (
                      'indeterminate', 'unsafe_repair', 'repair_exhausted', 'repair_failed'
                    )),

  question        text not null check (char_length(question) between 4 and 2000),
  -- What the verifier saw: the expectation it could not settle, the page text
  -- it read, and the URL. Enough to decide without opening the site yourself.
  context         jsonb not null default '{}'::jsonb,
  -- The choices offered, each { id, label, detail, action }. `action` is what
  -- the verifier will do with the answer, so a human is picking an outcome
  -- rather than writing a prompt.
  options         jsonb not null default '[]'::jsonb,

  status          text not null default 'open'
                    check (status in ('open', 'resolved', 'dismissed')),

  -- Which option id was chosen, plus anything the person typed alongside it.
  chosen_option   text,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists web_escalations_org_open_idx
  on public.web_escalations (org_id, status, created_at desc);
create index if not exists web_escalations_verification_idx
  on public.web_escalations (verification_id, created_at desc);

-- One open question per verification. Asking the same team the same thing twice
-- is how an escalation queue stops being read.
create unique index if not exists web_escalations_one_open_per_verification
  on public.web_escalations (verification_id)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Same rule as the rest of the schema: membership is read straight off
-- org_members, that table's own policies still apply to the subquery, and none
-- of these policies read the table they protect, so there is no recursion.
-- ---------------------------------------------------------------------------
alter table public.web_verifications enable row level security;
alter table public.web_escalations   enable row level security;

drop policy if exists web_verifications_rw on public.web_verifications;
create policy web_verifications_rw on public.web_verifications
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists web_escalations_rw on public.web_escalations;
create policy web_escalations_rw on public.web_escalations
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
--
-- Reuses the Web Access trigger function, which already pins search_path empty
-- and fully qualifies now().
-- ---------------------------------------------------------------------------
drop trigger if exists web_verifications_touch on public.web_verifications;
create trigger web_verifications_touch
  before update on public.web_verifications
  for each row execute function public.web_access_touch_updated_at();

drop trigger if exists web_escalations_touch on public.web_escalations;
create trigger web_escalations_touch
  before update on public.web_escalations
  for each row execute function public.web_access_touch_updated_at();
