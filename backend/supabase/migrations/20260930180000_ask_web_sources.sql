-- Web citations for a stored Ask answer.
--
-- The answer text stays plain. Clickable web links live in this column and
-- are rendered from it when a thread is loaded again. Empty when the answer
-- did not use the web.

alter table public.job_proof_questions
  add column if not exists web_sources jsonb not null default '[]'::jsonb;

comment on column public.job_proof_questions.web_sources is
  'Public web citations shown with this answer: title, http(s) url, and snippet. Empty when the answer did not use the web.';
