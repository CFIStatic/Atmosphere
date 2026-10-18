-- ============================================================================
-- Project Manager Agent — multi-platform orchestration
-- ============================================================================
-- Extends the PM agent so a human project manager can run many more jobs:
-- Atmosphere watches Dash, XactAnalysis, Xactimate and Outlook; documents
-- conversations when someone @atmosphere-mentions the agent in iMessage,
-- WhatsApp, Signal or SMS; derives equipment lists from estimates; collects
-- dumpster/material bids; and routes vendor material orders through Atmosphere
-- referral links. The human still decides — every irreversible action lands
-- in pm_approvals first.
--
-- Conventions match 20260727181539_project_manager_agent.sql:
--   * org-scoped + RLS under the caller's JWT (webhook intake is the one
--     service-role path, gated by a signing secret)
--   * nothing is deleted
--   * text + CHECK, money in integer cents
--   * child org_id overwritten from the parent project
-- ============================================================================

create schema if not exists private;

-- Widen alert categories so orchestration findings share pm_alerts.
alter table public.pm_alerts drop constraint if exists pm_alerts_category_check;
alter table public.pm_alerts
  add constraint pm_alerts_category_check
  check (category in (
    'general', 'drying', 'equipment', 'scheduling',
    'documentation', 'insurance', 'billing', 'customer',
    'orchestration', 'communication', 'procurement'
  ));

-- Widen task categories for generated procurement / platform work.
alter table public.pm_tasks drop constraint if exists pm_tasks_category_check;
alter table public.pm_tasks
  add constraint pm_tasks_category_check
  check (category in (
    'general', 'documentation', 'drying', 'equipment', 'scheduling',
    'customer', 'insurance', 'inspection', 'billing',
    'procurement', 'platform', 'communication'
  ));

-- ----------------------------------------------------------------------------
-- 1. Platform connections (org-level)
-- ----------------------------------------------------------------------------
-- Dash, XactAnalysis, Xactimate, Outlook. Credentials are never stored here —
-- live secrets stay in the estimator vault / web-access vault / env. This row
-- only records that the org has linked the platform and how recently we synced.

create table if not exists public.pm_platform_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  platform        text not null
                    check (platform in ('dash', 'xactanalysis', 'xactimate', 'outlook')),
  label           text check (label is null or length(label) <= 120),
  status          text not null default 'connected'
                    check (status in ('connected', 'disconnected', 'error', 'pending')),
  external_account_id text check (external_account_id is null or length(external_account_id) <= 200),
  last_synced_at  timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 2000),
  metadata        jsonb not null default '{}'::jsonb,
  connected_by    uuid references auth.users(id),
  connected_at    timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pm_platform_connections_unique unique (org_id, platform)
);

comment on table public.pm_platform_connections is
  'Org-level link to an external production platform the PM agent orchestrates.';

drop trigger if exists pm_platform_connections_touch on public.pm_platform_connections;
create trigger pm_platform_connections_touch
  before update on public.pm_platform_connections
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Project ↔ external object links
-- ----------------------------------------------------------------------------

create table if not exists public.pm_platform_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  platform        text not null
                    check (platform in ('dash', 'xactanalysis', 'xactimate', 'outlook')),
  external_id     text not null check (length(btrim(external_id)) between 1 and 200),
  external_url    text check (external_url is null or length(external_url) <= 1000),
  external_label  text check (external_label is null or length(external_label) <= 200),
  sync_status     text not null default 'linked'
                    check (sync_status in ('linked', 'syncing', 'synced', 'stale', 'error')),
  last_synced_at  timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 2000),
  metadata        jsonb not null default '{}'::jsonb,
  linked_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pm_platform_links_unique unique (org_id, platform, external_id)
);

create index if not exists pm_platform_links_project_idx
  on public.pm_platform_links (project_id, platform);

drop trigger if exists pm_platform_links_touch on public.pm_platform_links;
create trigger pm_platform_links_touch
  before update on public.pm_platform_links
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_platform_links_fill_org on public.pm_platform_links;
create trigger pm_platform_links_fill_org
  before insert on public.pm_platform_links
  for each row execute function private.pm_fill_org_from_project();

