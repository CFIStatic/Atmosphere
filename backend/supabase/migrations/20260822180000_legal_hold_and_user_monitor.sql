-- ---------------------------------------------------------------------------
-- Legal hold, video vault, and user-action monitor
-- ---------------------------------------------------------------------------
-- Atmosphere is evidence. A subpoena, a lawsuit, or a preservation letter
-- must still be answerable after a customer deletes a clip from their library.
--
-- Three things follow:
--
--   1. User delete is a hide, not a destroy. Bytes stay in object storage.
--      The catalog row stays. A vault row records the original key and hash.
--
--   2. Platform legal holds (staff-only) outrank org retention and user
--      delete. An open hold freezes every matching video.
--
--   3. Every signed-in action is an append-only row. Counsel can ask "who
--      opened this, who deleted it, and when" without reconstructing logs.
--
-- Customers never read these tables. Staff read them through the BFF with
-- the service role. RLS is on and empty for authenticated / anon.

-- A customer hide is a custody event. The enum already has held/released;
-- deleted means they removed it from their library, not from the vault.
do $$ begin
  alter type public.job_evidence_action add value if not exists 'deleted';
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Soft-delete on the user-visible catalog
-- ---------------------------------------------------------------------------

alter table public.job_proofs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

comment on column public.job_proofs.deleted_at is
  'When the customer hid this clip. Null means it is still in their library. '
  'The file and vault row remain.';

alter table public.media_objects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

comment on column public.media_objects.deleted_at is
  'When the customer hid this object. Bytes are not removed.';

create index if not exists job_proofs_deleted_idx
  on public.job_proofs (org_id, deleted_at)
  where deleted_at is not null;

create index if not exists media_objects_deleted_idx
  on public.media_objects (org_id, deleted_at)
  where deleted_at is not null;

-- A deleted before/after must not block a refilm of the same day. The old
-- row stays for counsel; the unique rule applies only to the visible one.
alter table public.job_proofs drop constraint if exists job_proofs_one_per_phase;

drop index if exists public.job_proofs_one_visible_phase;
create unique index job_proofs_one_visible_phase
  on public.job_proofs (party_id, work_date, phase)
  where deleted_at is null;

-- Org members no longer see clips they hid. Service role (staff production)
-- bypasses RLS and still reads them.
drop policy if exists job_proofs_select on public.job_proofs;
create policy job_proofs_select on public.job_proofs
  for select to authenticated
  using (private.is_org_member(org_id) and deleted_at is null);

drop policy if exists media_objects_select_member on public.media_objects;
create policy media_objects_select_member on public.media_objects
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
    and deleted_at is null
    and state <> 'deleted'
  );

-- Authenticated callers already have no DELETE policy on storage.objects
-- (default deny). Say so explicitly for the evidence bucket.
drop policy if exists job_proofs_storage_no_delete on storage.objects;
create policy job_proofs_storage_no_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'job-proofs' and false);

-- ---------------------------------------------------------------------------
-- Platform legal holds (staff / counsel)
-- ---------------------------------------------------------------------------

