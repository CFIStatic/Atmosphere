-- ============================================================================
-- Atmosphere CRM — external application mirror
-- ============================================================================
-- We run the business in other people's software: estimating platforms, field
-- documentation apps, accounting packages. That data is ours, but today it only
-- exists inside a vendor's account — one billing lapse, one API deprecation,
-- one acquisition away from being unreachable.
--
-- This schema keeps our own copy. Every record we pull from an external system
-- is stored verbatim as JSON, hashed, versioned, and never overwritten. A
-- changed record appends a new version; the old one stays. That is what makes
-- the mirror a *record of what the vendor said and when*, rather than a cache
-- that quietly forgets.
--
-- Two rules are enforced by the database, not by convention:
--   1. Mirrored payloads are append-only — no UPDATE, no DELETE, ever.
--   2. Credentials never land here. A source stores the *name* of a secret
--      (`credential_ref`), and the server resolves it from the environment.
--      A dump of this table therefore leaks no way to reach the vendor.
-- ============================================================================

do $$ begin
  create type crm_source_kind as enum ('rest', 'csv', 'webhook', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_sync_status as enum ('running', 'succeeded', 'failed', 'partial');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Sources — one row per external application we mirror
-- ---------------------------------------------------------------------------

create table if not exists public.crm_external_sources (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  -- Free text rather than an enum: the set of applications a restoration
  -- company runs on changes faster than we want to ship migrations.
  system        text not null check (length(btrim(system)) between 1 and 60),
  label         text not null check (length(btrim(label)) between 1 and 120),
  kind          crm_source_kind not null default 'rest',

  -- Non-secret connection settings: base URL, entity paths, pagination style,
  -- field mappings. Anything sensitive belongs in credential_ref instead.
  config        jsonb not null default '{}'::jsonb,

  -- The NAME of a server-side secret, never the secret. The backend reads
  -- ATM_INTEGRATION_<CREDENTIAL_REF>. Constrained to an identifier shape so a
  -- source row can never be used to make the server read arbitrary env vars.
  credential_ref text check (credential_ref is null or credential_ref ~ '^[A-Z0-9_]{1,64}$'),

  enabled       boolean not null default true,
  sync_interval_minutes integer not null default 1440
    check (sync_interval_minutes between 5 and 43200),
  last_sync_at  timestamptz,
  last_cursor   text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_external_sources_unique_label unique (org_id, system, label)
);

-- ---------------------------------------------------------------------------
-- Records — the copy itself
-- ---------------------------------------------------------------------------

create table if not exists public.crm_external_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  source_id     uuid not null references public.crm_external_sources (id) on delete cascade,

  -- The vendor's own vocabulary ("claim", "estimate", "customer", "invoice"),
  -- kept as-is. Normalising into our CRM is a separate, reversible step; the
  -- mirror's job is fidelity, not interpretation.
  entity_type   text not null check (length(btrim(entity_type)) between 1 and 60),
  external_id   text not null check (length(btrim(external_id)) between 1 and 200),

  -- The verbatim record. Not reshaped, not trimmed.
  payload       jsonb not null,
  -- SHA-256 of the canonical payload. Change detection compares hashes, so an
  -- unchanged record re-fetched a thousand times still costs one row.
  payload_hash  text not null check (payload_hash ~ '^[0-9a-f]{64}$'),

  version       integer not null default 1 check (version >= 1),
  is_current    boolean not null default true,

  -- When the vendor says it changed, vs. when we actually captured it. The gap
  -- between the two is the window a restore would lose.
  source_updated_at timestamptz,
  fetched_at    timestamptz not null default now(),

  -- Set once a mirrored record has been promoted into a native CRM row, so the
  -- lineage from "what the vendor had" to "what we show" stays traceable.
  linked_table  text,
  linked_id     uuid,

  sync_run_id   uuid,

  constraint crm_external_records_version_unique
    unique (source_id, entity_type, external_id, version)
);

-- One current version per external record. A partial unique index expresses
-- that exactly, and lets the writer flip is_current inside a transaction.
create unique index if not exists crm_external_records_current_unique
  on public.crm_external_records (source_id, entity_type, external_id)
  where is_current;

create index if not exists crm_external_records_org_idx
  on public.crm_external_records (org_id, entity_type, fetched_at desc);
