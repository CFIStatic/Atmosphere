-- Field day / proof video must carry a microphone track. Catalog the fact
-- so office playback and future transcription know audio is present.

alter table public.media_objects
  add column if not exists has_audio boolean;

comment on column public.media_objects.has_audio is
  'True when the container includes a mic/audio track. Required for field_day_video and proof_video.';

-- Prefer audiovisual for day-film kinds once ready (advisory; API enforces).
alter table public.media_objects
  drop constraint if exists media_objects_av_kinds_audio;

alter table public.media_objects
  add constraint media_objects_av_kinds_audio
  check (
    kind not in ('field_day_video', 'proof_video')
    or state <> 'ready'
    or has_audio is distinct from false
  );
