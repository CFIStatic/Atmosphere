-- ============================================================================
-- Email Marketing — storm outreach + follow-up check-ins
-- ============================================================================
-- Sits on top of the CRM. Contacts and properties already carry location and
-- email; these tables record the storms we watch, the outreach we draft/send
-- when someone is in the path, and the follow-up check-ins after the weather
-- clears.
--
-- Same tenancy rules as the CRM: every row is org-scoped, RLS is the real
-- boundary, and org_id / created_by are frozen after insert.
--
-- Safe to re-run: every object is created guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type em_storm_severity as enum (
    'advisory',
    'watch',
    'warning',
    'emergency'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type em_storm_status as enum (
    'active',
    'expired',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type em_outreach_status as enum (
    'draft',
    'sending',
    'sent',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type em_message_status as enum (
    'draft',
    'queued',
    'sent',
    'failed',
    'skipped'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type em_checkin_status as enum (
    'scheduled',
    'sent',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Settings — one row per org
-- ---------------------------------------------------------------------------

create table if not exists public.em_settings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs (id) on delete cascade,
  from_name             text not null default 'Atmosphere' check (length(btrim(from_name)) between 1 and 120),
  reply_to_email        text,
  company_signature     text,
  auto_send             boolean not null default false,
  follow_up_days        integer not null default 2 check (follow_up_days between 1 and 30),
  include_offer_of_help boolean not null default true,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint em_settings_org_unique unique (org_id)
);

-- ---------------------------------------------------------------------------
-- Storms — weather events that threaten CRM contacts
-- ---------------------------------------------------------------------------

create table if not exists public.em_storms (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  -- External id from the weather feed (NWS alert id, or a demo key). Unique
  -- per org so a re-scan upserts rather than duplicating.
  external_id     text not null,
  source          text not null default 'nws' check (source in ('nws', 'demo', 'manual')),
  name            text not null check (length(btrim(name)) between 1 and 200),
  event_type      text not null check (length(btrim(event_type)) between 1 and 120),
  severity        em_storm_severity not null default 'warning',
  status          em_storm_status not null default 'active',
  headline        text,
  description     text,
  instruction     text,
  -- Approximate footprint used for matching when no polygon is present.
  center_lat      numeric(9, 6) not null,
  center_lng      numeric(9, 6) not null,
  radius_miles    numeric(8, 2) not null default 25
                    check (radius_miles > 0 and radius_miles <= 2000),
  -- Optional GeoJSON polygon / multipolygon from the weather feed.
  geometry        jsonb,
  area_desc       text,
  onset_at        timestamptz,
  ends_at         timestamptz,
  raw_payload     jsonb,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint em_storms_org_external unique (org_id, external_id)
);

create index if not exists em_storms_org_status_idx
  on public.em_storms (org_id, status, onset_at desc);

-- ---------------------------------------------------------------------------
-- Outreach — one run per storm
-- ---------------------------------------------------------------------------

create table if not exists public.em_outreach (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  storm_id        uuid not null references public.em_storms (id) on delete cascade,
  status          em_outreach_status not null default 'draft',
  subject_template text not null,
  body_template   text not null,
  matched_count   integer not null default 0 check (matched_count >= 0),
  sent_count      integer not null default 0 check (sent_count >= 0),
  skipped_count   integer not null default 0 check (skipped_count >= 0),
  failed_count    integer not null default 0 check (failed_count >= 0),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- One active/draft outreach per storm keeps the map UI simple.
  constraint em_outreach_storm_unique unique (org_id, storm_id)
);

create index if not exists em_outreach_org_created_idx
  on public.em_outreach (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Outreach messages — per-contact emails
-- ---------------------------------------------------------------------------

create table if not exists public.em_outreach_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  outreach_id     uuid not null references public.em_outreach (id) on delete cascade,
  contact_id      uuid not null references public.crm_contacts (id) on delete cascade,
  property_id     uuid references public.crm_properties (id) on delete set null,
  to_email        text not null,
  to_name         text,
  subject         text not null,
  body_text       text not null,
  status          em_message_status not null default 'draft',
  skip_reason     text,
  error_message   text,
  provider        text,
  provider_message_id text,
  distance_miles  numeric(8, 2),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint em_outreach_messages_unique unique (outreach_id, contact_id)
);

create index if not exists em_outreach_messages_outreach_idx
  on public.em_outreach_messages (outreach_id, status);

create index if not exists em_outreach_messages_contact_idx
  on public.em_outreach_messages (org_id, contact_id);

-- ---------------------------------------------------------------------------
-- Check-ins — post-storm follow-ups
-- ---------------------------------------------------------------------------

create table if not exists public.em_checkins (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  storm_id        uuid not null references public.em_storms (id) on delete cascade,
  outreach_id     uuid references public.em_outreach (id) on delete set null,
  contact_id      uuid not null references public.crm_contacts (id) on delete cascade,
  property_id     uuid references public.crm_properties (id) on delete set null,
  status          em_checkin_status not null default 'scheduled',
  scheduled_for   timestamptz not null,
  subject         text,
  body_text       text,
  to_email        text,
  outcome_notes   text,
  sent_at         timestamptz,
  completed_at    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint em_checkins_storm_contact unique (storm_id, contact_id)
);

create index if not exists em_checkins_org_due_idx
  on public.em_checkins (org_id, status, scheduled_for);

-- ---------------------------------------------------------------------------
-- updated_at + freeze ownership triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'em_settings', 'em_storms', 'em_outreach',
    'em_outreach_messages', 'em_checkins'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function private.touch_updated_at()', t || '_touch', t);

    execute format('drop trigger if exists %I on public.%I', t || '_freeze', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function private.freeze_ownership()', t || '_freeze', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'em_settings', 'em_storms', 'em_outreach',
    'em_outreach_messages', 'em_checkins'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_org_member(org_id))
         with check (private.is_org_member(org_id))', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (private.is_org_member(org_id))', t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.em_settings from anon, authenticated;
revoke all on public.em_storms from anon, authenticated;
revoke all on public.em_outreach from anon, authenticated;
revoke all on public.em_outreach_messages from anon, authenticated;
revoke all on public.em_checkins from anon, authenticated;

grant select, insert, update, delete on public.em_settings to authenticated;
grant select, insert, update, delete on public.em_storms to authenticated;
grant select, insert, update, delete on public.em_outreach to authenticated;
grant select, insert, update, delete on public.em_outreach_messages to authenticated;
grant select, insert, update, delete on public.em_checkins to authenticated;
