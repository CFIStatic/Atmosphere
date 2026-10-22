-- Homeowner permissions per job file.
--
-- The general contractor decides, per job, what the invited homeowner may see
-- and do. One row per job; no row means every permission is on, which is what
-- homeowners get today (the carbon copy of the contractor's job file). The
-- contractor-private data that homeowners never see (pay, disputes, internal
-- and analyst notes, buttons that change the job) is not here: that stays
-- hidden regardless of these settings.
--
-- Written only by the server (service role) after it checks the caller is a
-- member of the job's workspace. Workspace members can read their workspace's
-- rows. Homeowners read their permissions through the server, never directly.
--
-- Enforcement in the database: homeowners can read job_proofs rows directly
-- with their user token (job_proofs_select_progress_grant). A row carries the
-- video path, transcript and AI summary together, so direct reads are now
-- allowed only while videos, transcripts and AI summaries are all on for that
-- job, and only for clips past the job's sharing delay (or shared early, and
-- not held; see job_homeowner_releases). The app reads clips through the
-- server, which applies each permission separately.

create table if not exists public.job_homeowner_permissions (
  job_id              uuid primary key references public.crm_jobs (id) on delete cascade,
  org_id              uuid not null references public.orgs (id) on delete cascade,
  see_videos          boolean not null default true,
  see_transcripts     boolean not null default true,
  see_ai_summaries    boolean not null default true,
  see_scope           boolean not null default true,
  see_evidence_report boolean not null default true,
  see_access_list     boolean not null default true,
  use_chat            boolean not null default true,
  download_files      boolean not null default true,
  share_delay_hours   integer not null default 0 check (share_delay_hours in (0, 24, 48, 72)),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null
);

comment on table public.job_homeowner_permissions is
  'What the invited homeowner may see and do on one job file. No row = everything on (the default). Written by the BFF (service role); office members read their workspace''s rows.';

create index if not exists job_homeowner_permissions_org_idx
  on public.job_homeowner_permissions (org_id);

alter table public.job_homeowner_permissions enable row level security;

drop policy if exists job_homeowner_permissions_select on public.job_homeowner_permissions;
create policy job_homeowner_permissions_select on public.job_homeowner_permissions
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.job_homeowner_permissions from anon, authenticated;
revoke all on public.job_homeowner_permissions from anon;
grant select on public.job_homeowner_permissions to authenticated;
grant select, insert, update, delete on public.job_homeowner_permissions to service_role;

-- Per-clip homeowner sharing overrides: share one clip before the delay is
-- up ('share_now') or keep it from the homeowner until changed ('hold').
create table if not exists public.job_homeowner_releases (
  proof_id    uuid primary key references public.job_proofs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  org_id      uuid not null references public.orgs (id) on delete cascade,
  mode        text not null check (mode in ('share_now', 'hold')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.job_homeowner_releases is
  'Office overrides of the homeowner sharing delay for one clip. Written by the BFF (service role); office members read their workspace''s rows.';

create index if not exists job_homeowner_releases_job_idx on public.job_homeowner_releases (job_id);

alter table public.job_homeowner_releases enable row level security;

drop policy if exists job_homeowner_releases_select on public.job_homeowner_releases;
create policy job_homeowner_releases_select on public.job_homeowner_releases
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.job_homeowner_releases from anon, authenticated;
revoke all on public.job_homeowner_releases from anon;
grant select on public.job_homeowner_releases to authenticated;
grant select, insert, update, delete on public.job_homeowner_releases to service_role;

-- True while a homeowner may read this clip row directly: videos,
-- transcripts and AI summaries are all on for the job (or no settings row),
-- the clip is not held, and it was shared early or its delay is up.
create or replace function private.homeowner_may_read_proof_row(p_job_id uuid, p_proof_id uuid, p_received_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    not exists (
      select 1 from public.job_homeowner_permissions p
      where p.job_id = p_job_id
        and not (p.see_videos and p.see_transcripts and p.see_ai_summaries)
    )
    and not exists (
      select 1 from public.job_homeowner_releases r
      where r.proof_id = p_proof_id and r.mode = 'hold'
    )
    and (
      exists (
        select 1 from public.job_homeowner_releases r
        where r.proof_id = p_proof_id and r.mode = 'share_now'
      )
      or coalesce(p_received_at, '-infinity'::timestamptz)
         + make_interval(hours => coalesce(
             (select p.share_delay_hours from public.job_homeowner_permissions p where p.job_id = p_job_id), 0))
         <= now()
    );
$function$;

revoke all on function private.homeowner_may_read_proof_row(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.homeowner_may_read_proof_row(uuid, uuid, timestamptz) to authenticated;

drop policy if exists job_proofs_select_progress_grant on public.job_proofs;
create policy job_proofs_select_progress_grant on public.job_proofs
  as permissive for select to authenticated
  using (
    deleted_at is null
    and private.has_job_progress_grant(job_id)
    and private.homeowner_may_read_proof_row(job_id, id, received_at)
  );
