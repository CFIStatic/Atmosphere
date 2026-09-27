-- Word- and segment-timed speech for closed captions.
-- transcript_text stays the searchable prose Ask already uses.
-- transcript_words null means a timed run has not stored a clock yet.
-- An empty array means a timed run finished and the provider returned no words.

alter table public.job_proofs
  add column if not exists transcript_segments jsonb;

alter table public.job_proofs
  add column if not exists transcript_words jsonb;

comment on column public.job_proofs.transcript_segments is
  'Whisper segments as [{start, end, text}] in seconds. Null until a timed run finishes.';

comment on column public.job_proofs.transcript_words is
  'Whisper words as [{start, end, text}] in seconds. Null until a timed run finishes; [] when that run returned no words.';
