-- Ask retrieval embeddings (OpenAI text-embedding-3-small, 1536-d).
-- Not applied live by the agent; ship via normal migration review.
-- Prefer pgvector when the extension is available; otherwise real[] works and
-- cosine ranking runs in the app for a single job's chunks.

create extension if not exists vector;

alter table public.ask_transcript_chunks
  add column if not exists embedding vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedding_at timestamptz;

comment on column public.ask_transcript_chunks.embedding is
  'OpenAI text-embedding-3-small vector for this transcript segment; null until indexed.';

-- Video-analysis / summary / findings chunks (separate from spoken transcript).
create table if not exists public.ask_analysis_chunks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  job_id             uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id           uuid not null references public.job_proofs (id) on delete cascade,
  seq                integer not null check (seq >= 0),
  kind               text not null check (kind in ('summary', 'findings', 'dictation', 'action')),
  start_sec          double precision,
  end_sec            double precision,
  text               text not null check (length(text) between 1 and 4000),
  source_sha256      text not null,
  embedding          vector(1536),
  embedding_model    text,
  embedding_at       timestamptz,
  created_at         timestamptz not null default now(),
  fts                tsvector generated always as (to_tsvector('simple', text)) stored,
  constraint ask_analysis_chunks_proof_seq_kind_key unique (proof_id, kind, seq)
);

create index if not exists ask_analysis_chunks_job_idx
  on public.ask_analysis_chunks (org_id, job_id);

create index if not exists ask_analysis_chunks_fts_idx
  on public.ask_analysis_chunks using gin (fts);

-- Optional IVFFlat / HNSW once enough rows exist; safe no-op if empty.
do $$
begin
  begin
    create index if not exists ask_transcript_chunks_embedding_idx
      on public.ask_transcript_chunks
      using hnsw (embedding vector_cosine_ops);
  exception when others then
    raise notice 'ask_transcript_chunks HNSW skipped: %', sqlerrm;
  end;
  begin
    create index if not exists ask_analysis_chunks_embedding_idx
      on public.ask_analysis_chunks
      using hnsw (embedding vector_cosine_ops);
  exception when others then
    raise notice 'ask_analysis_chunks HNSW skipped: %', sqlerrm;
  end;
end $$;

alter table public.ask_analysis_chunks enable row level security;

drop policy if exists ask_analysis_chunks_select on public.ask_analysis_chunks;
create policy ask_analysis_chunks_select on public.ask_analysis_chunks
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and exists (
      select 1 from public.job_proofs p
      where p.id = ask_analysis_chunks.proof_id
        and p.deleted_at is null
    )
  );

revoke all on public.ask_analysis_chunks from anon;
revoke insert, update, delete on public.ask_analysis_chunks from authenticated;
grant select on public.ask_analysis_chunks to authenticated;
