-- Day-film speech: timestamped transcript segments from the microphone track.
--
-- Capture already requires video + audio. Vision dictation reads stills.
-- This table is the soundtrack reading — proposals only, never a verdict.
-- Speech claiming work is done does not mark a scope line complete.

do $$ begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'extract_audio'
  ) then
    alter type verification_processing_stage add value 'extract_audio';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'verification_processing_stage' and e.enumlabel = 'transcribe_audio'
  ) then
    alter type verification_processing_stage add value 'transcribe_audio';
  end if;
end $$;

alter table public.job_proofs
  add column if not exists transcript_status text;

alter table public.job_proofs
  add column if not exists transcript_error text;

alter table public.job_proofs
  add column if not exists transcript_model text;

alter table public.job_proofs
  add column if not exists transcribed_at timestamptz;

alter table public.job_proofs
  drop constraint if exists job_proofs_transcript_status_ok;

alter table public.job_proofs
  add constraint job_proofs_transcript_status_ok
  check (
    transcript_status is null
    or transcript_status in ('queued', 'running', 'done', 'failed', 'skipped')
  );

comment on column public.job_proofs.transcript_status is
  'Speech-to-text of the day-film microphone track. Independent of vision dictation.';

create table if not exists public.audio_transcript_segments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          uuid references public.crm_jobs (id) on delete cascade,
  proof_id        uuid references public.job_proofs (id) on delete cascade,
  video_id        uuid references public.verification_videos (id) on delete cascade,

  start_seconds   numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds     numeric(10, 3) not null check (end_seconds >= start_seconds),
  text            text not null check (length(btrim(text)) between 1 and 4000),
  confidence      numeric(6, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  no_speech_prob  numeric(6, 4),
  model           text,
  chunk_index     int not null default 0 check (chunk_index >= 0),
  created_at      timestamptz not null default now(),

  constraint audio_transcript_has_parent check (proof_id is not null or video_id is not null)
);

create index if not exists audio_transcript_segments_proof_idx
  on public.audio_transcript_segments (proof_id, start_seconds);

create index if not exists audio_transcript_segments_video_idx
  on public.audio_transcript_segments (video_id, start_seconds);

create index if not exists audio_transcript_segments_org_idx
  on public.audio_transcript_segments (org_id, created_at desc);

comment on table public.audio_transcript_segments is
  'Timestamped speech from a filed day film. Evidence for Ask / the Verifier; '
  'never a completion verdict on its own.';

alter table public.audio_transcript_segments enable row level security;

drop policy if exists audio_transcript_segments_select on public.audio_transcript_segments;
create policy audio_transcript_segments_select on public.audio_transcript_segments
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists audio_transcript_segments_insert on public.audio_transcript_segments;
create policy audio_transcript_segments_insert on public.audio_transcript_segments
  for insert to authenticated
  with check (private.is_org_member(org_id));
