-- ============================================================================
-- Atmosphere — backup catalog and change ledger
-- ============================================================================
-- Two independent copies of our data, because they fail differently:
--
--   1. SNAPSHOTS — a full export of every table, written outside the database
--      (local volume or object storage), gzipped, encrypted, and checksummed.
--      Survives losing the database entirely. Coarse: you restore to the last
--      snapshot and lose whatever happened since.
--
--   2. THE CHANGE LEDGER — an append-only row-level record of every insert,
--      update, and delete against the CRM, written by triggers inside the same
--      transaction as the change itself. Survives a bad migration, a buggy
--      release, or someone deleting the wrong customer. Fine-grained: you can
--      put one row back without touching anything else.
--
-- A snapshot alone means "we lose a day". A ledger alone means "we lose
-- everything if the database dies". Together they cover both.
--
-- This migration only creates the *catalog* — the index of what backups exist
-- and whether they verified. The archive bytes live outside Postgres by design:
-- a backup stored in the thing it is backing up is not a backup.
-- ============================================================================

do $$ begin
  create type backup_scope as enum ('org', 'platform');
exception when duplicate_object then null; end $$;

do $$ begin
  create type backup_kind as enum ('scheduled', 'manual', 'pre_migration');
exception when duplicate_object then null; end $$;

do $$ begin
  create type backup_status as enum ('running', 'completed', 'failed', 'expired');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.backup_snapshots (
  id            uuid primary key default gen_random_uuid(),
  -- NULL for a platform-wide snapshot covering every org.
  org_id        uuid references public.orgs (id) on delete cascade,
  scope         backup_scope not null default 'platform',
  kind          backup_kind not null default 'scheduled',
  status        backup_status not null default 'running',

  -- Where the bytes actually are. Driver plus a driver-relative path, so
  -- moving from a local volume to object storage does not rewrite history.
  storage_driver text not null,
  storage_path   text,

  -- 'none' | 'aes-256-gcm'. Recorded per snapshot because the answer changes
  -- over time and a restore has to know what it is holding.
  encryption     text not null default 'none',
  -- Which key encrypted it. The key itself never comes near the database; this
  -- is a label so a rotated key can still identify what it can open.
  encryption_key_id text,

  -- SHA-256 of the archive exactly as written to storage. This is the number a
  -- verification run recomputes, and the reason a silently corrupted backup
  -- gets caught before it is needed rather than during a restore.
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size      bigint check (byte_size is null or byte_size >= 0),
  row_count      bigint not null default 0,
  table_count    integer not null default 0,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  -- When retention may reclaim it. NULL means keep indefinitely.
  expires_at    timestamptz,

  -- Last verification result, denormalised so "are our backups good?" is one
  -- cheap query rather than a join over history.
  verified_at   timestamptz,
  verify_ok     boolean,

  error         text,
  created_by    uuid references public.profiles (id) on delete set null
);

create index if not exists backup_snapshots_recent_idx
  on public.backup_snapshots (started_at desc);
create index if not exists backup_snapshots_org_idx
  on public.backup_snapshots (org_id, started_at desc) where org_id is not null;
create index if not exists backup_snapshots_expiry_idx
  on public.backup_snapshots (expires_at) where status = 'completed' and expires_at is not null;

-- ---------------------------------------------------------------------------
-- Per-table manifest
-- ---------------------------------------------------------------------------
-- Row counts and hashes per table, so a restore can tell "this archive is
-- intact" from "this archive is intact but the exporter skipped a table".

create table if not exists public.backup_snapshot_items (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.backup_snapshots (id) on delete cascade,
  table_name    text not null,
  row_count     bigint not null default 0,
  byte_size     bigint not null default 0,
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error         text,
  constraint backup_snapshot_items_unique unique (snapshot_id, table_name)
);

-- ---------------------------------------------------------------------------
-- Verification history
-- ---------------------------------------------------------------------------
-- Every verification attempt, not just the latest. An archive that verified for
-- ninety days and then failed tells you when the storage went bad.

create table if not exists public.backup_verifications (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.backup_snapshots (id) on delete cascade,
  verified_at   timestamptz not null default now(),
  ok            boolean not null,
  -- 'checksum' reads the bytes; 'deep' also decrypts, decompresses, and counts
  -- every row back out against the manifest.
  method        text not null default 'checksum',
  bytes_read    bigint,
  rows_read     bigint,
  detail        text
);

create index if not exists backup_verifications_snapshot_idx
  on public.backup_verifications (snapshot_id, verified_at desc);

-- ---------------------------------------------------------------------------
-- The change ledger
-- ---------------------------------------------------------------------------
-- Written by triggers in the same transaction as the change, so a committed
-- write is a recorded write — there is no window where data changes without an
-- entry. bigint identity rather than a uuid because this table is append-only
-- and read in order.