do $$ begin
  create type legal_hold_kind as enum (
    'subpoena',
    'lawsuit',
    'preservation',
    'investigation',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_hold_status as enum ('open', 'released');
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_subject_type as enum (
    'org',
    'user',
    'job',
    'proof',
    'media'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.legal_holds (
  id              uuid primary key default gen_random_uuid(),
  case_number     text not null check (length(case_number) between 1 and 120),
  kind            legal_hold_kind not null,
  title           text not null check (length(title) between 1 and 240),
  reason          text not null check (length(reason) between 1 and 4000),
  counsel_name    text check (counsel_name is null or length(counsel_name) <= 200),
  received_at     timestamptz not null default now(),
  due_at          timestamptz,
  status          legal_hold_status not null default 'open',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  released_by     uuid references public.profiles (id) on delete set null,
  released_at     timestamptz,
  release_reason  text check (release_reason is null or length(release_reason) <= 2000),
  constraint legal_holds_release_together check (
    (status = 'released') = (released_at is not null)
  )
);

create unique index if not exists legal_holds_case_number_idx
  on public.legal_holds (lower(case_number));

create index if not exists legal_holds_status_idx
  on public.legal_holds (status, created_at desc);

comment on table public.legal_holds is
  'Platform legal holds. Staff-only. An open hold freezes matching videos.';

create table if not exists public.legal_hold_subjects (
  id            uuid primary key default gen_random_uuid(),
  hold_id       uuid not null references public.legal_holds (id) on delete restrict,
  subject_type  legal_subject_type not null,
  subject_id    uuid not null,
  created_at    timestamptz not null default now(),
  unique (hold_id, subject_type, subject_id)
);

create index if not exists legal_hold_subjects_lookup_idx
  on public.legal_hold_subjects (subject_type, subject_id);

comment on table public.legal_hold_subjects is
  'What a hold covers: an org, a user, a job, or a specific video.';

-- ---------------------------------------------------------------------------
-- Video vault — the copy counsel can still ask for
-- ---------------------------------------------------------------------------

do $$ begin
  create type legal_vault_source as enum ('job_proof', 'media_object');
exception when duplicate_object then null; end $$;

create table if not exists public.legal_video_vault (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete restrict,
  source_kind        legal_vault_source not null,
  source_id          uuid not null,
  job_id             uuid,
  actor_user_id      uuid,
  storage_backend    text not null,
  storage_bucket     text not null,
  storage_key        text not null,
  content_hash       text,
  byte_size          bigint,
  duration_seconds   numeric(10, 2),
  content_type       text,
  captured_at        timestamptz,
  received_at        timestamptz not null default now(),
  user_deleted_at    timestamptz,
  vaulted_at         timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb,
  unique (source_kind, source_id)
);

create index if not exists legal_video_vault_org_idx
  on public.legal_video_vault (org_id, vaulted_at desc);

create index if not exists legal_video_vault_job_idx
  on public.legal_video_vault (job_id)
  where job_id is not null;

create index if not exists legal_video_vault_deleted_idx
  on public.legal_video_vault (org_id)
  where user_deleted_at is not null;

comment on table public.legal_video_vault is
  'Immutable catalog of every video Atmosphere accepted. User delete stamps '
  'user_deleted_at; it does not remove the row or the bytes.';

-- ---------------------------------------------------------------------------
-- User-action monitor
-- ---------------------------------------------------------------------------

create table if not exists public.user_activity_events (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid,
  actor_email     text,
  actor_label     text,
  org_id          uuid,
  action          text not null check (length(action) between 1 and 120),
  resource_type   text,
  resource_id     text,
  request_id      text,
  method          text,
  path            text,
  status          integer,
  ip              text,
  user_agent      text,
  detail          jsonb not null default '{}'::jsonb
);

create index if not exists user_activity_events_actor_idx
  on public.user_activity_events (actor_user_id, occurred_at desc);

create index if not exists user_activity_events_org_idx
  on public.user_activity_events (org_id, occurred_at desc);

create index if not exists user_activity_events_action_idx
  on public.user_activity_events (action, occurred_at desc);

create index if not exists user_activity_events_resource_idx
  on public.user_activity_events (resource_type, resource_id, occurred_at desc);

comment on table public.user_activity_events is
  'Append-only monitor of signed-in product actions. Staff-only. Secrets are '
  'redacted in the BFF before insert.';

-- ---------------------------------------------------------------------------
-- Productions — a package handed to counsel
-- ---------------------------------------------------------------------------

create table if not exists public.legal_productions (
  id               uuid primary key default gen_random_uuid(),
  hold_id          uuid not null references public.legal_holds (id) on delete restrict,
  requested_by     uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  item_count       integer not null default 0,
  activity_count   integer not null default 0,
  note             text check (note is null or length(note) <= 2000)
);

create index if not exists legal_productions_hold_idx
  on public.legal_productions (hold_id, created_at desc);

comment on table public.legal_productions is
  'A staff export of vaulted videos + the activity trail for one hold.';

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function private.legal_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Legal records cannot be edited or deleted.';
end;
$$;

create or replace function private.legal_holds_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A legal hold cannot be deleted. Release it.';
  end if;
  if old.status = 'released' and new.status is distinct from old.status then
    raise exception 'A released hold cannot be reopened in place. Open a new hold.';
  end if;
  return new;
end;
$$;

create or replace function private.legal_vault_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vaulted video cannot be destroyed.';
  end if;
  if new.org_id is distinct from old.org_id
     or new.source_kind is distinct from old.source_kind
     or new.source_id is distinct from old.source_id
     or new.storage_backend is distinct from old.storage_backend
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_key is distinct from old.storage_key
     or new.content_hash is distinct from old.content_hash
     or new.vaulted_at is distinct from old.vaulted_at then
    raise exception 'Vault identity cannot be rewritten.';
  end if;
  return new;
end;
$$;

create or replace function private.job_proofs_forbid_destroy()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Proof video cannot be destroyed. Soft-delete it so the vault keeps the file.';
end;
$$;

create or replace function private.media_objects_forbid_destroy()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.legal_video_vault v
     where v.source_kind = 'media_object' and v.source_id = old.id
  ) or old.legal_hold or old.deleted_at is not null then
    raise exception 'Media object cannot be destroyed. Soft-delete it so the vault keeps the file.';
  end if;
  return old;
end;
$$;

drop trigger if exists legal_holds_guard on public.legal_holds;
create trigger legal_holds_guard
  before update or delete on public.legal_holds
  for each row execute function private.legal_holds_guard();

drop trigger if exists legal_hold_subjects_immutable on public.legal_hold_subjects;
create trigger legal_hold_subjects_immutable
  before update or delete on public.legal_hold_subjects
  for each row execute function private.legal_append_only();

drop trigger if exists legal_video_vault_guard on public.legal_video_vault;
create trigger legal_video_vault_guard
  before update or delete on public.legal_video_vault
  for each row execute function private.legal_vault_guard();

drop trigger if exists user_activity_events_immutable on public.user_activity_events;
create trigger user_activity_events_immutable
  before update or delete on public.user_activity_events
  for each row execute function private.legal_append_only();

drop trigger if exists legal_productions_immutable on public.legal_productions;
create trigger legal_productions_immutable
  before update or delete on public.legal_productions
  for each row execute function private.legal_append_only();

drop trigger if exists job_proofs_forbid_destroy on public.job_proofs;
create trigger job_proofs_forbid_destroy
  before delete on public.job_proofs
  for each row execute function private.job_proofs_forbid_destroy();

drop trigger if exists media_objects_forbid_destroy on public.media_objects;
create trigger media_objects_forbid_destroy
  before delete on public.media_objects
  for each row execute function private.media_objects_forbid_destroy();

-- ---------------------------------------------------------------------------
-- RLS — customers cannot see the legal plane
-- ---------------------------------------------------------------------------

alter table public.legal_holds enable row level security;
alter table public.legal_hold_subjects enable row level security;
alter table public.legal_video_vault enable row level security;
alter table public.user_activity_events enable row level security;
alter table public.legal_productions enable row level security;

revoke all on public.legal_holds from anon, authenticated;
revoke all on public.legal_hold_subjects from anon, authenticated;
revoke all on public.legal_video_vault from anon, authenticated;
revoke all on public.user_activity_events from anon, authenticated;
revoke all on public.legal_productions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer-facing views hide soft-deleted clips
-- ---------------------------------------------------------------------------

create or replace view public.job_evidence_items
with (security_invoker = true) as
select
  p.id,
  p.org_id,
  p.job_id,
  p.party_id,
  y.company                       as party_company,
  y.trade                         as party_trade,
  p.work_date,
  p.phase,
  p.category,
  coalesce(p.title, initcap(p.phase::text) || ' — ' || to_char(p.work_date, 'Mon DD')) as title,
  p.tags,
  p.duration_seconds,
  p.byte_size,
  p.captured_at,
  p.received_at,
  p.lat,
  p.lon,
  p.state,
  p.checks,
  p.ai_summary,
  p.legal_hold,
  p.retention_until,
  p.content_hash,
  (select count(*) from public.job_evidence_access a
    where a.proof_id = p.id and a.action in ('viewed', 'downloaded'))  as view_count,
  (select max(a.occurred_at) from public.job_evidence_access a
    where a.proof_id = p.id and a.action in ('viewed', 'downloaded'))  as last_viewed_at
from public.job_proofs p
left join public.job_parties y on y.id = p.party_id
where p.deleted_at is null;

create or replace view public.job_proof_days
with (security_invoker = true) as
select
  p.org_id,
  p.job_id,
  p.party_id,
  p.work_date,
  (array_agg(p.id) filter (where p.phase = 'before'))[1]   as before_id,
  (array_agg(p.id) filter (where p.phase = 'after'))[1]    as after_id,
  max(case when p.phase = 'before' then p.captured_at end) as before_at,
  max(case when p.phase = 'after'  then p.captured_at end) as after_at,
  bool_and(p.state = 'accepted')                           as accepted,
  bool_or(p.state = 'rejected')                            as rejected,
  count(*)                                                 as videos,
  max(p.ai_summary) filter (where p.phase = 'after')       as summary
from public.job_proofs p
where p.deleted_at is null
group by p.org_id, p.job_id, p.party_id, p.work_date;
