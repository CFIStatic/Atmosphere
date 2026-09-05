-- Lease columns so a live BFF can steal verification work after a mid-job
-- crash without waiting for process restart. Boot reclaim still works when
-- these columns are absent (older DBs); the worker falls back.

alter table public.video_processing_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_until timestamptz;

create index if not exists video_processing_jobs_lease_idx
  on public.video_processing_jobs (status, lease_until)
  where status in ('pending', 'running');

comment on column public.video_processing_jobs.lease_owner is
  'Replica / process that currently runs this job. Stolen when lease_until passes.';
comment on column public.video_processing_jobs.lease_until is
  'Exclusive claim. Null or past = eligible for reclaim.';
