-- ============================================================================
-- Financial Agent
-- ============================================================================
-- Monitors the financial health of the business for the CEO, CFO, and
-- accountants: cash and bank visibility (read-only), AR aging, job costing,
-- and connections into QuickBooks / Intuit / other online accounting software.
--
-- Conventions, matching the rest of the project:
--   * Every table is org-scoped and RLS-protected; reads and writes happen under
--     the caller's JWT, never the service-role key (except optional schedulers).
--   * Nothing is deleted. Connections are disabled, alerts are resolved, cost
--     lines are voided. A DELETE loses the answer to "when did that invoice age?"
--   * Status/enum-like columns are text + CHECK rather than Postgres enums.
--   * Customer money is integer cents. Never floats.
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 0. Shared helpers
-- ----------------------------------------------------------------------------

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

create or replace function private.finance_current_org()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select om.org_id
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;
$$;

-- Who may change the books plan (connections, cost codes, settings, drafts).
-- Accountants and office managers are the CFO desk; the org creator covers the
-- CEO who set the company up. Field / sales can read job cost but not rewire
-- the bank connection.
create or replace function private.can_manage_finance(p_org uuid)
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
      and m.role in ('accountant', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- 0b. Usage intent — financial agent
-- ----------------------------------------------------------------------------
-- Extends the onboarding multi-select so a member can declare they came for
-- the books. Drop + recreate the check: Postgres cannot alter array contents
-- of an existing CHECK in place.

alter table public.org_members
  drop constraint if exists org_members_usage_intents_check;

alter table public.org_members
  add constraint org_members_usage_intents_check
  check (
    usage_intents <@ array[
      'mitigation_estimating',
      'construction_estimating',
      'project_management',
      'crm',
      'web_access',
      'field_work',
      'billing',
      'financial',
      'exploring'
    ]::text[]
  );

-- ----------------------------------------------------------------------------
-- 1. Automation settings (per org)
-- ----------------------------------------------------------------------------

create table if not exists public.finance_automation_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,

  enabled boolean not null default true,
  timezone text not null default 'America/New_York'
    check (length(btrim(timezone)) between 1 and 64),
  digest_hour smallint not null default 7
    check (digest_hour between 0 and 23),

  -- AR aging thresholds (days since invoice / job start proxy).
  ar_warn_days integer not null default 30 check (ar_warn_days between 1 and 365),
  ar_critical_days integer not null default 45 check (ar_critical_days between 1 and 365),

  -- Job costing floors.
  margin_floor_pct numeric(5, 2) not null default 15
    check (margin_floor_pct between 0 and 100),
  over_budget_pct numeric(5, 2) not null default 100
    check (over_budget_pct between 50 and 500),
  unbilled_cost_warn_cents bigint not null default 500000
    check (unbilled_cost_warn_cents >= 0),

  -- Cash runway floor (cents across connected bank accounts).
  cash_floor_cents bigint not null default 1000000
    check (cash_floor_cents >= 0),

  -- How stale a connection may go before we alert (hours).
  connection_stale_hours integer not null default 48
    check (connection_stale_hours between 1 and 720),

  -- Bank vs books divergence tolerance (cents).
  books_balance_tolerance_cents bigint not null default 10000
    check (books_balance_tolerance_cents >= 0),

  -- Default burdened labor rate used when rolling work_logs into job cost
  -- before an accountant posts a finer line (cents per hour).
  default_labor_rate_cents bigint not null default 6500
    check (default_labor_rate_cents >= 0),

  disabled_rules text[] not null default '{}',

  updated_at timestamptz not null default now(),

  constraint finance_settings_ar_ordered check (ar_critical_days >= ar_warn_days)
);

comment on table public.finance_automation_settings is
  'Per-org knobs for the Financial Agent: aging, margin floors, cash runway, connection freshness.';

drop trigger if exists finance_automation_settings_touch on public.finance_automation_settings;
create trigger finance_automation_settings_touch
  before update on public.finance_automation_settings
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Connections — bank + accounting software (read-only by default)
-- ----------------------------------------------------------------------------

