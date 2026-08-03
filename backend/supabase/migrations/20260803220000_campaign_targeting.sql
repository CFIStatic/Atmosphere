-- Location-based audiences and weather-triggered campaigns.
--
-- Restoration is not sold on a quarterly cadence. It is sold in the two days
-- before a storm and the week after one, to the person who has to deal with
-- the water. A campaign tool that cannot express "when hail is forecast for
-- Williamson County, email the facilities directors at every school in it"
-- is a mailing list with extra steps.
--
-- Three things this adds:
--
--   crm_places        Buildings worth knowing about — schools, hospitals,
--                     clinics — discovered from public map data and cached per
--                     org. A prospect that is a *place* rather than a person,
--                     because "every clinic in Round Rock" is how a
--                     salesperson actually thinks about a territory.
--
--   audience rules    What a campaign targets: place categories, an existing
--                     contact list, a territory, or a combination. Stored as
--                     a rule rather than a frozen list, so a campaign that
--                     fires next month picks up the school that opened this
--                     one.
--
--   weather triggers  What makes it fire, and how far ahead. A campaign can
--                     sit dormant for months and go out the moment a warning
--                     is issued for its territory.

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

create table if not exists public.crm_places (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,

  -- 'osm' today. Recorded so a place found in public map data is always
  -- distinguishable from one somebody typed in by hand.
  source        text not null default 'osm',
  external_id   text not null,

  -- Our vocabulary, not the map's: 'school', 'hospital', 'clinic',
  -- 'senior_living', 'hotel', 'church', 'government', 'retail', 'office'.
  category      text not null,
  name          text not null,

  street        text,
  city          text,
  state         text,
  postal_code   text,
  -- Kept so a future map view, and distance-from-branch sorting, need no
  -- re-fetch. Nothing in the product renders a map today.
  lat           double precision,
  lon           double precision,

  phone         text,
  website       text,

  -- Resolved when the place is imported, so "everything in North Austin" is a
  -- single indexed lookup rather than a string match across three columns.
  territory_id  uuid references public.crm_territories (id) on delete set null,

  -- Set once somebody at this place becomes a real contact — that is what
  -- stops a campaign pitching a building the team already sells to.
  contact_id    uuid references public.crm_contacts (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Re-running a search must update what it found rather than duplicate it.
create unique index if not exists crm_places_unique
  on public.crm_places (org_id, source, external_id);
create index if not exists crm_places_category_idx
  on public.crm_places (org_id, category);
create index if not exists crm_places_territory_idx
  on public.crm_places (territory_id);
create index if not exists crm_places_postal_idx
  on public.crm_places (org_id, postal_code);

comment on table public.crm_places is
  'Buildings worth selling to — schools, hospitals, clinics — from public map data. A prospect that is a place rather than a person.';

-- ---------------------------------------------------------------------------
-- Campaign targeting and triggering
-- ---------------------------------------------------------------------------

do $$ begin
  create type crm_campaign_trigger as enum ('manual', 'weather', 'seasonal');
exception when duplicate_object then null; end $$;

alter table public.crm_campaigns
  add column if not exists trigger_kind crm_campaign_trigger not null default 'manual';

-- What makes it fire. For 'weather':
--   { events: ['Severe Thunderstorm Warning'], severities: ['Severe','Extreme'],
--     leadTimeHours: 48, cooldownDays: 14 }
alter table public.crm_campaigns
  add column if not exists trigger_config jsonb not null default '{}'::jsonb;

-- Who it goes to, as a rule rather than a list:
--   { places: { categories: ['school','hospital'] }, contacts: true,
--     territoryId: '…', titleKeywords: ['facilities','operations'] }
alter table public.crm_campaigns
  add column if not exists audience_config jsonb not null default '{}'::jsonb;

-- What actually gets sent. Kept on the campaign because the whole point is
-- that the message is written once, in advance, and goes out while the
-- salesperson is asleep.
alter table public.crm_campaigns
  add column if not exists message_subject text;
alter table public.crm_campaigns
  add column if not exists message_body text;

alter table public.crm_campaigns
  drop constraint if exists crm_campaigns_config_shape;
alter table public.crm_campaigns
  add constraint crm_campaigns_config_shape
  check (
    jsonb_typeof(trigger_config) = 'object'
    and jsonb_typeof(audience_config) = 'object'
  );

-- ---------------------------------------------------------------------------
-- Firing history
-- ---------------------------------------------------------------------------

-- Why a campaign went out, and to how many.
--
-- Without this a weather-triggered campaign is unauditable: nobody can answer
-- "why did these forty people get an email on Tuesday?" six weeks later, and
-- the cooldown that stops a three-day storm producing three identical mailings
-- has nothing to check against.
create table if not exists public.crm_campaign_fires (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  campaign_id   uuid not null references public.crm_campaigns (id) on delete cascade,

  -- 'weather' | 'manual'. What set it off.
  reason        text not null,
  -- The alert that caused it: event name, severity, area, and the issuing
  -- office's own identifier so it can be looked up again.
  alert_id      text,
  alert_event   text,
  alert_area    text,
  alert_expires timestamptz,

  recipients    integer not null default 0,
  fired_at      timestamptz not null default now(),
  fired_by      uuid references public.profiles (id) on delete set null
);

create index if not exists crm_campaign_fires_campaign_idx
  on public.crm_campaign_fires (campaign_id, fired_at desc);
-- One alert fires one campaign once, however many times the poller sees it.
create unique index if not exists crm_campaign_fires_alert_unique
  on public.crm_campaign_fires (campaign_id, alert_id)
  where alert_id is not null;

comment on table public.crm_campaign_fires is
  'Why a campaign went out and to how many. The alert_id unique index is what stops a three-day storm producing three identical mailings.';

-- ---------------------------------------------------------------------------
-- RLS — membership is the whole test, as elsewhere in the CRM.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['crm_places', 'crm_campaign_fires']
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
