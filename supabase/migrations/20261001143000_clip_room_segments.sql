-- Clip room segments, attached to the job's physical room.
--
-- job_locations (kind = room) is the room identity for a job: the same
-- kitchen filmed on two days is one row. clip_room_segments is the timed
-- evidence inside one clip (start, end, findings, speech that falls in the
-- span). verification_scenes.location_id already points at job_locations;
-- analysis updates those scenes when a verification video exists for the clip.
--
-- Ask reads the analysis on the clip and can rebuild these rows. A matching
-- analysis_fingerprint is a no-op. user_corrected rows are not replaced.

alter table public.job_locations
  add column if not exists room_key text,
  add column if not exists match_traits text[] not null default '{}';

alter table public.job_locations
  drop constraint if exists job_locations_room_key_len;

alter table public.job_locations
  add constraint job_locations_room_key_len
  check (room_key is null or length(btrim(room_key)) between 1 and 80);

comment on column public.job_locations.room_key is
  'Stable room identity for this job, such as kitchen:: or bathroom::primary. One physical room, many clips.';

create unique index if not exists job_locations_room_key_idx
  on public.job_locations (job_id, room_key)
  where room_key is not null;

create table if not exists public.clip_room_segments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id        uuid not null references public.job_proofs (id) on delete cascade,
  location_id     uuid references public.job_locations (id) on delete set null,

  sequence_index  integer not null check (sequence_index >= 0),
  room_name       text not null check (length(btrim(room_name)) between 1 and 80),
  room_key        text not null check (length(btrim(room_key)) between 1 and 80),
  start_seconds   numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds     numeric(10, 3) not null check (end_seconds >= start_seconds),
  confidence      numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source          text not null default 'analysis'
                    check (source in ('analysis', 'backfill', 'user')),
  user_corrected  boolean not null default false,
  findings        jsonb not null default '[]'::jsonb,
  speech          jsonb not null default '[]'::jsonb,
  analysis_fingerprint text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint clip_room_segments_proof_seq_key unique (proof_id, sequence_index)
);

comment on table public.clip_room_segments is
  'Timed room evidence inside one clip. location_id is the job_locations room these seconds belong to. Speech inside a privacy redaction is not stored.';

create index if not exists clip_room_segments_job_idx
  on public.clip_room_segments (job_id, room_key);

create index if not exists clip_room_segments_location_idx
  on public.clip_room_segments (location_id)
  where location_id is not null;

alter table public.clip_room_segments enable row level security;

drop policy if exists clip_room_segments_select on public.clip_room_segments;
create policy clip_room_segments_select on public.clip_room_segments
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and exists (
      select 1 from public.job_proofs p
      where p.id = clip_room_segments.proof_id
        and p.deleted_at is null
    )
  );

revoke all on public.clip_room_segments from anon, authenticated;
grant select on public.clip_room_segments to authenticated;
