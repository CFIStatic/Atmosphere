-- Manual clip names on the Videos list.
-- AI keeps writing short labels into job_proofs.title; a separate custom_title
-- lets the office override the painted name without erasing the AI label.
-- Empty / null custom_title → fall back to title (AI) everywhere the clip name shows.

alter table public.job_proofs
  add column if not exists custom_title text;

alter table public.job_proofs
  drop constraint if exists job_proofs_custom_title_len;

alter table public.job_proofs
  add constraint job_proofs_custom_title_len
  check (custom_title is null or char_length(btrim(custom_title)) between 1 and 80);

comment on column public.job_proofs.custom_title is
  'Optional office-chosen clip name. When set, the Videos list (and any other clip-name surface) shows this instead of title (AI). Null/empty falls back to title.';
