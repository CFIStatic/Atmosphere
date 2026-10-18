-- Chat uploads sent with an office Ask turn.
-- Reloading that thread sends the same ids again. Share links and grant
-- viewers do not receive the column.

alter table public.job_proof_questions
  add column if not exists document_ids uuid[] not null default '{}';

comment on column public.job_proof_questions.document_ids is
  'Chat document ids sent with this office question. The office thread reloads them so a follow-up can answer from the same upload. Share links and progress-grant listings omit the values.';
