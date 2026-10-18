-- Stable @handles and a search index for tags already written into notes.
--
-- profiles.handle is optional. Ask derives a handle from the name or email
-- when it is null, and keeps a stored value when one was set. The index of
-- tags (content_mentions) is how "every @johncyganiak note" is a lookup
-- instead of a scan, and it is org-scoped the same way the rest of the file is.

alter table public.profiles
  add column if not exists handle text;

alter table public.profiles
  drop constraint if exists profiles_handle_format;

alter table public.profiles
  add constraint profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9][a-z0-9_]{1,31}$');

comment on column public.profiles.handle is
  'Optional stable @mention handle. Null means Ask derives one from the name or email local part and dedupes it inside the org.';

create index if not exists profiles_handle_idx
  on public.profiles (handle)
  where handle is not null;

grant update (handle) on public.profiles to authenticated;

create table if not exists public.content_mentions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  mentioned_user_id  uuid not null references public.profiles (id) on delete cascade,
  handle             text not null check (handle ~ '^[a-z0-9][a-z0-9_]{1,31}$'),
  source             text not null check (source in ('job_message', 'work_log', 'job_proof', 'ask_question')),
  source_id          uuid not null,
  job_id             uuid references public.crm_jobs (id) on delete cascade,
  created_at         timestamptz not null default now()
);

create unique index if not exists content_mentions_once
  on public.content_mentions (source, source_id, mentioned_user_id);

create index if not exists content_mentions_person_idx
  on public.content_mentions (org_id, mentioned_user_id, created_at desc);

comment on table public.content_mentions is
  'Org-scoped index of @mentions in notes, logs, transcripts, and Ask questions. The text remains the record; this row makes the tag searchable.';

alter table public.content_mentions enable row level security;

drop policy if exists content_mentions_select on public.content_mentions;
create policy content_mentions_select on public.content_mentions
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists content_mentions_insert on public.content_mentions;
create policy content_mentions_insert on public.content_mentions
  for insert to authenticated
  with check (private.is_org_member(org_id));

grant select, insert on public.content_mentions to authenticated;