-- ----------------------------------------------------------------------------
-- 3. Platform event log (append-oriented)
-- ----------------------------------------------------------------------------

create table if not exists public.pm_platform_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid references public.pm_projects(id),
  platform        text not null
                    check (platform in ('dash', 'xactanalysis', 'xactimate', 'outlook')),
  event_kind      text not null check (length(btrim(event_kind)) between 2 and 80),
  direction       text not null default 'inbound'
                    check (direction in ('inbound', 'outbound', 'internal')),
  summary         text not null check (length(btrim(summary)) between 2 and 500),
  detail          text check (detail is null or length(detail) <= 8000),
  external_id     text check (external_id is null or length(external_id) <= 200),
  payload         jsonb not null default '{}'::jsonb,
  -- Needs a human before anything irreversible happens.
  requires_approval boolean not null default false,
  approval_id     uuid,
  occurred_at     timestamptz not null default now(),
  recorded_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists pm_platform_events_project_idx
  on public.pm_platform_events (project_id, occurred_at desc);
create index if not exists pm_platform_events_org_idx
  on public.pm_platform_events (org_id, occurred_at desc);

-- No UPDATE grant later — events are a log. Corrections are new rows.

-- ----------------------------------------------------------------------------
-- 4. Communications inbox (@atmosphere mentions)
-- ----------------------------------------------------------------------------

create table if not exists public.pm_communications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid references public.pm_projects(id),

  channel         text not null
                    check (channel in (
                      'imessage', 'whatsapp', 'signal', 'sms', 'email', 'outlook', 'other'
                    )),
  direction       text not null default 'inbound'
                    check (direction in ('inbound', 'outbound', 'note')),
  -- How Atmosphere got involved: explicit @atmosphere mention, a relay, or a
  -- human filing a note after the fact.
  intake          text not null default 'mention'
                    check (intake in ('mention', 'relay', 'manual', 'platform_sync')),

  counterparty_name  text check (counterparty_name is null or length(counterparty_name) <= 160),
  counterparty_handle text check (counterparty_handle is null or length(counterparty_handle) <= 200),
  counterparty_kind  text not null default 'unknown'
                    check (counterparty_kind in (
                      'vendor', 'customer', 'adjuster', 'crew', 'carrier', 'supplier', 'unknown'
                    )),

  body            text not null check (length(btrim(body)) between 1 and 16000),
  mention_excerpt text check (mention_excerpt is null or length(mention_excerpt) <= 2000),
  thread_key      text check (thread_key is null or length(thread_key) <= 200),
  external_message_id text check (external_message_id is null or length(external_message_id) <= 200),

  -- Dedup across retries from a bridge.
  fingerprint     text not null check (length(btrim(fingerprint)) between 2 and 400),

  status          text not null default 'new'
                    check (status in ('new', 'reviewed', 'filed', 'actioned', 'ignored')),
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id),
  metadata        jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint pm_communications_fingerprint_unique unique (org_id, fingerprint)
);

comment on table public.pm_communications is
  'Documented conversations involving Atmosphere — especially @atmosphere mentions '
  'from iMessage, WhatsApp, Signal and SMS bridges — so the PM can see what vendors '
  'and others said without hunting threads.';

create index if not exists pm_communications_project_idx
  on public.pm_communications (project_id, occurred_at desc);
create index if not exists pm_communications_open_idx
  on public.pm_communications (org_id, status, occurred_at desc)
  where status in ('new', 'reviewed');

drop trigger if exists pm_communications_touch on public.pm_communications;
create trigger pm_communications_touch
  before update on public.pm_communications
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_communications_fill_org on public.pm_communications;
create trigger pm_communications_fill_org
  before insert on public.pm_communications
  for each row execute function private.pm_fill_org_from_project();

-- ----------------------------------------------------------------------------
-- 5. Approvals — the human-in-the-loop queue
-- ----------------------------------------------------------------------------

