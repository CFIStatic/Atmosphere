-- Transcript chunk index for job-level Ask.
--
-- One row per transcript segment (or short word run when a clip only has word
-- timings), keyed by clip + start/end second. Ask uses this table to find
-- which clips on a job mention a phrase, including clips older than the rows
-- a single Ask loads. The quoted text itself is always re-read from
-- job_proofs and redacted at answer time, so a privacy range added later
-- still applies. Rows are rebuilt whenever a clip's transcript is rewritten.
--
-- Written only by the server (service role). Readable by org members while
-- the clip is not deleted, matching job_proofs.

create table if not exists public.ask_transcript_chunks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  job_id             uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id           uuid not null references public.job_proofs (id) on delete cascade,
  seq                integer not null check (seq >= 0),
  start_sec          double precision,
  end_sec            double precision,
  text               text not null check (length(text) between 1 and 4000),
  speaker_label      text,
  transcript_sha256  text not null,
  created_at         timestamptz not null default now(),
  fts                tsvector generated always as (to_tsvector('simple', text)) stored,
  constraint ask_transcript_chunks_proof_seq_key unique (proof_id, seq)
);

comment on table public.ask_transcript_chunks is
  'Job-level Ask transcript index: one row per timed transcript segment, keyed by clip + start/end. Rebuilt when a transcript is rewritten. Ask re-reads and redacts the source row before quoting.';

comment on column public.ask_transcript_chunks.transcript_sha256 is
  'Hash of the job_proofs transcript this chunk was cut from. A mismatch means the chunk is stale and is rebuilt.';

create index if not exists ask_transcript_chunks_job_idx
  on public.ask_transcript_chunks (org_id, job_id);

create index if not exists ask_transcript_chunks_proof_idx
  on public.ask_transcript_chunks (proof_id, start_sec);

create index if not exists ask_transcript_chunks_fts_idx
  on public.ask_transcript_chunks using gin (fts);

alter table public.ask_transcript_chunks enable row level security;

drop policy if exists ask_transcript_chunks_select on public.ask_transcript_chunks;
create policy ask_transcript_chunks_select on public.ask_transcript_chunks
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and exists (
      select 1 from public.job_proofs p
      where p.id = ask_transcript_chunks.proof_id
        and p.deleted_at is null
    )
  );

revoke all on public.ask_transcript_chunks from anon;
revoke insert, update, delete on public.ask_transcript_chunks from authenticated;
grant select on public.ask_transcript_chunks to authenticated;
