-- Long-horizon Ask memory.
--
-- job_proof_questions stays the append-only record of what was asked and
-- answered. This migration does not alter that table, its trigger, or its
-- policies. It adds thread metadata: a rolling summary of older turns, and a
-- small set of durable notes. Both are redacted by the server before insert.
-- The summary is rewritten as the thread grows. Notes are inserted, not edited.

alter table public.ask_threads
  add column if not exists rolling_summary text,
  add column if not exists summary_through_question_id uuid,
  add column if not exists summary_turn_count integer not null default 0,
  add column if not exists summarized_at timestamptz;

comment on column public.ask_threads.rolling_summary is
  'Redacted summary of Ask turns older than the recent verbatim window. Regenerated as the thread grows. Not a custody record.';

comment on column public.ask_threads.summary_through_question_id is
  'Last question id folded into rolling_summary. Turns after this stay verbatim. Not a foreign key, so custody rows are untouched.';

comment on column public.ask_threads.summary_turn_count is
  'How many older exchanges rolling_summary covers.';

create table if not exists public.ask_job_notes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs (id) on delete cascade,
  job_id              uuid not null references public.crm_jobs (id) on delete cascade,
  thread_id           uuid not null references public.ask_threads (id) on delete cascade,
  owner_user_id       uuid references public.profiles (id) on delete cascade,
  share_id            uuid references public.verifier_shares (id) on delete cascade,
  note                text not null check (length(btrim(note)) between 1 and 400),
  -- Provenance only. No foreign key, so deleting or rewriting a custody
  -- answer is neither required nor possible from this table.
  source_question_id  uuid,
  created_at          timestamptz not null default now(),
  constraint ask_job_notes_owner_xor check (
    (owner_user_id is not null and share_id is null)
    or (owner_user_id is null and share_id is not null)
  )
);

comment on table public.ask_job_notes is
  'Durable preferences and decisions pulled from an Ask thread. Redacted before insert. Readable by that user or an org member. Older threads stay listed; a new thread does not delete these.';

comment on column public.ask_job_notes.source_question_id is
  'The Ask turn this note was pulled from. Stored as an id only; the custody row is not updated.';

create unique index if not exists ask_job_notes_owner_note_idx
  on public.ask_job_notes (job_id, owner_user_id, lower(btrim(note)))
  where owner_user_id is not null;

create unique index if not exists ask_job_notes_share_note_idx
  on public.ask_job_notes (job_id, share_id, lower(btrim(note)))
  where share_id is not null;

create index if not exists ask_job_notes_thread_idx
  on public.ask_job_notes (thread_id, created_at asc);

alter table public.ask_job_notes enable row level security;

drop policy if exists ask_job_notes_select on public.ask_job_notes;
create policy ask_job_notes_select on public.ask_job_notes
  for select to authenticated
  using (
    private.is_org_member(org_id)
    or owner_user_id = auth.uid()
  );

drop policy if exists ask_job_notes_insert on public.ask_job_notes;
create policy ask_job_notes_insert on public.ask_job_notes
  for insert to authenticated
  with check (
    (private.is_org_member(org_id) and owner_user_id = auth.uid())
    or owner_user_id = auth.uid()
  );

revoke all on public.ask_job_notes from anon;
grant select, insert on public.ask_job_notes to authenticated;