create table if not exists public.crm_audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid,
  table_name    text not null,
  row_id        uuid,
  op            text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  -- auth.uid() at the time of the change. NULL for server-side/system writes.
  actor_id      uuid,
  changed_at    timestamptz not null default now(),
  -- The row after the change (INSERT/UPDATE) or as it last existed (DELETE).
  row_data      jsonb,
  -- The row before the change, so an UPDATE can be reversed without replaying
  -- the whole table from the previous snapshot.
  prev_data     jsonb
);

create index if not exists crm_audit_log_org_time_idx
  on public.crm_audit_log (org_id, changed_at desc);
create index if not exists crm_audit_log_row_idx
  on public.crm_audit_log (table_name, row_id, changed_at desc);
create index if not exists crm_audit_log_time_idx
  on public.crm_audit_log (changed_at);

create or replace function private.crm_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  jsonb;
  v_prev jsonb;
  v_org  uuid;
  v_id   uuid;
begin
  if tg_op = 'DELETE' then
    v_row  := to_jsonb(old);
    v_prev := null;
  elsif tg_op = 'UPDATE' then
    v_row  := to_jsonb(new);
    v_prev := to_jsonb(old);
  else
    v_row  := to_jsonb(new);
    v_prev := null;
  end if;

  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  v_id  := nullif(v_row ->> 'id', '')::uuid;

  insert into public.crm_audit_log (org_id, table_name, row_id, op, actor_id, row_data, prev_data)
  values (v_org, tg_table_name, v_id, tg_op, auth.uid(), v_row, v_prev);

  -- The ledger must never be the reason a business write fails, but a silent
  -- gap is worse than a loud one — so we let errors propagate rather than
  -- swallowing them. If auditing breaks, the write breaks, and we find out.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_audit() from public, anon, authenticated;

-- Attach to every CRM table. The mirror tables are already append-only and the
-- snapshot catalog is itself backup metadata, so neither needs a ledger.
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_accounts', 'crm_contacts', 'crm_properties',
    'crm_leads', 'crm_jobs', 'crm_activities'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.crm_audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Retention helper
-- ---------------------------------------------------------------------------
-- Marks snapshots whose retention window has passed. Deleting the *bytes* is
-- the storage driver's job in the backend; this only moves the catalog state,
-- so a failed delete leaves a row that still points at real data rather than a
-- dangling reference.

create or replace function private.expire_backups()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.backup_snapshots
     set status = 'expired'
   where status = 'completed'
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.expire_backups() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backup coverage check
-- ---------------------------------------------------------------------------
-- Lists the public tables that exist. The exporter compares this against its
-- own manifest and warns about anything it does not recognise.
--
-- This closes the quietest failure mode in any backup system: someone adds a
-- table, nobody adds it to the export list, and the gap is invisible until a
-- restore comes up short. information_schema is not reachable through PostgREST,
-- so it is surfaced deliberately here — and only to the service role, since the
-- shape of the schema is not a tenant's business.

create or replace function public.backup_public_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
   order by 1;
$$;

revoke all on function public.backup_public_tables() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Everything here is read-only to members: the backup worker runs with the
-- service role, which bypasses RLS. Nobody holding a user session can write a
-- backup record, edit a checksum, or erase an audit entry — which is the only
-- way "the ledger says X" is worth anything.

alter table public.backup_snapshots      enable row level security;
alter table public.backup_snapshot_items enable row level security;
alter table public.backup_verifications  enable row level security;
alter table public.crm_audit_log         enable row level security;

-- A member sees their own org's snapshots. Platform-wide snapshots (org_id
-- NULL) are operator-only and stay invisible to tenants.
drop policy if exists backup_snapshots_select on public.backup_snapshots;
create policy backup_snapshots_select on public.backup_snapshots
  for select to authenticated
  using (org_id is not null and private.is_org_member(org_id));

drop policy if exists backup_snapshot_items_select on public.backup_snapshot_items;
create policy backup_snapshot_items_select on public.backup_snapshot_items
  for select to authenticated
  using (exists (
    select 1 from public.backup_snapshots s
     where s.id = backup_snapshot_items.snapshot_id
       and s.org_id is not null
       and private.is_org_member(s.org_id)
  ));

drop policy if exists backup_verifications_select on public.backup_verifications;
create policy backup_verifications_select on public.backup_verifications
  for select to authenticated
  using (exists (
    select 1 from public.backup_snapshots s
     where s.id = backup_verifications.snapshot_id
       and s.org_id is not null
       and private.is_org_member(s.org_id)
  ));

drop policy if exists crm_audit_log_select on public.crm_audit_log;
create policy crm_audit_log_select on public.crm_audit_log
  for select to authenticated
  using (org_id is not null and private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- SELECT only, for everyone. No INSERT/UPDATE/DELETE grant exists for
-- `authenticated` on any table in this file.

grant select on
  public.backup_snapshots, public.backup_snapshot_items,
  public.backup_verifications, public.crm_audit_log
  to authenticated;

revoke all on
  public.backup_snapshots, public.backup_snapshot_items,
  public.backup_verifications, public.crm_audit_log
  from anon;
