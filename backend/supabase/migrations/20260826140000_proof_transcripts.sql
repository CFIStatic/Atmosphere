-- Mic speech on every filed day film.
-- Vision already lands on ai_summary / narration_*. This is the matching
-- column set for what was said on the recording, so the office can ask the
-- collection using both the picture and the mic.

alter table public.job_proofs
  add column if not exists transcript_status text
    check (transcript_status in ('idle', 'queued', 'running', 'done', 'skipped', 'failed'));

alter table public.job_proofs
  add column if not exists transcript_text text;

alter table public.job_proofs
  add column if not exists transcript_error text;

alter table public.job_proofs
  add column if not exists transcribed_at timestamptz;

update public.job_proofs
  set transcript_status = 'idle'
  where transcript_status is null;

alter table public.job_proofs
  alter column transcript_status set default 'idle';

comment on column public.job_proofs.transcript_status is
  'Speech-to-text of the filed video. idle until queued; skipped when no transcriber is configured.';

comment on column public.job_proofs.transcript_text is
  'What was heard on the mic. Null until a run finishes. Never a substitute for the frames.';