create index if not exists crm_external_records_hash_idx
  on public.crm_external_records (source_id, payload_hash);
create index if not exists crm_external_records_linked_idx
  on public.crm_external_records (linked_table, linked_id) where linked_id is not null;
create index if not exists crm_external_records_payload_idx
  on public.crm_external_records using gin (payload jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
-- The whole value of the mirror is that it cannot be quietly rewritten. Only
-- the bookkeeping columns may change after insert; the payload and its hash are
-- frozen, and rows are never deleted except by dropping the source itself.

create or replace function private.mirror_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'crm_external_records is append-only: delete the source to remove its mirror'
      using errcode = 'restrict_violation';
  end if;

  if new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash
     or new.external_id is distinct from old.external_id
     or new.entity_type is distinct from old.entity_type
     or new.version is distinct from old.version
     or new.org_id is distinct from old.org_id
     or new.source_id is distinct from old.source_id
     or new.fetched_at is distinct from old.fetched_at then
    raise exception 'crm_external_records payloads are immutable; append a new version instead'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists crm_external_records_append_only on public.crm_external_records;
create trigger crm_external_records_append_only
  before update or delete on public.crm_external_records
  for each row execute function private.mirror_append_only();

-- ---------------------------------------------------------------------------
-- Sync runs — the log of every pull
-- ---------------------------------------------------------------------------
-- A backup you cannot prove ran is a backup you do not have. Each attempt is
-- recorded whether it succeeds or fails, so "when did we last actually have a
-- complete copy of this system?" has an answer.

create table if not exists public.crm_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  source_id     uuid not null references public.crm_external_sources (id) on delete cascade,
  status        crm_sync_status not null default 'running',
  -- 'manual' | 'scheduled' | 'webhook' — what caused this pull.
  trigger_kind  text not null default 'manual',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  records_seen     integer not null default 0,
  records_new      integer not null default 0,
  records_changed  integer not null default 0,
  records_failed   integer not null default 0,
  cursor_before text,
  cursor_after  text,
  error         text,
  started_by    uuid references public.profiles (id) on delete set null
);

create index if not exists crm_sync_runs_source_idx
  on public.crm_sync_runs (source_id, started_at desc);

do $$ begin
  alter table public.crm_external_records
    add constraint crm_external_records_sync_run_fkey
    foreign key (sync_run_id) references public.crm_sync_runs (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists crm_external_sources_touch on public.crm_external_sources;
create trigger crm_external_sources_touch
  before update on public.crm_external_sources
  for each row execute function private.touch_updated_at();

drop trigger if exists crm_external_sources_freeze on public.crm_external_sources;
create trigger crm_external_sources_freeze
  before update on public.crm_external_sources
  for each row execute function private.freeze_ownership();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Members read their org's mirror and manage their org's sources. Writing
-- mirrored rows is reserved for the server's sync worker (service role, which
-- bypasses RLS): a member should never be able to forge a record and claim a
-- vendor said it.

alter table public.crm_external_sources enable row level security;
alter table public.crm_external_records enable row level security;
alter table public.crm_sync_runs        enable row level security;

drop policy if exists crm_external_sources_select on public.crm_external_sources;
create policy crm_external_sources_select on public.crm_external_sources
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists crm_external_sources_insert on public.crm_external_sources;
create policy crm_external_sources_insert on public.crm_external_sources
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists crm_external_sources_update on public.crm_external_sources;
create policy crm_external_sources_update on public.crm_external_sources
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

drop policy if exists crm_external_sources_delete on public.crm_external_sources;
create policy crm_external_sources_delete on public.crm_external_sources
  for delete to authenticated using (private.is_org_member(org_id));

drop policy if exists crm_external_records_select on public.crm_external_records;
create policy crm_external_records_select on public.crm_external_records
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists crm_sync_runs_select on public.crm_sync_runs;
create policy crm_sync_runs_select on public.crm_sync_runs
  for select to authenticated using (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.crm_external_sources to authenticated;
grant select on public.crm_external_records to authenticated;
grant select on public.crm_sync_runs to authenticated;

revoke all on
  public.crm_external_sources, public.crm_external_records, public.crm_sync_runs
  from anon;
