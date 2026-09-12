-- Track when a claimed homeowner last opened the job file (/job-progress).
-- Guest /progress/:token opens already update verifier_shares.last_opened_at;
-- authenticated grant viewers need a durable stamp on the grant itself.

alter table public.job_progress_grants
  add column if not exists last_accessed_at timestamptz;

comment on column public.job_progress_grants.last_accessed_at is
  'Last time this user opened job progress for the job (authenticated grant).';

create index if not exists job_progress_grants_last_accessed_idx
  on public.job_progress_grants (job_id, last_accessed_at desc nulls last);
