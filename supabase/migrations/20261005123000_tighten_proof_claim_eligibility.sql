-- Stop Disk IO burn from narration/transcript claim thrash.
--
-- claim_job_proof_work treated failed/skipped/idle/null as forever-claimable.
-- Workers reclaimed those rows every lease expiry, wrote lease + status rows,
-- and replayed failed transcript/narration until WAL ate the Disk IO Budget
-- (~1M+ job_proofs status updates observed in pg_stat_statements).
--
-- Align narration/transcript with analysis: only queued + running (expired
-- lease) are claimable. Explicit re-queue sets status back to queued.
-- null/idle still count as first-time work so older rows keep progressing.

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
            or c.narration_status in ('idle', 'queued', 'running')
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
            or c.transcript_status in ('idle', 'queued', 'running')
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
  'Service-role SKIP LOCKED claim of one job_proofs narration/transcript/analysis lease. '
  'Narration/transcript: null/idle/queued/running only — failed and skipped are not auto-retried.';

-- Narrow lease indexes so planners prefer them for the tightened filter.
drop index if exists public.job_proofs_narration_lease_idx;
create index job_proofs_narration_lease_idx
  on public.job_proofs (narration_status, narration_lease_until)
  where deleted_at is null
    and (
      narration_status is null
      or narration_status in ('idle', 'queued', 'running')
    );

drop index if exists public.job_proofs_transcript_lease_idx;
create index job_proofs_transcript_lease_idx
  on public.job_proofs (transcript_status, transcript_lease_until)
  where deleted_at is null
    and (
      transcript_status is null
      or transcript_status in ('idle', 'queued', 'running')
    );