create table if not exists public.finance_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  -- Human label: "Operating checking", "QuickBooks Online", "Xero".
  label text not null check (length(btrim(label)) between 2 and 120),

  -- bank | accounting
  kind text not null check (kind in ('bank', 'accounting')),

  -- Provider vocabulary. quickbooks covers Intuit QBO; generic_accounting is
  -- any REST/CSV books system; bank_portal is Web Access into a bank UI.
  provider text not null check (provider in (
    'quickbooks',
    'xero',
    'wave',
    'freshbooks',
    'sage',
    'generic_accounting',
    'plaid',
    'bank_portal',
    'manual'
  )),

  -- How Atmosphere reaches it.
  access_path text not null default 'api'
    check (access_path in ('api', 'web_access', 'computer_use', 'csv', 'manual')),

  -- Hard rule: the agent observes. Writes are drafts elsewhere.
  access_mode text not null default 'read_only'
    check (access_mode in ('read_only', 'draft_writes')),

  -- Non-secret connector config (base URLs, realm ids, entity lists).
  config jsonb not null default '{}'::jsonb,

  -- Name of the env secret only — never the value.
  credential_ref text check (
    credential_ref is null or credential_ref ~ '^[A-Z0-9_]{1,64}$'
  ),

  -- Optional link into Web Access / Computer Use when those paths are used.
  web_connection_id uuid,
  computer_machine_id uuid,

  enabled boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disabled')),
  status_detail text check (status_detail is null or length(status_detail) <= 2000),

  last_sync_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 4000),

  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.finance_connections is
  'Read-only (by default) links into bank accounts and online accounting software for the Financial Agent.';

create index if not exists finance_connections_org_idx
  on public.finance_connections (org_id, enabled, kind);

drop trigger if exists finance_connections_touch on public.finance_connections;
create trigger finance_connections_touch
  before update on public.finance_connections
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Mirrored / manual accounts (bank GL or chart-of-accounts lines)
-- ----------------------------------------------------------------------------

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,
  connection_id uuid references public.finance_connections(id) on delete set null,

  name text not null check (length(btrim(name)) between 1 and 160),
  account_type text not null check (account_type in (
    'checking', 'savings', 'credit_card', 'other_bank',
    'accounts_receivable', 'accounts_payable',
    'income', 'expense', 'equity', 'other'
  )),
  currency text not null default 'USD' check (length(currency) = 3),

  -- Last observed balance from a sync (cents). Null until first pull.
  balance_cents bigint,
  balance_as_of timestamptz,

  external_id text,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_external_unique
  on public.finance_accounts (org_id, connection_id, external_id)
  where external_id is not null;

comment on table public.finance_accounts is
  'Bank and ledger accounts visible to the Financial Agent. Balances are observed, not authored.';

create index if not exists finance_accounts_org_idx
  on public.finance_accounts (org_id, is_active);

drop trigger if exists finance_accounts_touch on public.finance_accounts;
create trigger finance_accounts_touch
  before update on public.finance_accounts
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Cost codes + job cost lines
-- ----------------------------------------------------------------------------

create table if not exists public.finance_cost_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  code text not null check (length(btrim(code)) between 1 and 32),
  label text not null check (length(btrim(label)) between 1 and 120),
  category text not null default 'other'
    check (category in ('labor', 'materials', 'equipment', 'subcontract', 'other')),
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint finance_cost_codes_unique unique (org_id, code)
);

comment on table public.finance_cost_codes is
  'Chart of job-cost categories the accountant posts against.';

drop trigger if exists finance_cost_codes_touch on public.finance_cost_codes;
create trigger finance_cost_codes_touch
  before update on public.finance_cost_codes
  for each row execute function private.touch_updated_at();

create table if not exists public.finance_job_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  -- Prefer CRM job; PM project is allowed when the job has not been mirrored.
  job_id uuid,
  pm_project_id uuid,
  cost_code_id uuid references public.finance_cost_codes(id) on delete set null,

  category text not null
    check (category in ('labor', 'materials', 'equipment', 'subcontract', 'other')),
  description text check (description is null or length(description) <= 2000),

  quantity numeric(14, 4) not null default 1,
  unit text not null default 'EA' check (length(btrim(unit)) between 1 and 16),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),

  incurred_on date not null default (timezone('utc', now()))::date,

  -- Where the line came from.
  origin text not null default 'manual'
    check (origin in ('manual', 'work_log', 'equipment', 'import', 'agent')),
  source_table text,
  source_id uuid,
  agent_run_id uuid,

  -- voided rather than deleted.
  status text not null default 'posted'
    check (status in ('draft', 'posted', 'voided')),

  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint finance_job_costs_has_target check (
    job_id is not null or pm_project_id is not null
  )
);

comment on table public.finance_job_costs is
  'Job cost lines. Draft until an accountant posts; voided, never deleted.';

create index if not exists finance_job_costs_job_idx
  on public.finance_job_costs (org_id, job_id, status)
  where job_id is not null;

create index if not exists finance_job_costs_project_idx
  on public.finance_job_costs (org_id, pm_project_id, status)
  where pm_project_id is not null;

drop trigger if exists finance_job_costs_touch on public.finance_job_costs;
create trigger finance_job_costs_touch
  before update on public.finance_job_costs
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Alerts
-- ----------------------------------------------------------------------------