create table if not exists public.pm_approvals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid references public.pm_projects(id),

  kind            text not null check (length(btrim(kind)) between 2 and 80),
  title           text not null check (length(btrim(title)) between 2 and 200),
  detail          text check (detail is null or length(detail) <= 8000),
  -- What will happen if approved: platform write, material order, bid accept, …
  proposed_action jsonb not null default '{}'::jsonb,
  platform        text check (platform is null or platform in (
                    'dash', 'xactanalysis', 'xactimate', 'outlook',
                    'referral', 'web', 'messaging', 'internal'
                  )),
  priority        text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'expired', 'executed')),
  requested_by    uuid references auth.users(id),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 2000),
  executed_at     timestamptz,
  execution_result jsonb not null default '{}'::jsonb,
  expires_at      timestamptz,
  source_ref      text check (source_ref is null or length(source_ref) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pm_approvals_pending_idx
  on public.pm_approvals (org_id, priority, created_at)
  where status = 'pending';
create index if not exists pm_approvals_project_idx
  on public.pm_approvals (project_id, status);

drop trigger if exists pm_approvals_touch on public.pm_approvals;
create trigger pm_approvals_touch
  before update on public.pm_approvals
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_approvals_fill_org on public.pm_approvals;
create trigger pm_approvals_fill_org
  before insert on public.pm_approvals
  for each row execute function private.pm_fill_org_from_project();

-- ----------------------------------------------------------------------------
-- 6. Equipment plans (from mitigation / construction estimates)
-- ----------------------------------------------------------------------------

create table if not exists public.pm_equipment_plans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  source          text not null
                    check (source in ('mitigation_estimate', 'construction_estimate', 'manual', 's500')),
  source_ref      text check (source_ref is null or length(source_ref) <= 200),
  status          text not null default 'draft'
                    check (status in ('draft', 'approved', 'in_progress', 'fulfilled', 'cancelled')),
  summary         text check (summary is null or length(summary) <= 2000),
  dumpster_required boolean not null default false,
  created_by      uuid references auth.users(id),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pm_equipment_plans_project_idx
  on public.pm_equipment_plans (project_id, status);

drop trigger if exists pm_equipment_plans_touch on public.pm_equipment_plans;
create trigger pm_equipment_plans_touch
  before update on public.pm_equipment_plans
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_equipment_plans_fill_org on public.pm_equipment_plans;
create trigger pm_equipment_plans_fill_org
  before insert on public.pm_equipment_plans
  for each row execute function private.pm_fill_org_from_project();

create table if not exists public.pm_equipment_plan_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  plan_id         uuid not null references public.pm_equipment_plans(id),
  project_id      uuid not null references public.pm_projects(id),

  item_kind       text not null check (length(btrim(item_kind)) between 2 and 60),
  label           text not null check (length(btrim(label)) between 1 and 160),
  quantity        numeric(12,2) not null default 1 check (quantity > 0),
  unit            text not null default 'ea' check (length(btrim(unit)) between 1 and 20),
  fulfillment     text not null default 'inventory'
                    check (fulfillment in (
                      'inventory', 'rent', 'buy', 'referral', 'bid', 'crew'
                    )),
  status          text not null default 'needed'
                    check (status in ('needed', 'reserved', 'ordered', 'on_site', 'returned', 'cancelled')),
  notes           text check (notes is null or length(notes) <= 2000),
  estimate_code   text check (estimate_code is null or length(estimate_code) <= 40),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pm_equipment_plan_items_plan_idx
  on public.pm_equipment_plan_items (plan_id, status);

drop trigger if exists pm_equipment_plan_items_touch on public.pm_equipment_plan_items;
create trigger pm_equipment_plan_items_touch
  before update on public.pm_equipment_plan_items
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_equipment_plan_items_fill_org on public.pm_equipment_plan_items;
create trigger pm_equipment_plan_items_fill_org
  before insert on public.pm_equipment_plan_items
  for each row execute function private.pm_fill_org_from_project();

-- ----------------------------------------------------------------------------
-- 7. Procurement (dumpster bids, material referral orders)
-- ----------------------------------------------------------------------------

create table if not exists public.pm_vendor_referrals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid, -- null = Atmosphere-wide catalogue row
  vendor_key      text not null check (length(btrim(vendor_key)) between 2 and 40),
  name            text not null check (length(btrim(name)) between 2 and 120),
  category        text not null default 'building_materials'
                    check (category in (
                      'building_materials', 'dumpster', 'equipment_rental',
                      'specialty', 'other'
                    )),
  base_url        text not null check (length(btrim(base_url)) between 8 and 500),
  -- Query/path template. {sku}, {q}, {zip}, {ref} are substituted at order time.
  link_template   text not null check (length(btrim(link_template)) between 8 and 1000),
  referral_param  text not null default 'ref'
                    check (length(btrim(referral_param)) between 1 and 40),
  atmosphere_ref_code text not null default 'atmosphere'
                    check (length(btrim(atmosphere_ref_code)) between 2 and 80),
  commission_bps  integer not null default 0 check (commission_bps between 0 and 10000),
  active          boolean not null default true,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- NULL org_id is the Atmosphere-wide catalogue; Postgres treats NULLs as
-- distinct in UNIQUE constraints, so we need partial indexes instead.
create unique index if not exists pm_vendor_referrals_global_key
  on public.pm_vendor_referrals (vendor_key) where org_id is null;
create unique index if not exists pm_vendor_referrals_org_key
  on public.pm_vendor_referrals (org_id, vendor_key) where org_id is not null;

comment on table public.pm_vendor_referrals is
  'Vendors Atmosphere can deep-link into (Home Depot, Lowe''s, …) so material '
  'orders carry a referral code and Atmosphere earns a cut.';

drop trigger if exists pm_vendor_referrals_touch on public.pm_vendor_referrals;
create trigger pm_vendor_referrals_touch
  before update on public.pm_vendor_referrals
  for each row execute function private.touch_updated_at();

create table if not exists public.pm_procurement_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  plan_item_id    uuid references public.pm_equipment_plan_items(id),

  kind            text not null
                    check (kind in ('dumpster', 'material', 'equipment_rental', 'other')),
  title           text not null check (length(btrim(title)) between 2 and 200),
  description     text check (description is null or length(description) <= 4000),
  quantity        numeric(12,2) check (quantity is null or quantity > 0),
  unit            text check (unit is null or length(unit) <= 20),
  ship_to_postal   text check (ship_to_postal is null or length(ship_to_postal) <= 20),
  ship_to_address text check (ship_to_address is null or length(ship_to_address) <= 500),

  status          text not null default 'open'
                    check (status in (
                      'open', 'bidding', 'awaiting_approval', 'ordered',
                      'fulfilled', 'cancelled'
                    )),
  selected_bid_id uuid,
  referral_vendor_key text check (referral_vendor_key is null or length(referral_vendor_key) <= 40),
  referral_url    text check (referral_url is null or length(referral_url) <= 1000),
  approval_id     uuid references public.pm_approvals(id),
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pm_procurement_requests_project_idx
  on public.pm_procurement_requests (project_id, status);
create index if not exists pm_procurement_requests_open_idx
  on public.pm_procurement_requests (org_id, status, created_at desc)
  where status in ('open', 'bidding', 'awaiting_approval');

drop trigger if exists pm_procurement_requests_touch on public.pm_procurement_requests;
create trigger pm_procurement_requests_touch
  before update on public.pm_procurement_requests
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_procurement_requests_fill_org on public.pm_procurement_requests;
create trigger pm_procurement_requests_fill_org
  before insert on public.pm_procurement_requests
  for each row execute function private.pm_fill_org_from_project();

create table if not exists public.pm_procurement_bids (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  request_id      uuid not null references public.pm_procurement_requests(id),
  project_id      uuid not null references public.pm_projects(id),

  vendor_name     text not null check (length(btrim(vendor_name)) between 1 and 160),
  vendor_url      text check (vendor_url is null or length(vendor_url) <= 1000),
  vendor_phone    text check (vendor_phone is null or length(vendor_phone) <= 40),
  amount_cents    integer check (amount_cents is null or amount_cents >= 0),
  currency        text not null default 'usd' check (length(currency) = 3),
  lead_days       integer check (lead_days is null or lead_days >= 0),
  notes           text check (notes is null or length(notes) <= 2000),
  source          text not null default 'web_search'
                    check (source in ('web_search', 'manual', 'referral', 'api')),
  status          text not null default 'collected'
                    check (status in ('collected', 'shortlisted', 'selected', 'rejected', 'expired')),
  raw             jsonb not null default '{}'::jsonb,
  collected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists pm_procurement_bids_request_idx
  on public.pm_procurement_bids (request_id, amount_cents nulls last);

drop trigger if exists pm_procurement_bids_fill_org on public.pm_procurement_bids;
create trigger pm_procurement_bids_fill_org
  before insert on public.pm_procurement_bids
  for each row execute function private.pm_fill_org_from_project();

-- Seed the Atmosphere-wide referral catalogue (org_id null). Orgs can override
-- per-vendor with their own row.
insert into public.pm_vendor_referrals
  (org_id, vendor_key, name, category, base_url, link_template, referral_param, atmosphere_ref_code, commission_bps)
values
  (null, 'homedepot', 'Home Depot', 'building_materials',
   'https://www.homedepot.com',
   'https://www.homedepot.com/s/{q}?ref={ref}',
   'ref', 'atmosphere', 200),
  (null, 'lowes', 'Lowe''s', 'building_materials',
   'https://www.lowes.com',
   'https://www.lowes.com/search?searchTerm={q}&cm_mmc={ref}',
   'cm_mmc', 'atmosphere', 200),
  (null, 'abc_supply', 'ABC Supply', 'building_materials',
   'https://www.abcsupply.com',
   'https://www.abcsupply.com/search?q={q}&ref={ref}',
   'ref', 'atmosphere', 250),
  (null, 'siteone', 'SiteOne Landscape Supply', 'specialty',
   'https://www.siteone.com',
   'https://www.siteone.com/en/search/?text={q}&ref={ref}',
   'ref', 'atmosphere', 200)
on conflict (vendor_key) where org_id is null do nothing;

-- ----------------------------------------------------------------------------
-- 8. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.pm_platform_connections enable row level security;
alter table public.pm_platform_links       enable row level security;
alter table public.pm_platform_events      enable row level security;
alter table public.pm_communications       enable row level security;
alter table public.pm_approvals            enable row level security;
alter table public.pm_equipment_plans      enable row level security;
alter table public.pm_equipment_plan_items enable row level security;
alter table public.pm_vendor_referrals     enable row level security;
alter table public.pm_procurement_requests enable row level security;
alter table public.pm_procurement_bids     enable row level security;

-- Connections / links / approvals / plans / procurement: managers plan; members read.
drop policy if exists pm_platform_connections_select on public.pm_platform_connections;
create policy pm_platform_connections_select on public.pm_platform_connections
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_platform_connections_insert on public.pm_platform_connections;
create policy pm_platform_connections_insert on public.pm_platform_connections
  for insert to authenticated with check (private.pm_can_manage(org_id));
drop policy if exists pm_platform_connections_update on public.pm_platform_connections;
create policy pm_platform_connections_update on public.pm_platform_connections
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_platform_links_select on public.pm_platform_links;
create policy pm_platform_links_select on public.pm_platform_links
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_platform_links_insert on public.pm_platform_links;
create policy pm_platform_links_insert on public.pm_platform_links
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.pm_project_in_org(project_id, org_id));
drop policy if exists pm_platform_links_update on public.pm_platform_links;
create policy pm_platform_links_update on public.pm_platform_links
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_platform_events_select on public.pm_platform_events;
create policy pm_platform_events_select on public.pm_platform_events
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_platform_events_insert on public.pm_platform_events;
create policy pm_platform_events_insert on public.pm_platform_events
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and (project_id is null or private.pm_project_in_org(project_id, org_id))
  );
