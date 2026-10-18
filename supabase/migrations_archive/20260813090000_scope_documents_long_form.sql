-- ---------------------------------------------------------------------------
-- The scope arrives as a document; the footage arrives as a workday
-- ---------------------------------------------------------------------------
-- Two additions that complete the sentence the product promises: "upload the
-- scope of work, the AI reads it, watches the video — hours of it — and
-- reports what was done."
--
-- scope_documents holds the uploaded scope of work (a PDF, a work order, a
-- pasted text) and what the model proposed reading it. The proposal is NOT
-- the scope: nothing the model extracts becomes a line the footage is judged
-- against until a person confirms it, and the structure enforces that — the
-- extraction lives here, job_scope_items only ever gains rows through the
-- confirm step, which stamps each line with the document it came from.
--
-- job_proof_segments is the long-footage ledger: a multi-hour recording is
-- read in time windows, each window summarized by the cheap model before the
-- strong model synthesizes the day. The windows are kept, not discarded,
-- because "where in seven hours did the decking go down" deserves a
-- timestamp, and because the report's coverage numbers must be recomputable
-- from stored evidence rather than trusted from a model's memory.

create table if not exists public.scope_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  job_id           uuid not null references public.crm_jobs (id) on delete cascade,
  filename         text not null check (length(btrim(filename)) between 1 and 200),
  media_type       text not null check (media_type in ('application/pdf', 'text/plain')),
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  content_hash     text,
  storage_path     text not null,
  status           text not null default 'uploaded'
                   check (status in ('uploaded', 'extracting', 'extracted', 'failed', 'confirmed')),
  -- What the model proposed: [{title, state, reason, amount, note}] plus
  -- whatever it could not read. A proposal, never the record.
  extracted        jsonb,
  extraction_error text,
  model            text,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  confirmed_by     uuid references public.profiles (id) on delete set null,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- A confirmed document says who confirmed it. Half a confirmation is a bug.
  constraint scope_documents_confirmed_pair
    check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

create index if not exists scope_documents_job_idx
  on public.scope_documents (job_id, created_at desc);

comment on table public.scope_documents is
  'Uploaded scopes of work and what the model read in them. The extraction '
  'is a proposal: scope lines exist only after a person confirms, and each '
  'confirmed line carries this document''s id as provenance.';

alter table public.scope_documents enable row level security;

drop policy if exists scope_documents_select on public.scope_documents;
create policy scope_documents_select on public.scope_documents
  for select to authenticated using (private.is_org_member(org_id));

-- Writes go through the service role: upload, extraction, and confirmation
-- are route-mediated acts with their own checks.

revoke all on public.scope_documents from anon;

-- Provenance on the scope line itself: which document it was confirmed from.
alter table public.job_scope_items
  add column if not exists source_document_id uuid references public.scope_documents (id) on delete set null;

comment on column public.job_scope_items.source_document_id is
  'Set when this line was confirmed from an uploaded scope document. Null '
  'means a person typed it directly.';

create table if not exists public.job_proof_segments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  proof_id      uuid not null references public.job_proofs (id) on delete cascade,
  idx           integer not null check (idx >= 0),
  start_seconds numeric(10, 2) not null check (start_seconds >= 0),
  end_seconds   numeric(10, 2) not null check (end_seconds >= start_seconds),
  frame_count   integer not null default 0 check (frame_count >= 0),
  -- The cheap model's reading of this window: {summary, stages, scopeTouched,
  -- notable, unclear}. Kept verbatim so the day's report is auditable.
  reading       jsonb,
  model         text,
  created_at    timestamptz not null default now(),
  constraint job_proof_segments_one_window unique (proof_id, idx)
);

create index if not exists job_proof_segments_proof_idx
  on public.job_proof_segments (proof_id, idx);

comment on table public.job_proof_segments is
  'Time windows of a long recording, each read by the model before the '
  'day-level synthesis. The report''s timeline and coverage are computed '
  'from these rows, never asserted from memory.';

alter table public.job_proof_segments enable row level security;

drop policy if exists job_proof_segments_select on public.job_proof_segments;
create policy job_proof_segments_select on public.job_proof_segments
  for select to authenticated using (private.is_org_member(org_id));

-- Only the analysis pipeline (service role) writes segments.

revoke all on public.job_proof_segments from anon;
