-- Answers grounded on a chat upload that is not attached to the job.
-- Office threads may read them. Share links and progress-grant viewers must not.

alter table public.job_proof_questions
  add column if not exists office_only boolean not null default false;

comment on column public.job_proof_questions.office_only is
  'True when the answer quotes a chat upload that is not attached to this job. Office threads may read it. Share links and progress-grant viewers must not.';