-- No update policy: events are a log.

drop policy if exists pm_communications_select on public.pm_communications;
create policy pm_communications_select on public.pm_communications
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_communications_insert on public.pm_communications;
create policy pm_communications_insert on public.pm_communications
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and (project_id is null or private.pm_project_in_org(project_id, org_id))
  );
drop policy if exists pm_communications_update on public.pm_communications;
create policy pm_communications_update on public.pm_communications
  for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists pm_approvals_select on public.pm_approvals;
create policy pm_approvals_select on public.pm_approvals
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_approvals_insert on public.pm_approvals;
create policy pm_approvals_insert on public.pm_approvals
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and (project_id is null or private.pm_project_in_org(project_id, org_id))
  );
drop policy if exists pm_approvals_update on public.pm_approvals;
create policy pm_approvals_update on public.pm_approvals
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_equipment_plans_select on public.pm_equipment_plans;
create policy pm_equipment_plans_select on public.pm_equipment_plans
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_equipment_plans_insert on public.pm_equipment_plans;
create policy pm_equipment_plans_insert on public.pm_equipment_plans
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.pm_project_in_org(project_id, org_id));
drop policy if exists pm_equipment_plans_update on public.pm_equipment_plans;
create policy pm_equipment_plans_update on public.pm_equipment_plans
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_equipment_plan_items_select on public.pm_equipment_plan_items;
create policy pm_equipment_plan_items_select on public.pm_equipment_plan_items
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_equipment_plan_items_insert on public.pm_equipment_plan_items;
create policy pm_equipment_plan_items_insert on public.pm_equipment_plan_items
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.pm_project_in_org(project_id, org_id));
drop policy if exists pm_equipment_plan_items_update on public.pm_equipment_plan_items;
create policy pm_equipment_plan_items_update on public.pm_equipment_plan_items
  for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- Global catalogue (org_id null) is readable by any authenticated user; org
