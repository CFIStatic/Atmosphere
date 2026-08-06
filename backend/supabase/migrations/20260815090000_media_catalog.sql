-- ---------------------------------------------------------------------------
-- Fleet media catalog
-- ---------------------------------------------------------------------------
-- Scale model:
--   • One video object is at most ~24 hours (a field day / proof clip).
--   • The platform retains many such objects across organisations — toward
--     billions of hours in aggregate — in object storage, not in Postgres.
--
-- This table is the catalog: identity, size, duration, tier, and key.
-- Bytes never live here. Proof rows and twins reference media_objects.id
-- (or keep legacy storage_path until cut over).

do $$ begin
  create type media_kind as enum (
    'proof_video',
    'proof_frame',
    'field_day_video',
    'twin_mesh',
    'scope_doc',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_tier as enum ('hot', 'warm', 'cold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_state as enum ('pending_upload', 'ready', 'failed', 'deleted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_backend as enum ('supabase', 's3', 'memory');
exception when duplicate_object then null; end $$;

create table if not exists public.media_objects (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  kind             media_kind not null default 'field_day_video',

  -- Timeline length of THIS object only (never a fleet total).
  duration_seconds numeric(10, 2)
    check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 86400)),
  byte_size        bigint check (byte_size is null or byte_size > 0),
  content_hash     text,
  content_type     text,
  -- Microphone track present in the container (required for day / proof video).
  has_audio        boolean,

  backend          media_backend not null default 'supabase',
  bucket           text not null,
  object_key       text not null,
  tier             media_tier not null default 'hot',
  state            media_state not null default 'pending_upload',

  ref_type         text,
  ref_id           text,

  retention_until  timestamptz,
  legal_hold       boolean not null default false,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (backend, bucket, object_key)
);

create index if not exists media_objects_org_created_idx
  on public.media_objects (org_id, created_at desc);

create index if not exists media_objects_org_tier_idx
  on public.media_objects (org_id, tier)
  where state = 'ready';

create index if not exists media_objects_ref_idx
  on public.media_objects (org_id, ref_type, ref_id)
  where ref_id is not null;

-- Soft ceilings per organisation. Null column = unlimited for that dimension.
create table if not exists public.org_media_quotas (
  org_id                      uuid primary key references public.orgs (id) on delete cascade,
  max_hot_bytes               bigint check (max_hot_bytes is null or max_hot_bytes > 0),
  max_total_bytes             bigint check (max_total_bytes is null or max_total_bytes > 0),
  max_ingest_seconds_per_day  bigint check (max_ingest_seconds_per_day is null or max_ingest_seconds_per_day > 0),
  max_object_bytes            bigint check (max_object_bytes is null or max_object_bytes > 0),
  updated_at                  timestamptz not null default now()
);

alter table public.media_objects enable row level security;
alter table public.org_media_quotas enable row level security;

-- Members see their org's catalog; writes go through the service role / API.
do $$ begin
  create policy media_objects_select_member on public.media_objects
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy org_media_quotas_select_member on public.org_media_quotas
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

comment on table public.media_objects is
  'Catalog of fleet media. One row ≤ ~24h video; aggregate hours live as many rows in object storage.';
comment on column public.media_objects.duration_seconds is
  'Duration of this single object only. Fleet totals are SUM(duration_seconds) across ready rows.';
comment on table public.org_media_quotas is
  'Soft org ceilings for hot/total bytes and daily ingest duration. Null = unlimited.';
