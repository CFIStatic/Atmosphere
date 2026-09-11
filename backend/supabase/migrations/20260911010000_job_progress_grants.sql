-- Read-only homeowner / viewer access claimed from a progress-share invite.
-- Not org_members: no Field Capture seats, no billing seat, no create_org.

create table if not exists public.job_progress_grants (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  job_id           uuid not null references public.crm_jobs (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  share_id         uuid references public.verifier_shares (id) on delete set null,
  recipient_email  text not null,
  created_at       timestamptz not null default now(),
  constraint job_progress_grants_job_user unique (job_id, user_id)
);

create index if not exists job_progress_grants_user_idx
  on public.job_progress_grants (user_id, created_at desc);

create index if not exists job_progress_grants_org_idx
  on public.job_progress_grants (org_id, job_id);

comment on table public.job_progress_grants is
  'Homeowner/viewer job-file access claimed from a progress share. Not an org seat.';

alter table public.job_progress_grants enable row level security;

-- Callers read via the BFF (service role). Authenticated users may see their own grants.
drop policy if exists job_progress_grants_select_own on public.job_progress_grants;
create policy job_progress_grants_select_own on public.job_progress_grants
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.job_progress_grants from anon;
grant select on public.job_progress_grants to authenticated;
