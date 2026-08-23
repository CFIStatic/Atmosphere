-- A short H.264 cut from the recorded file, for the Dashboard preview cell.
-- The original (often a duration-less WebM) stays the evidence; this is
-- what the list can actually play.

alter table public.job_proofs
  add column if not exists preview_storage_path text;

comment on column public.job_proofs.preview_storage_path is
  'Object in job-proofs holding a few seconds of this recording as H.264. '
  'Cut from the filed file — never a placeholder or a demo pattern.';
