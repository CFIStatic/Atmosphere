-- Campaigns and Territories — the two things a sales platform needs that the
-- pipeline alone cannot express.
--
-- The pipeline answers "what is happening with this lead". Neither of these
-- does, and that is why they are separate tables rather than columns on
-- crm_leads:
--
--   A territory is a claim on a patch of the world — a metro, a set of ZIPs, a
--   county — with one person accountable for it. It exists before any lead in
--   it does, and it outlives every one of them. Restoration is sold
--   geographically because that is how storms, adjusters and drive times work,
--   so "who owns Round Rock" is a question the product has to be able to
--   answer.
--
--   A campaign is a deliberate sequence of touches aimed at a set of people.
--   Its unit of work is the outreach, not the opportunity: the same person can
--   be in three campaigns and have no lead at all, and the campaign still needs
--   to know whether they were emailed on Tuesday.
--
-- Both are org-scoped and follow the same RLS shape as the rest of the CRM:
-- membership is the whole test, because everyone in a restoration company can
-- see the company's own sales data.

-- ---------------------------------------------------------------------------
-- Territories
-- ---------------------------------------------------------------------------

create table if not exists public.crm_territories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  description text,
  -- Who is accountable. Null is legitimate and visible on purpose: an
  -- unassigned territory is a gap somebody should notice, not a tidy default.
  owner_id    uuid references public.profiles (id) on delete set null,
  -- How the area is described. Free-form rather than a geometry type: sales
  -- teams say "Austin metro" and "787xx" and "Williamson County", and forcing
  -- those into polygons would make the feature unusable to the people who need
  -- it. PostGIS can come later if anyone ever wants a map.
  postal_codes text[] not null default '{}',
  cities       text[] not null default '{}',
  counties     text[] not null default '{}',
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists crm_territories_org_idx on public.crm_territories (org_id);
create index if not exists crm_territories_owner_idx on public.crm_territories (owner_id);
-- One name per org, so "Austin" cannot quietly become two territories that
-- each think they own it.
create unique index if not exists crm_territories_name_unique
  on public.crm_territories (org_id, lower(btrim(name)));

comment on table public.crm_territories is
  'A named geographic patch with one person accountable for it. Areas are described the way sales teams talk — ZIPs, cities, counties — not as geometry.';

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

do $$ begin
  create type crm_campaign_status as enum ('draft', 'active', 'paused', 'finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_campaign_channel as enum ('email', 'call', 'mixed');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_campaigns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 160),
  goal         text,
  channel      crm_campaign_channel not null default 'email',
  status       crm_campaign_status not null default 'draft',
  -- Campaigns are usually worked a territory at a time; nulls are fine for the
  -- ones that are not.
  territory_id uuid references public.crm_territories (id) on delete set null,
  owner_id     uuid references public.profiles (id) on delete set null,
  starts_on    date,
  ends_on      date,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_campaigns_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists crm_campaigns_org_idx on public.crm_campaigns (org_id, status);

-- Who is in a campaign, and what has happened to them.
--
-- A member references a contact rather than a lead, deliberately: outreach
-- happens to people, and most of them do not have a lead yet — creating one on
-- the way in would fill the pipeline with opportunities nobody has agreed
-- exist.
create table if not exists public.crm_campaign_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  campaign_id uuid not null references public.crm_campaigns (id) on delete cascade,
  contact_id  uuid references public.crm_contacts (id) on delete cascade,
  -- A prospect can be campaigned before anyone imports them as a contact.
  prospect_id uuid references public.crm_prospects (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed', 'skipped')),
  last_touch_at timestamptz,
  touches     integer not null default 0 check (touches >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A member is one person or the other, never neither.
  constraint crm_campaign_members_subject
    check (contact_id is not null or prospect_id is not null)
);

create index if not exists crm_campaign_members_campaign_idx
  on public.crm_campaign_members (campaign_id, status);

-- The same person cannot be added to one campaign twice. Two partial indexes
-- rather than one over both columns, because a NULL in a unique index does not
-- collide and the duplicate would slip straight through.
create unique index if not exists crm_campaign_members_contact_unique
  on public.crm_campaign_members (campaign_id, contact_id)
  where contact_id is not null;
create unique index if not exists crm_campaign_members_prospect_unique
  on public.crm_campaign_members (campaign_id, prospect_id)
  where prospect_id is not null;

comment on table public.crm_campaign_members is
  'Who is in a campaign and what has happened to them. References a contact or a prospect — outreach happens to people, most of whom have no lead yet.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as the rest of the CRM: membership is the whole test.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['crm_territories', 'crm_campaigns', 'crm_campaign_members']
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
