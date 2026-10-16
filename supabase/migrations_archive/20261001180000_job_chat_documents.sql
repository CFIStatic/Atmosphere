-- Chat document uploads.
--
-- Files land in the private job-proofs bucket under {org_id}/chat-documents/.
-- The bucket stays private. Rows are readable by org members and written only
-- by the server. A file is part of the job only after relevance says it
-- matches, or the office confirms a suggested job. Irrelevant files stay
-- unattached.
--
-- job_document_rooms is the hook for per-room segmentation. It records rooms
-- and dimensions read off a floor plan. It does not depend on a later room
-- table; that work can read these rows when it lands.

create table if not exists public.job_chat_documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  job_id             uuid references public.crm_jobs (id) on delete cascade,
  context_job_id     uuid references public.crm_jobs (id) on delete set null,
  suggested_job_id   uuid references public.crm_jobs (id) on delete set null,
  proof_id           uuid references public.job_proofs (id) on delete set null,
  filename           text not null check (length(btrim(filename)) between 1 and 200),
  media_type         text not null check (length(media_type) between 1 and 160),
  byte_size          bigint not null check (byte_size >= 0 and byte_size <= 26214400),
  content_hash       text not null,
  storage_path       text not null,
  status             text not null default 'ready' check (status in ('ready', 'failed')),
  doc_kind           text not null default 'other' check (doc_kind in (
                       'estimate', 'invoice', 'contract', 'change_order', 'insurance_claim',
                       'scope', 'sketch', 'floor_plan', 'permit', 'photo', 'other'
                     )),
  relevance          text not null default 'not_related' check (relevance in ('related', 'not_related', 'pending_confirm')),
  relevance_reason   text,
  summary            text,
  extracted_text     text,
  key_facts          jsonb not null default '{}'::jsonb,
  chunk_index        jsonb not null default '[]'::jsonb,
  extraction_error   text,
  macros_ignored     boolean not null default false,
  uploaded_by        uuid references public.profiles (id) on delete set null,
  attached_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint job_chat_documents_attach_pair check ((attached_at is null) = (job_id is null))
);

create index if not exists job_chat_documents_job_idx
  on public.job_chat_documents (org_id, job_id, created_at desc);

create index if not exists job_chat_documents_context_idx
  on public.job_chat_documents (org_id, context_job_id, created_at desc);

comment on table public.job_chat_documents is
  'Documents uploaded in Ask. Stored privately per org. job_id is set only when the file is attached to that job.';

comment on column public.job_chat_documents.chunk_index is
  'Page, sheet, and cell chunks used to cite Ask answers. The same text is indexed in ask_document_chunks.';

alter table public.job_chat_documents enable row level security;

drop policy if exists job_chat_documents_select on public.job_chat_documents;
create policy job_chat_documents_select on public.job_chat_documents
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.job_chat_documents from anon;
revoke insert, update, delete on public.job_chat_documents from authenticated;
grant select on public.job_chat_documents to authenticated;

create table if not exists public.ask_document_chunks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  document_id  uuid not null references public.job_chat_documents (id) on delete cascade,
  job_id       uuid references public.crm_jobs (id) on delete cascade,
  seq          integer not null check (seq >= 0),
  location     text not null check (length(location) between 1 and 80),
  text         text not null check (length(text) between 1 and 4000),
  created_at   timestamptz not null default now(),
  fts          tsvector generated always as (to_tsvector('simple', text)) stored,
  constraint ask_document_chunks_document_seq_key unique (document_id, seq)
);

create index if not exists ask_document_chunks_job_idx
  on public.ask_document_chunks (org_id, job_id);

create index if not exists ask_document_chunks_fts_idx
  on public.ask_document_chunks using gin (fts);

comment on table public.ask_document_chunks is
  'Ask retrieval index for uploaded documents. One row per page, sheet row, or image reading. Quotes are checked against this text.';

alter table public.ask_document_chunks enable row level security;

drop policy if exists ask_document_chunks_select on public.ask_document_chunks;
create policy ask_document_chunks_select on public.ask_document_chunks
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.ask_document_chunks from anon;
revoke insert, update, delete on public.ask_document_chunks from authenticated;
grant select on public.ask_document_chunks to authenticated;

create table if not exists public.job_document_rooms (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  job_id           uuid not null references public.crm_jobs (id) on delete cascade,
  document_id      uuid not null references public.job_chat_documents (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 80),
  dimensions       text,
  notes            text,
  source_location  text,
  created_at       timestamptz not null default now()
);

create index if not exists job_document_rooms_document_idx
  on public.job_document_rooms (document_id);

create index if not exists job_document_rooms_job_idx
  on public.job_document_rooms (org_id, job_id);

comment on table public.job_document_rooms is
  'Rooms and dimensions read from an attached floor plan or sketch. Hook for per-room segmentation: a later pass may copy these into job room rows. This table does not depend on that schema.';

alter table public.job_document_rooms enable row level security;

drop policy if exists job_document_rooms_select on public.job_document_rooms;
create policy job_document_rooms_select on public.job_document_rooms
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.job_document_rooms from anon;
revoke insert, update, delete on public.job_document_rooms from authenticated;
grant select on public.job_document_rooms to authenticated;
