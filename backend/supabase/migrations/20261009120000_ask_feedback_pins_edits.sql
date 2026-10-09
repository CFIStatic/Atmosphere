-- Chat: answer feedback, pinned answers, and edited questions.
--
-- Questions and answers stay append-only (job_proof_questions_immutable). An
-- edited question is a new row that points at the one it replaces; the old
-- row is kept as the record of what was asked and answered.

alter table public.job_proof_questions
  add column if not exists supersedes_id uuid references public.job_proof_questions (id) on delete set null;

comment on column public.job_proof_questions.supersedes_id is
  'Set when the person edited an earlier question and asked again. The earlier row stays as the record; chat shows this one in its place.';

create index if not exists job_proof_questions_supersedes_idx
  on public.job_proof_questions (supersedes_id)
  where supersedes_id is not null;

-- ---------------------------------------------------------------------------
-- Thumbs up / down on an answer, one per person per answer.
-- ---------------------------------------------------------------------------
create table if not exists public.ask_answer_feedback (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  question_id uuid not null references public.job_proof_questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  rating      smallint not null check (rating in (-1, 1)),
  reason      text check (reason is null or reason in ('wrong', 'incomplete', 'not_on_file', 'unclear', 'other')),
  comment     text check (comment is null or length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ask_answer_feedback_one_per_person unique (question_id, user_id)
);

comment on table public.ask_answer_feedback is
  'Chat answer ratings (thumbs up / down, optional reason). Written by the BFF; staff analytics read it with the service role.';

create index if not exists ask_answer_feedback_org_idx
  on public.ask_answer_feedback (org_id, created_at desc);

alter table public.ask_answer_feedback enable row level security;

drop policy if exists ask_answer_feedback_own on public.ask_answer_feedback;
create policy ask_answer_feedback_own on public.ask_answer_feedback
  for all to authenticated
  using (user_id = auth.uid() and private.is_org_member(org_id))
  with check (user_id = auth.uid() and private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Answers pinned to the job file, visible to everyone in the org on that job.
-- ---------------------------------------------------------------------------
create table if not exists public.ask_pinned_answers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  question_id uuid not null references public.job_proof_questions (id) on delete cascade,
  pinned_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ask_pinned_answers_once unique (question_id)
);

comment on table public.ask_pinned_answers is
  'Chat answers pinned to a job file so the whole team sees them. The Q&A itself stays in job_proof_questions.';

create index if not exists ask_pinned_answers_job_idx
  on public.ask_pinned_answers (org_id, job_id, created_at desc);

alter table public.ask_pinned_answers enable row level security;

drop policy if exists ask_pinned_answers_org on public.ask_pinned_answers;
create policy ask_pinned_answers_org on public.ask_pinned_answers
  for all to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

grant select, insert, update, delete on public.ask_answer_feedback to authenticated;
grant select, insert, delete on public.ask_pinned_answers to authenticated;