create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  rule_key text not null check (length(btrim(rule_key)) between 1 and 64),
  fingerprint text not null check (length(btrim(fingerprint)) between 1 and 200),

  severity text not null check (severity in ('info', 'warn', 'critical')),
  category text not null check (category in (
    'cash', 'ar', 'job_cost', 'connection', 'books', 'general'
  )),

  title text not null check (length(btrim(title)) between 1 and 240),
  detail text check (detail is null or length(detail) <= 4000),
  suggested_action text check (suggested_action is null or length(suggested_action) <= 1000),

  job_id uuid,
  pm_project_id uuid,
  connection_id uuid references public.finance_connections(id) on delete set null,
  entity_type text,
  entity_id uuid,

  facts jsonb not null default '{}'::jsonb,

  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'snoozed', 'resolved', 'dismissed')),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint finance_alerts_fingerprint_unique unique (org_id, fingerprint)
);

comment on table public.finance_alerts is
  'Deduped findings from the Financial Agent rule pass. Fingerprint is stable per problem.';

create index if not exists finance_alerts_open_idx
  on public.finance_alerts (org_id, status, severity, last_seen_at desc);

drop trigger if exists finance_alerts_touch on public.finance_alerts;
create trigger finance_alerts_touch
  before update on public.finance_alerts
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. CFO briefs
-- ----------------------------------------------------------------------------

create table if not exists public.finance_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  for_date date not null,
  kind text not null default 'morning'
    check (kind in ('morning', 'weekly', 'ad_hoc')),

  headline text check (headline is null or length(headline) <= 240),
  body text not null check (length(body) between 1 and 20000),

  model_id text,
  agent_run_id uuid,
  facts jsonb not null default '{}'::jsonb,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint finance_briefs_day_unique unique (org_id, for_date, kind)
);

comment on table public.finance_briefs is
  'CFO morning brief. Facts are stored beside the prose so a surprising sentence can be checked.';

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------

alter table public.finance_automation_settings enable row level security;
alter table public.finance_connections enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_cost_codes enable row level security;
alter table public.finance_job_costs enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.finance_briefs enable row level security;

-- Settings
drop policy if exists finance_settings_select on public.finance_automation_settings;
create policy finance_settings_select on public.finance_automation_settings
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_settings_insert on public.finance_automation_settings;
create policy finance_settings_insert on public.finance_automation_settings
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_settings_update on public.finance_automation_settings;
create policy finance_settings_update on public.finance_automation_settings
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Connections
drop policy if exists finance_connections_select on public.finance_connections;
create policy finance_connections_select on public.finance_connections
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_connections_insert on public.finance_connections;
create policy finance_connections_insert on public.finance_connections
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_connections_update on public.finance_connections;
create policy finance_connections_update on public.finance_connections
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Accounts
drop policy if exists finance_accounts_select on public.finance_accounts;
create policy finance_accounts_select on public.finance_accounts
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_accounts_insert on public.finance_accounts;
create policy finance_accounts_insert on public.finance_accounts
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_accounts_update on public.finance_accounts;
create policy finance_accounts_update on public.finance_accounts
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Cost codes
drop policy if exists finance_cost_codes_select on public.finance_cost_codes;
create policy finance_cost_codes_select on public.finance_cost_codes
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_cost_codes_insert on public.finance_cost_codes;
create policy finance_cost_codes_insert on public.finance_cost_codes
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_cost_codes_update on public.finance_cost_codes;
create policy finance_cost_codes_update on public.finance_cost_codes
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Job costs
drop policy if exists finance_job_costs_select on public.finance_job_costs;
create policy finance_job_costs_select on public.finance_job_costs
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_job_costs_insert on public.finance_job_costs;
create policy finance_job_costs_insert on public.finance_job_costs
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and (
      private.can_manage_finance(org_id)
      or origin in ('work_log', 'equipment', 'agent')
    )
  );

drop policy if exists finance_job_costs_update on public.finance_job_costs;
create policy finance_job_costs_update on public.finance_job_costs
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Alerts
drop policy if exists finance_alerts_select on public.finance_alerts;
create policy finance_alerts_select on public.finance_alerts
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_alerts_insert on public.finance_alerts;
create policy finance_alerts_insert on public.finance_alerts
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists finance_alerts_update on public.finance_alerts;
create policy finance_alerts_update on public.finance_alerts
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Briefs
drop policy if exists finance_briefs_select on public.finance_briefs;
create policy finance_briefs_select on public.finance_briefs
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_briefs_insert on public.finance_briefs;
create policy finance_briefs_insert on public.finance_briefs
  for insert to authenticated
  with check (private.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 8. Grants
-- ----------------------------------------------------------------------------

grant select, insert, update on public.finance_automation_settings to authenticated;
grant select, insert, update on public.finance_connections to authenticated;
grant select, insert, update on public.finance_accounts to authenticated;
grant select, insert, update on public.finance_cost_codes to authenticated;
grant select, insert, update on public.finance_job_costs to authenticated;
grant select, insert, update on public.finance_alerts to authenticated;
grant select, insert on public.finance_briefs to authenticated;
