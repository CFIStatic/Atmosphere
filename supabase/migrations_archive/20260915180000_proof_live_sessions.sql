-- ---------------------------------------------------------------------------
-- Office live / near-live view of Field Capture while recording
-- ---------------------------------------------------------------------------
-- Field Capture already streams ~4–8 MB parts to storage while the camera
-- runs. This table is the office index: which clip is filming now, where its
-- parts live, and when the last part was minted. Playback lists contiguous
-- landed `.parts/` objects — no WebRTC SFU.
--
-- Privacy: live may be raw until analysis (child blur / private-moment ranges)
-- catches up after the film is filed. Documented in docs/office-live-view.md.

create table if not exists public.proof_live_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  party_id        uuid not null,
  clip_id         text not null
    check (clip_id ~ '^[a-zA-Z0-9_-]{6,64}$'),
  storage_path    text not null check (length(storage_path) between 1 and 500),
  work_date       date not null,
  phase           text not null check (phase in ('before', 'after')),
  extension       text not null default 'webm'
    check (extension ~ '^[a-z0-9]{2,5}$'),
  mime_type       text not null default 'video/webm'
    check (length(mime_type) between 1 and 80),
  status          text not null default 'live'
    check (status in ('live', 'ended')),
  last_mint_index integer not null default 0
    check (last_mint_index >= 0 and last_mint_index < 128),
  started_at      timestamptz not null default now(),
  last_part_at    timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.proof_live_sessions is
  'In-progress Field Capture stream-while-recording sessions for office Live view. '
  'Parts land under storage_path.parts/; office polls signed URLs for the contiguous prefix.';

create unique index if not exists proof_live_sessions_org_job_clip_uidx
  on public.proof_live_sessions (org_id, job_id, clip_id);

create index if not exists proof_live_sessions_job_live_idx
  on public.proof_live_sessions (org_id, job_id, status, last_part_at desc);

alter table public.proof_live_sessions enable row level security;

drop policy if exists proof_live_sessions_select_member on public.proof_live_sessions;
create policy proof_live_sessions_select_member on public.proof_live_sessions
  for select to authenticated
  using (private.is_org_member(org_id));

grant select on public.proof_live_sessions to authenticated;
grant all on public.proof_live_sessions to service_role;