-- overrides are member-only. Writes are manager-only for that org.
drop policy if exists pm_vendor_referrals_select on public.pm_vendor_referrals;
create policy pm_vendor_referrals_select on public.pm_vendor_referrals
  for select to authenticated
  using (org_id is null or private.is_org_member(org_id));
drop policy if exists pm_vendor_referrals_insert on public.pm_vendor_referrals;
create policy pm_vendor_referrals_insert on public.pm_vendor_referrals
  for insert to authenticated
  with check (org_id is not null and private.pm_can_manage(org_id));
drop policy if exists pm_vendor_referrals_update on public.pm_vendor_referrals;
create policy pm_vendor_referrals_update on public.pm_vendor_referrals
  for update to authenticated
  using (org_id is not null and private.pm_can_manage(org_id))
  with check (org_id is not null and private.pm_can_manage(org_id));

drop policy if exists pm_procurement_requests_select on public.pm_procurement_requests;
create policy pm_procurement_requests_select on public.pm_procurement_requests
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_procurement_requests_insert on public.pm_procurement_requests;
create policy pm_procurement_requests_insert on public.pm_procurement_requests
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.pm_project_in_org(project_id, org_id));
drop policy if exists pm_procurement_requests_update on public.pm_procurement_requests;
create policy pm_procurement_requests_update on public.pm_procurement_requests
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_procurement_bids_select on public.pm_procurement_bids;
create policy pm_procurement_bids_select on public.pm_procurement_bids
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists pm_procurement_bids_insert on public.pm_procurement_bids;
create policy pm_procurement_bids_insert on public.pm_procurement_bids
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.pm_project_in_org(project_id, org_id));
drop policy if exists pm_procurement_bids_update on public.pm_procurement_bids;
create policy pm_procurement_bids_update on public.pm_procurement_bids
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

-- Grants: SELECT/INSERT/UPDATE where policies allow; never DELETE.
grant select, insert, update on
  public.pm_platform_connections,
  public.pm_platform_links,
  public.pm_communications,
  public.pm_approvals,
  public.pm_equipment_plans,
  public.pm_equipment_plan_items,
  public.pm_vendor_referrals,
  public.pm_procurement_requests,
  public.pm_procurement_bids
to authenticated;

grant select, insert on public.pm_platform_events to authenticated;

revoke all on
  public.pm_platform_connections,
  public.pm_platform_links,
  public.pm_platform_events,
  public.pm_communications,
  public.pm_approvals,
  public.pm_equipment_plans,
  public.pm_equipment_plan_items,
  public.pm_vendor_referrals,
  public.pm_procurement_requests,
  public.pm_procurement_bids
from anon;
