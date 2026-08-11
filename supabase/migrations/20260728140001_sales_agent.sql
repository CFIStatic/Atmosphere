-- ============================================================================
-- Sales Agent — outbound prospecting
-- ============================================================================
-- A sales rep names a territory and a focus. The agent researches businesses in
-- that area, crawls public pages for decision-makers, personalises outreach,
-- keeps following up until someone answers, and books the in-person meeting.
--
-- Conventions match the rest of Atmosphere:
--   * Every table is org-scoped and RLS-protected; reads/writes run under the
--     caller's JWT.
--   * Status columns are text + CHECK (not Postgres enums) so new stages are a
--     one-line migration.
--   * Nothing hard-deletes outreach history — campaigns pause, contacts stay.
-- ============================================================================

create schema if not exists private;

create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin new.updated_at := pg_catalog.now(); return new; end;
$$;

-- Who may run outbound sales work for an org.
create or replace function private.can_sell(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('sales', 'project_manager', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Campaigns
-- ----------------------------------------------------------------------------
create table if not exists public.sales_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 200),
  territory text not null check (char_length(territory) between 1 and 300),
  sales_focus text not null check (char_length(sales_focus) between 1 and 500),
  value_prop text check (value_prop is null or char_length(value_prop) <= 2000),
  sender_name text check (sender_name is null or char_length(sender_name) <= 120),
  sender_email text check (sender_email is null or char_length(sender_email) <= 254),
  meeting_duration_min int not null default 30
    check (meeting_duration_min between 15 and 180),
  -- Free-form weekly availability, e.g. {"mon":["09:00-12:00","13:00-17:00"],...}
  availability jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in (
      'draft', 'researching', 'crawling', 'outreach', 'following_up',
      'scheduling', 'paused', 'completed', 'failed'
    )),
  stage_detail text check (stage_detail is null or char_length(stage_detail) <= 2000),
  error text check (error is null or char_length(error) <= 4000),
  agent_run_id uuid,
  businesses_found int not null default 0 check (businesses_found >= 0),
  contacts_found int not null default 0 check (contacts_found >= 0),
  emails_sent int not null default 0 check (emails_sent >= 0),
  replies_received int not null default 0 check (replies_received >= 0),
  meetings_booked int not null default 0 check (meetings_booked >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_campaigns_org_created_idx
  on public.sales_campaigns (org_id, created_at desc);
create index if not exists sales_campaigns_org_status_idx
  on public.sales_campaigns (org_id, status);

drop trigger if exists sales_campaigns_touch on public.sales_campaigns;
create trigger sales_campaigns_touch
  before update on public.sales_campaigns
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Businesses discovered in the territory
-- ----------------------------------------------------------------------------
create table if not exists public.sales_businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  category text check (category is null or char_length(category) <= 200),
  address text check (address is null or char_length(address) <= 500),
  city text check (city is null or char_length(city) <= 120),
  region text check (region is null or char_length(region) <= 120),
  postal_code text check (postal_code is null or char_length(postal_code) <= 32),
  country text check (country is null or char_length(country) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  website_url text check (website_url is null or char_length(website_url) <= 1000),
  lat double precision,
  lng double precision,
  source text not null default 'research'
    check (source in ('research', 'overpass', 'manual', 'crawl', 'demo')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  research_notes text check (research_notes is null or char_length(research_notes) <= 8000),
  status text not null default 'discovered'
    check (status in (
      'discovered', 'researching', 'crawling', 'contacted', 'replied',
      'meeting_booked', 'skipped', 'failed'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedup within a campaign by name + website (empty website counts as blank).
create unique index if not exists sales_businesses_campaign_name_website_uidx
  on public.sales_businesses (campaign_id, lower(name), coalesce(lower(website_url), ''));

create index if not exists sales_businesses_campaign_idx
  on public.sales_businesses (campaign_id, created_at desc);
create index if not exists sales_businesses_org_status_idx
  on public.sales_businesses (org_id, status);

drop trigger if exists sales_businesses_touch on public.sales_businesses;
create trigger sales_businesses_touch
  before update on public.sales_businesses
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Decision makers / contacts at those businesses
-- ----------------------------------------------------------------------------
create table if not exists public.sales_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
  business_id uuid not null references public.sales_businesses(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  title text check (title is null or char_length(title) <= 200),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 1000),
  is_decision_maker boolean not null default true,
  research_summary text check (research_summary is null or char_length(research_summary) <= 8000),
  personalization_hooks jsonb not null default '[]'::jsonb,
  status text not null default 'identified'
    check (status in (
      'identified', 'researched', 'queued', 'emailed', 'followed_up',
      'replied', 'meeting_booked', 'unsubscribed', 'bounced', 'skipped'
    )),
  next_followup_at timestamptz,
  last_touched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_contacts_campaign_idx
  on public.sales_contacts (campaign_id, status);
create index if not exists sales_contacts_business_idx
  on public.sales_contacts (business_id);
create index if not exists sales_contacts_followup_idx
  on public.sales_contacts (org_id, next_followup_at)
  where next_followup_at is not null and status in ('emailed', 'followed_up', 'queued');

drop trigger if exists sales_contacts_touch on public.sales_contacts;
create trigger sales_contacts_touch
  before update on public.sales_contacts
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Outreach messages (outbound + inbound)
-- ----------------------------------------------------------------------------
create table if not exists public.sales_outreach (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
  contact_id uuid not null references public.sales_contacts(id) on delete cascade,
  business_id uuid not null references public.sales_businesses(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  channel text not null default 'email' check (channel in ('email', 'note', 'system')),
  subject text check (subject is null or char_length(subject) <= 500),
  body text not null check (char_length(body) between 1 and 20000),
  sequence_step int not null default 1 check (sequence_step between 1 and 20),
  status text not null default 'draft'
    check (status in (
      'draft', 'queued', 'sent', 'delivered', 'opened', 'replied',
      'bounced', 'failed', 'simulated'
    )),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  intent text check (intent is null or char_length(intent) <= 40),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_outreach_contact_idx
  on public.sales_outreach (contact_id, created_at desc);
create index if not exists sales_outreach_campaign_idx
  on public.sales_outreach (campaign_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Meetings booked by the agent
-- ----------------------------------------------------------------------------
create table if not exists public.sales_meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
  contact_id uuid not null references public.sales_contacts(id) on delete cascade,
  business_id uuid not null references public.sales_businesses(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text check (location is null or char_length(location) <= 500),
  meeting_url text check (meeting_url is null or char_length(meeting_url) <= 1000),
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'cancelled', 'completed', 'no_show')),
  booked_by text not null default 'agent'
    check (booked_by in ('agent', 'human')),
  notes text check (notes is null or char_length(notes) <= 4000),
  ics text check (ics is null or char_length(ics) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists sales_meetings_campaign_idx
  on public.sales_meetings (campaign_id, starts_at);
create index if not exists sales_meetings_org_starts_idx
  on public.sales_meetings (org_id, starts_at);

drop trigger if exists sales_meetings_touch on public.sales_meetings;
create trigger sales_meetings_touch
  before update on public.sales_meetings
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Campaign event timeline (agent + system + human)
-- ----------------------------------------------------------------------------
create table if not exists public.sales_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
  business_id uuid references public.sales_businesses(id) on delete set null,
  contact_id uuid references public.sales_contacts(id) on delete set null,
  actor_type text not null default 'agent'
    check (actor_type in ('user', 'agent', 'system')),
  event_type text not null check (char_length(event_type) between 1 and 60),
  detail text check (detail is null or char_length(detail) <= 4000),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_events_campaign_idx
  on public.sales_events (campaign_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sales_campaigns', 'sales_businesses', 'sales_contacts',
    'sales_outreach', 'sales_meetings', 'sales_events'
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
         with check (private.can_sell(org_id))', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.can_sell(org_id))
         with check (private.can_sell(org_id))', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (private.can_sell(org_id))', t || '_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.sales_campaigns, public.sales_businesses, public.sales_contacts,
  public.sales_outreach, public.sales_meetings, public.sales_events
  to authenticated;

revoke all on
  public.sales_campaigns, public.sales_businesses, public.sales_contacts,
  public.sales_outreach, public.sales_meetings, public.sales_events
  from anon;
