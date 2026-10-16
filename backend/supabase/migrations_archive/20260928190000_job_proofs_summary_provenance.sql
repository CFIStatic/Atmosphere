-- Which transcript an AI summary was built from, so a re-transcription can
-- mark it stale and re-queue it instead of leaving the old summary in place.
--
-- summary_status:
--   null     no summary has been tracked yet (rows from before this column)
--   stale    the transcript changed after the summary was built; a worker re-queues it
--   queued   on the summary retry queue
--   running  being rebuilt now (summary_lease_until guards a crashed worker)
--   done     built from the transcript whose hash is in summary_transcript_sha256
--   failed   every retry failed; summary_error says why
--
-- summary_transcript_sha256 is sha256 of the transcript_text the summary read
-- ('' when there was no transcript). Compare with the live transcript to tell
-- whether the summary on screen matches the raw transcript.

alter table public.job_proofs
  add column if not exists summary_status text,
  add column if not exists summary_transcript_sha256 text,
  add column if not exists summary_generated_at timestamptz,
  add column if not exists summary_error text,
  add column if not exists summary_lease_until timestamptz;

alter table public.job_proofs
  drop constraint if exists job_proofs_summary_status_check;

alter table public.job_proofs
  add constraint job_proofs_summary_status_check
  check (summary_status is null or summary_status in ('stale', 'queued', 'running', 'done', 'failed'));

create index if not exists job_proofs_summary_pending_idx
  on public.job_proofs (received_at)
  where deleted_at is null and summary_status in ('stale', 'queued', 'running');

comment on column public.job_proofs.summary_status is
  'AI summary (ai_findings.conversation / evidenceLog / people) freshness: stale | queued | running | done | failed. Null on rows never tracked.';
comment on column public.job_proofs.summary_transcript_sha256 is
  'sha256 of the transcript_text the AI summary was built from. Differs from the live transcript when the summary is stale.';
comment on column public.job_proofs.summary_generated_at is
  'When the AI summary was last rebuilt.';
comment on column public.job_proofs.summary_error is
  'Last error from the summary retry queue after every attempt failed.';
comment on column public.job_proofs.summary_lease_until is
  'Lease on a running summary rebuild; the sweep reclaims a running row after it expires.';
