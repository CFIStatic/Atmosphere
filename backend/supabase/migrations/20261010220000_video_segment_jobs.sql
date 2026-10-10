-- Long recordings: saved, resumable segment jobs and the full-coverage base
-- timeline. Behind VIDEO_BASE_TIMELINE (off): nothing writes these tables
-- until that switch is on. Service-role only; no client grants.

create table if not exists public.video_segment_jobs (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.job_proofs (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  seg_index integer not null check (seg_index >= 0),
  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  lease_owner text,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  error text,
  output jsonb,
  cost_nanos bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_segment_jobs_range check (end_seconds > start_seconds),
  constraint video_segment_jobs_proof_seg unique (proof_id, seg_index)
);

create index if not exists video_segment_jobs_claim_idx
  on public.video_segment_jobs (status, next_attempt_at)
  where status in ('queued', 'running');

comment on table public.video_segment_jobs is
  'One row per ~10-min segment of a recording. Worker claims with claim_video_segment_job (SKIP LOCKED, lease); a crash leaves the lease to expire and another worker resumes. output holds captions + dead-time signals for the segment.';

create table if not exists public.video_timelines (
  proof_id uuid primary key references public.job_proofs (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  minutes jsonb not null default '[]'::jsonb,
  coverage_pct numeric,
  segment_count integer not null default 0,
  cost_nanos bigint not null default 0,
  caption_model text,
  updated_at timestamptz not null default now()
);

comment on table public.video_timelines is
  'Full-coverage minute-by-minute base timeline for a recording (captions + transcript + dead-time labels). Contractor-side data: never served to homeowner viewers.';

alter table public.video_segment_jobs enable row level security;
alter table public.video_timelines enable row level security;
revoke all on public.video_segment_jobs from public, anon, authenticated;
revoke all on public.video_timelines from public, anon, authenticated;
grant all on public.video_segment_jobs to service_role;
grant all on public.video_timelines to service_role;

create or replace function public.claim_video_segment_job(
  p_owner text,
  p_lease_seconds integer default 300
)
returns public.video_segment_jobs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.video_segment_jobs;
  v_secs integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'owner_required';
  end if;
  v_secs := greatest(coalesce(p_lease_seconds, 300), 30);

  update public.video_segment_jobs as j
     set lease_owner = btrim(p_owner),
         lease_until = now() + make_interval(secs => v_secs),
         status = 'running',
         attempts = j.attempts + 1,
         updated_at = now()
   where j.id = (
     select c.id
       from public.video_segment_jobs as c
      where c.status in ('queued', 'running')
        and c.next_attempt_at <= now()
        and (c.lease_until is null or c.lease_until < now())
      order by c.created_at, c.seg_index
      for update skip locked
      limit 1
   )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_video_segment_job(text, integer) is
  'Service-role SKIP LOCKED claim of one video_segment_jobs row whose lease is free or expired (resumes after a crash).';

revoke all on function public.claim_video_segment_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_video_segment_job(text, integer) to service_role;
