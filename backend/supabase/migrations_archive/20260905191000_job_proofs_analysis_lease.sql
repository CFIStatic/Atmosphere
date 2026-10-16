-- Lease columns so a live BFF can steal proof narration / transcript work
-- after a mid-job crash without waiting for the 5-minute sweep. Older DBs
-- without these columns still sweep by status (queued / running / idle).

alter table public.job_proofs
  add column if not exists narration_lease_owner text,
  add column if not exists narration_lease_until timestamptz,
  add column if not exists transcript_lease_owner text,
  add column if not exists transcript_lease_until timestamptz;

create index if not exists job_proofs_narration_lease_idx
  on public.job_proofs (narration_status, narration_lease_until)
  where deleted_at is null
    and narration_status in ('queued', 'running', 'idle', 'skipped', 'failed');

create index if not exists job_proofs_transcript_lease_idx
  on public.job_proofs (transcript_status, transcript_lease_until)
  where deleted_at is null
    and transcript_status in ('queued', 'running', 'idle', 'skipped', 'failed');

comment on column public.job_proofs.narration_lease_until is
  'Exclusive claim on vision narration. Null or past = eligible for sweep.';
comment on column public.job_proofs.transcript_lease_until is
  'Exclusive claim on speech transcript. Null or past = eligible for sweep.';
