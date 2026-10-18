-- Ask chat threads — many named chats per job (project), per user or progress-share.
-- Project = the job the user can access. Messages stay in job_proof_questions with thread_id.

create table if not exists public.ask_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  -- Owner is either a logged-in user (office member or homeowner grant) or a
  -- progress-share guest. Exactly one must be set.
  owner_user_id   uuid references public.profiles (id) on delete cascade,
  share_id        uuid references public.verifier_shares (id) on delete cascade,
  title           text not null default 'New chat'
                    check (length(btrim(title)) between 1 and 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz,
  constraint ask_threads_owner_xor check (
    (owner_user_id is not null and share_id is null)
    or (owner_user_id is null and share_id is not null)
  )
);

comment on table public.ask_threads is
  'Ask chat threads scoped to a job (project). One owner_user_id or share_id per thread; '
  'messages live in job_proof_questions.thread_id.';

create index if not exists ask_threads_user_job_idx
  on public.ask_threads (owner_user_id, job_id, last_message_at desc nulls last, created_at desc)
  where owner_user_id is not null;

create index if not exists ask_threads_share_job_idx
  on public.ask_threads (share_id, job_id, last_message_at desc nulls last, created_at desc)
  where share_id is not null;

create index if not exists ask_threads_job_idx
  on public.ask_threads (job_id, updated_at desc);

alter table public.job_proof_questions
  add column if not exists thread_id uuid references public.ask_threads (id) on delete set null;

create index if not exists job_proof_questions_thread_idx
  on public.job_proof_questions (thread_id, created_at asc)
  where thread_id is not null;

comment on column public.job_proof_questions.thread_id is
  'Ask chat thread this Q&A belongs to. Null = legacy pre-thread rows (migrated on open).';

-- Allow attaching legacy rows to a thread (BFF / org members). Answers stay append-only
-- via the existing delete-block; updates are for metadata like thread_id / not rewrite.
drop policy if exists job_proof_questions_update on public.job_proof_questions;
create policy job_proof_questions_update on public.job_proof_questions
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

alter table public.ask_threads enable row level security;

drop policy if exists ask_threads_select on public.ask_threads;
create policy ask_threads_select on public.ask_threads
  for select to authenticated
  using (
    private.is_org_member(org_id)
    or owner_user_id = auth.uid()
  );

drop policy if exists ask_threads_insert on public.ask_threads;
create policy ask_threads_insert on public.ask_threads
  for insert to authenticated
  with check (
    (private.is_org_member(org_id) and owner_user_id = auth.uid())
    or owner_user_id = auth.uid()
  );

drop policy if exists ask_threads_update on public.ask_threads;
create policy ask_threads_update on public.ask_threads
  for update to authenticated
  using (
    private.is_org_member(org_id)
    or owner_user_id = auth.uid()
  )
  with check (
    private.is_org_member(org_id)
    or owner_user_id = auth.uid()
  );

revoke all on public.ask_threads from anon;
grant select, insert, update on public.ask_threads to authenticated;
