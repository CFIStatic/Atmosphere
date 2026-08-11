-- Durable upload sessions so complete/upload can survive a process restart
-- (same Supabase project as job_proofs / media_objects).

create table if not exists public.media_upload_sessions (
  id                         uuid primary key,
  org_id                     uuid not null references public.orgs (id) on delete cascade,
  media_id                   uuid not null references public.media_objects (id) on delete cascade,
  expected_byte_size         bigint,
  expected_duration_seconds  numeric(10, 2),
  content_type               text not null,
  upload_url                 text,
  multipart                  jsonb,
  expires_at                 timestamptz not null,
  created_at                 timestamptz not null default now()
);

create index if not exists media_upload_sessions_org_idx
  on public.media_upload_sessions (org_id, created_at desc);

alter table public.media_upload_sessions enable row level security;

do $$ begin
  create policy media_upload_sessions_select_member on public.media_upload_sessions
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;
