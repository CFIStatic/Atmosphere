-- ============================================================================
-- Atmosphere CRM — core schema
-- ============================================================================
-- The CRM is org-scoped infrastructure: every row belongs to exactly one org,
-- and Row Level Security — not application code — is what keeps one company's
-- customers invisible to another's. The backend always talks to Postgres with
-- the caller's JWT, so these policies are the real boundary.
--
-- Membership is checked through private.is_org_member(uuid), the SECURITY
-- DEFINER helper introduced with the onboarding schema. Keeping it in the
-- `private` schema (not exposed as an RPC) avoids recursive-policy evaluation
-- and keeps the API surface minimal.
--
-- Safe to re-run: every object is created guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- `work_type` (mitigation | construction) already exists from the onboarding
-- schema and is reused here so a job's work type matches the member's.

do $$ begin
  create type crm_account_type as enum (
    'insurance_carrier',
    'property_management',
    'general_contractor',
    'referral_partner',
    'vendor',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_contact_type as enum (
    'homeowner',
    'tenant',
    'adjuster',
    'agent',
    'property_manager',
    'vendor',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_lead_source as enum (
    'referral',
    'insurance_carrier',
    'web',
    'phone',
    'repeat_customer',
    'marketing',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_lead_status as enum (
    'new',
    'contacted',
    'qualified',
    'estimate_sent',
    'won',
    'lost'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_job_status as enum (
    'draft',
    'scheduled',
    'in_progress',
    'on_hold',
    'completed',
    'invoiced',
    'paid',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- The cause of loss. Mitigation work is categorised by peril; construction
-- rebuild jobs carry the peril of the loss that caused them.
do $$ begin
  create type crm_loss_type as enum (
    'water',
    'fire',
    'mold',
    'storm',
    'biohazard',
    'contents',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_activity_kind as enum (
    'note',
    'call',
    'email',
    'sms',
    'meeting',
    'site_visit',
    'task',
    'status_change',
    'system'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- org_id and created_by must never be client-supplied lies, and they must never
-- change after insert. RLS already stops a member writing into someone else's
-- org, but pinning the columns here means an UPDATE cannot move a row out of
-- the org that owns it — which is what would otherwise let a member launder a
-- record across the tenant boundary.
create or replace function private.freeze_ownership()
returns trigger
language plpgsql
as $$
begin
  new.org_id := old.org_id;
  new.created_by := old.created_by;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-org counters (human-facing job numbers)
-- ---------------------------------------------------------------------------
-- Job numbers are what the office and the field actually say out loud, so they
-- have to be short, sequential, and per-org. A dedicated counter row gives
-- gap-free numbering under concurrency; a bare max()+1 would not.

-- A surrogate id rather than a composite primary key, because the backup
-- exporter keyset-paginates every table on a single unique column.
create table if not exists public.crm_counters (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.orgs (id) on delete cascade,
  name    text not null,
  value   bigint not null default 0,
  constraint crm_counters_org_name_unique unique (org_id, name)
);

alter table public.crm_counters enable row level security;

create or replace function private.next_counter(p_org uuid, p_name text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.crm_counters (org_id, name, value)
  values (p_org, p_name, 1)
  on conflict on constraint crm_counters_org_name_unique
    do update set value = public.crm_counters.value + 1
  returning value into v_value;

  return v_value;
end;
$$;

revoke all on function private.next_counter(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accounts — the companies we do business with
-- ---------------------------------------------------------------------------

create table if not exists public.crm_accounts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 200),
  type         crm_account_type not null default 'other',
  phone        text,
  email        text,
  website      text,
  address_line1 text,
  address_line2 text,
  city         text,
  region       text,
  postal_code  text,
  country      text not null default 'US',
  notes        text,
  is_archived  boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts — the people
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  account_id   uuid references public.crm_accounts (id) on delete set null,
  type         crm_contact_type not null default 'homeowner',
  first_name   text,
  last_name    text,
  company_name text,
  title        text,
  email        text,
  phone        text,
  mobile       text,
  preferred_contact_method text,
  address_line1 text,
  address_line2 text,
  city         text,
  region       text,
  postal_code  text,
  country      text not null default 'US',
  notes        text,
  -- Set when someone asks not to be marketed to. Honouring this is a legal
  -- obligation, not a preference, so it lives on the record itself.
  marketing_opt_out boolean not null default false,
  is_archived  boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A contact with no name at all is a data-entry accident, not a record.
  constraint crm_contacts_has_a_name check (
    coalesce(btrim(first_name), '') <> ''
    or coalesce(btrim(last_name), '') <> ''
    or coalesce(btrim(company_name), '') <> ''
  )
);

-- ---------------------------------------------------------------------------
-- Properties — the physical places work happens
-- ---------------------------------------------------------------------------
-- Kept separate from contacts because in this trade the same loss location
-- recurs across owners, tenants, and carriers, and the access notes ("lockbox
-- code", "dog in the back yard") belong to the address, not to a person.

create table if not exists public.crm_properties (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  account_id   uuid references public.crm_accounts (id) on delete set null,
  primary_contact_id uuid references public.crm_contacts (id) on delete set null,
  label        text,
  address_line1 text not null check (length(btrim(address_line1)) between 1 and 200),
  address_line2 text,
  city         text,
  region       text,
  postal_code  text,
  country      text not null default 'US',
  latitude     numeric(9, 6),
  longitude    numeric(9, 6),
  property_type text,
  year_built   integer check (year_built is null or year_built between 1600 and 2200),
  square_feet  integer check (square_feet is null or square_feet >= 0),
  access_notes text,
  is_archived  boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leads — work we might win
-- ---------------------------------------------------------------------------

create table if not exists public.crm_leads (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  contact_id   uuid references public.crm_contacts (id) on delete set null,
  account_id   uuid references public.crm_accounts (id) on delete set null,
  property_id  uuid references public.crm_properties (id) on delete set null,
  owner_id     uuid references public.profiles (id) on delete set null,
  source       crm_lead_source not null default 'other',
  status       crm_lead_status not null default 'new',
  work_type    work_type,
  loss_type    crm_loss_type,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text,
  estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  loss_date    date,
  lost_reason  text,
  converted_job_id uuid,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs — work we won
-- ---------------------------------------------------------------------------

create table if not exists public.crm_jobs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  -- Filled by the crm_jobs_assign_number trigger below, so callers omit it.
  job_number   bigint,
  lead_id      uuid references public.crm_leads (id) on delete set null,
  contact_id   uuid references public.crm_contacts (id) on delete set null,
  account_id   uuid references public.crm_accounts (id) on delete set null,
  property_id  uuid references public.crm_properties (id) on delete set null,
  owner_id     uuid references public.profiles (id) on delete set null,
  work_type    work_type not null,
  loss_type    crm_loss_type,
  status       crm_job_status not null default 'draft',
  priority     smallint not null default 3 check (priority between 1 and 5),
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text,

  -- Insurance side. Most restoration work is paid by a carrier, so the claim
  -- identifiers sit on the job rather than in a bolt-on table.
  carrier_account_id uuid references public.crm_accounts (id) on delete set null,
  adjuster_contact_id uuid references public.crm_contacts (id) on delete set null,
  claim_number text,
  policy_number text,
  deductible   numeric(12, 2) check (deductible is null or deductible >= 0),

  loss_date        date,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  actual_start     timestamptz,
  actual_end       timestamptz,

  contract_amount  numeric(12, 2) check (contract_amount is null or contract_amount >= 0),
  invoiced_amount  numeric(12, 2) not null default 0 check (invoiced_amount >= 0),
  paid_amount      numeric(12, 2) not null default 0 check (paid_amount >= 0),

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint crm_jobs_number_unique_per_org unique (org_id, job_number),
  constraint crm_jobs_schedule_ordered check (
    scheduled_start is null or scheduled_end is null or scheduled_end >= scheduled_start
  ),
  constraint crm_jobs_actuals_ordered check (
    actual_start is null or actual_end is null or actual_end >= actual_start
  )
);

do $$ begin
  alter table public.crm_leads
    add constraint crm_leads_converted_job_fkey
    foreign key (converted_job_id) references public.crm_jobs (id) on delete set null;
exception when duplicate_object then null; end $$;

-- Assign the next per-org job number on insert. Doing it in a trigger rather
-- than in the API means a job written by any path — route, import, backfill —
-- still gets a valid number.
create or replace function private.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.job_number is null or new.job_number = 0 then
    new.job_number := private.next_counter(new.org_id, 'job_number');
  end if;
  return new;
end;
$$;

drop trigger if exists crm_jobs_assign_number on public.crm_jobs;
create trigger crm_jobs_assign_number
  before insert on public.crm_jobs
  for each row execute function private.assign_job_number();

-- ---------------------------------------------------------------------------
-- Activities — the timeline
-- ---------------------------------------------------------------------------
-- One table for notes, calls, site visits, and tasks. A single timeline is what
-- makes "what happened on this job?" answerable in one query, which is the
-- question the office actually asks.

create table if not exists public.crm_activities (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  kind         crm_activity_kind not null default 'note',
  subject      text,
  body         text,
  contact_id   uuid references public.crm_contacts (id) on delete cascade,
  account_id   uuid references public.crm_accounts (id) on delete cascade,
  property_id  uuid references public.crm_properties (id) on delete cascade,
  lead_id      uuid references public.crm_leads (id) on delete cascade,
  job_id       uuid references public.crm_jobs (id) on delete cascade,
  assigned_to  uuid references public.profiles (id) on delete set null,
  due_at       timestamptz,
  completed_at timestamptz,
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- An activity floating free of every record is noise nobody will ever find.
  constraint crm_activities_has_a_subject check (
    contact_id is not null
    or account_id is not null
    or property_id is not null
    or lead_id is not null
    or job_id is not null
  )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Every query the API issues is filtered by org_id first (RLS guarantees it),
-- so each index leads with org_id.

create index if not exists crm_accounts_org_idx        on public.crm_accounts (org_id, is_archived, name);
create index if not exists crm_contacts_org_idx        on public.crm_contacts (org_id, is_archived, last_name, first_name);
create index if not exists crm_contacts_account_idx    on public.crm_contacts (account_id) where account_id is not null;
create index if not exists crm_contacts_email_idx      on public.crm_contacts (org_id, lower(email)) where email is not null;
create index if not exists crm_properties_org_idx      on public.crm_properties (org_id, is_archived, postal_code);
create index if not exists crm_leads_org_status_idx    on public.crm_leads (org_id, status, created_at desc);
create index if not exists crm_leads_owner_idx         on public.crm_leads (org_id, owner_id) where owner_id is not null;
create index if not exists crm_jobs_org_status_idx     on public.crm_jobs (org_id, status, created_at desc);
create index if not exists crm_jobs_owner_idx          on public.crm_jobs (org_id, owner_id) where owner_id is not null;
create index if not exists crm_jobs_property_idx       on public.crm_jobs (property_id) where property_id is not null;
create index if not exists crm_jobs_claim_idx          on public.crm_jobs (org_id, claim_number) where claim_number is not null;
create index if not exists crm_activities_job_idx      on public.crm_activities (job_id, occurred_at desc) where job_id is not null;
create index if not exists crm_activities_lead_idx     on public.crm_activities (lead_id, occurred_at desc) where lead_id is not null;
create index if not exists crm_activities_contact_idx  on public.crm_activities (contact_id, occurred_at desc) where contact_id is not null;
create index if not exists crm_activities_open_task_idx on public.crm_activities (org_id, assigned_to, due_at)
  where kind = 'task' and completed_at is null;

-- ---------------------------------------------------------------------------
-- Triggers: updated_at + immutable ownership
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_accounts', 'crm_contacts', 'crm_properties',
    'crm_leads', 'crm_jobs', 'crm_activities'
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
-- One policy shape for every CRM table: you may touch a row if, and only if,
-- you are a member of the org that owns it. The WITH CHECK clause is what stops
-- a member inserting a row addressed to another org.

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_accounts', 'crm_contacts', 'crm_properties',
    'crm_leads', 'crm_jobs', 'crm_activities'
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

-- Counters are an implementation detail of job numbering. Members may read
-- their org's counters; only the SECURITY DEFINER helper may move them.
drop policy if exists crm_counters_select on public.crm_counters;
create policy crm_counters_select on public.crm_counters
  for select to authenticated
  using (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- `anon` gets nothing: the CRM is never reachable without a session. RLS is the
-- real boundary, but withholding the grant means an unauthenticated request
-- cannot even reach a policy evaluation.

grant select, insert, update, delete on
  public.crm_accounts, public.crm_contacts, public.crm_properties,
  public.crm_leads, public.crm_jobs, public.crm_activities
  to authenticated;

grant select on public.crm_counters to authenticated;

revoke all on
  public.crm_accounts, public.crm_contacts, public.crm_properties,
  public.crm_leads, public.crm_jobs, public.crm_activities, public.crm_counters
  from anon;
