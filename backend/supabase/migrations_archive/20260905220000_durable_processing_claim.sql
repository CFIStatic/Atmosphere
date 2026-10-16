-- Durable outbox claims for verification + proof work.
--
-- Wave 2 added lease_until columns. This adds SKIP LOCKED claim functions so
-- a worker (same BFF process, or WORKER_ROLE=queue) can take exactly one row
-- without racing another replica. The job/proof tables stay the outbox —
-- no new queue product.
--
-- analysis_lease_* mirrors narration/transcript so day-analysis that sat
-- `queued`/`running` in an in-memory RetryQueue can be stolen after a crash.

alter table public.job_proofs
  add column if not exists analysis_lease_owner text,
  add column if not exists analysis_lease_until timestamptz;

create index if not exists job_proofs_analysis_lease_idx
  on public.job_proofs (analysis_status, analysis_lease_until)
  where deleted_at is null
    and analysis_status in ('queued', 'running', 'failed');

comment on column public.job_proofs.analysis_lease_until is
  'Exclusive claim on day-analysis. Null or past = eligible for the worker.';

create or replace function public.claim_video_processing_job(
  p_owner text,
  p_lease_seconds integer default 90,
  p_id uuid default null
)
returns public.video_processing_jobs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.video_processing_jobs;
  v_secs integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'owner_required';
  end if;
  v_secs := greatest(coalesce(p_lease_seconds, 90), 15);

  update public.video_processing_jobs as j
     set lease_owner = btrim(p_owner),
         lease_until = now() + make_interval(secs => v_secs),
         status = case when j.status = 'pending' then 'running'::verification_step_status else j.status end,
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select c.id
       from public.video_processing_jobs as c
      where c.status in ('pending', 'running')
        and (p_id is null or c.id = p_id)
        and (
          c.lease_until is null
          or c.lease_until < now()
          or c.lease_owner = btrim(p_owner)
        )
      order by c.created_at
      for update skip locked
      limit 1
   )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_video_processing_job(text, integer, uuid) is
  'Service-role SKIP LOCKED claim of one video_processing_jobs row. p_id targets a row; omit to take the oldest free job.';

revoke all on function public.claim_video_processing_job(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_video_processing_job(text, integer, uuid) to service_role;

create or replace function public.claim_job_proof_work(
  p_kind text,
  p_owner text,
  p_lease_seconds integer default 90,
  p_id uuid default null
)
returns public.job_proofs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.job_proofs;
  v_secs integer;
  v_kind text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'owner_required';
  end if;
  v_kind := lower(btrim(coalesce(p_kind, '')));
  if v_kind not in ('narration', 'transcript', 'analysis') then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;
  v_secs := greatest(coalesce(p_lease_seconds, 90), 15);

  if v_kind = 'narration' then
    update public.job_proofs as j
       set narration_lease_owner = btrim(p_owner),
           narration_lease_until = now() + make_interval(secs => v_secs),
           narration_status = case
             when j.narration_status is null or j.narration_status in ('idle', 'queued')
               then 'running'
             else j.narration_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and (
            c.narration_status is null
            or c.narration_status in ('idle', 'skipped', 'failed', 'queued', 'running')
          )
          and (
            c.narration_lease_until is null
            or c.narration_lease_until < now()
            or c.narration_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  elsif v_kind = 'transcript' then
    update public.job_proofs as j
       set transcript_lease_owner = btrim(p_owner),
           transcript_lease_until = now() + make_interval(secs => v_secs),
           transcript_status = case
             when j.transcript_status is null or j.transcript_status in ('idle', 'queued')
               then 'running'
             else j.transcript_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and (
            c.transcript_status is null
            or c.transcript_status in ('idle', 'skipped', 'failed', 'queued', 'running')
          )
          and (
            c.transcript_lease_until is null
            or c.transcript_lease_until < now()
            or c.transcript_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  else
    update public.job_proofs as j
       set analysis_lease_owner = btrim(p_owner),
           analysis_lease_until = now() + make_interval(secs => v_secs),
           analysis_status = case
             when j.analysis_status = 'queued' then 'running'
             else j.analysis_status
           end
     where j.id = (
       select c.id
         from public.job_proofs as c
        where c.deleted_at is null
          and c.storage_path is not null
          and (p_id is null or c.id = p_id)
          and c.analysis_status in ('queued', 'running')
          and (
            c.analysis_lease_until is null
            or c.analysis_lease_until < now()
            or c.analysis_lease_owner = btrim(p_owner)
          )
        order by c.received_at nulls last, c.id
        for update skip locked
        limit 1
     )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

comment on function public.claim_job_proof_work(text, text, integer, uuid) is
  'Service-role SKIP LOCKED claim of one job_proofs narration/transcript/analysis lease.';

revoke all on function public.claim_job_proof_work(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_job_proof_work(text, text, integer, uuid) to service_role;
