-- ============================================================================
-- Project Manager — partner network + adaptive internal comms
-- ============================================================================
-- Two problems, one migration:
--
--   1. Network effects. Vendors and subcontractors only create leverage when
--      they are *on Atmosphere*, not just in a CRM address book. Invites,
--      partnerships, and a directory that grows with every accepted invite
--      are the flywheel. Aggregate signals (jobs shared, response hours) are
--      the only thing that crosses org boundaries — never message content.
--
--   2. Adaptive internal communication. External threads (@atmosphere in
--      WhatsApp, etc.) are documented in pm_communications. This is the
--      *inside* channel: project threads, vendor coordination, and approval
--      follow-ups that Atmosphere opens when the situation needs a conversation
--      and keeps quiet when it does not.
--
-- Conventions match the PM agent: org-scoped RLS, no DELETE, text+CHECK,
-- child org_id overwritten from the parent where one exists.
-- ============================================================================

create schema if not exists private;

-- Widen communication channels with Atmosphere-native internal.
alter table public.pm_communications drop constraint if exists pm_communications_channel_check;
alter table public.pm_communications
  add constraint pm_communications_channel_check
  check (channel in (
    'imessage', 'whatsapp', 'signal', 'sms', 'email', 'outlook',
    'internal', 'other'
  ));

-- Widen counterparty kinds for subcontractors.
alter table public.pm_communications drop constraint if exists pm_communications_counterparty_kind_check;
alter table public.pm_communications
  add constraint pm_communications_counterparty_kind_check
  check (counterparty_kind in (
    'vendor', 'subcontractor', 'customer', 'adjuster', 'crew',
    'carrier', 'supplier', 'unknown'
  ));

-- ----------------------------------------------------------------------------
-- 1. Partner profiles — how an org presents itself on the network
-- ----------------------------------------------------------------------------

create table if not exists public.pm_partner_profiles (
  org_id          uuid primary key references public.orgs(id),
  display_name    text not null check (length(btrim(display_name)) between 2 and 160),
  kind            text not null default 'restoration'
                    check (kind in (
                      'restoration', 'general_contractor', 'subcontractor',
                      'vendor', 'supplier', 'specialty'
                    )),
  blurb           text check (blurb is null or length(blurb) <= 1000),
  trades          text[] not null default '{}'::text[],
  service_areas   text[] not null default '{}'::text[], -- ZIPs / regions
  phone           text check (phone is null or length(phone) <= 40),
  email           text check (email is null or length(email) <= 200),
  website         text check (website is null or length(website) <= 400),
  -- Aggregate-only flywheel fields. Never store customer content here.
  jobs_completed  integer not null default 0 check (jobs_completed >= 0),
  invites_sent    integer not null default 0 check (invites_sent >= 0),
  invites_accepted integer not null default 0 check (invites_accepted >= 0),
  avg_response_hours numeric(8,2) check (avg_response_hours is null or avg_response_hours >= 0),
  discoverable    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.pm_partner_profiles is
  'How an Atmosphere org presents itself to vendors/subs — and how they present '
  'themselves back. Aggregate counters only; no job content leaves the org.';

drop trigger if exists pm_partner_profiles_touch on public.pm_partner_profiles;
create trigger pm_partner_profiles_touch
  before update on public.pm_partner_profiles
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Partner invites — the viral edge
-- ----------------------------------------------------------------------------

create table if not exists public.pm_partner_invites (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  -- Who we want on the platform.
  invitee_kind    text not null
                    check (invitee_kind in (
                      'subcontractor', 'vendor', 'supplier', 'specialty', 'general_contractor'
                    )),
  invitee_name    text not null check (length(btrim(invitee_name)) between 1 and 160),
  invitee_email   text check (invitee_email is null or length(invitee_email) <= 200),
  invitee_phone   text check (invitee_phone is null or length(invitee_phone) <= 40),
  invitee_company text check (invitee_company is null or length(invitee_company) <= 160),
  trades          text[] not null default '{}'::text[],
  message         text check (message is null or length(message) <= 2000),
  -- Opaque token the invitee redeems when they create/join an Atmosphere org.
  token           text not null unique check (length(btrim(token)) between 16 and 80),
  status          text not null default 'pending'
                    check (status in (
                      'pending', 'sent', 'accepted', 'declined', 'expired', 'revoked'
                    )),
  -- Optional CRM account this invite grew out of.
  crm_account_id  uuid,
  project_id      uuid references public.pm_projects(id),
  invited_by      uuid references auth.users(id),
  accepted_org_id uuid references public.orgs(id),
  accepted_at     timestamptz,
  expires_at      timestamptz not null default (now() + interval '30 days'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pm_partner_invites_contact check (
    invitee_email is not null or invitee_phone is not null
  )
);

create index if not exists pm_partner_invites_org_idx
  on public.pm_partner_invites (org_id, status, created_at desc);
create index if not exists pm_partner_invites_token_idx
  on public.pm_partner_invites (token) where status in ('pending', 'sent');

drop trigger if exists pm_partner_invites_touch on public.pm_partner_invites;
create trigger pm_partner_invites_touch
  before update on public.pm_partner_invites
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_partner_invites_fill_org on public.pm_partner_invites;
create trigger pm_partner_invites_fill_org
  before insert on public.pm_partner_invites
  for each row execute function private.pm_fill_org_from_project();

-- ----------------------------------------------------------------------------
-- 3. Partnerships — the edge between two Atmosphere orgs
-- ----------------------------------------------------------------------------

create table if not exists public.pm_partnerships (
  id              uuid primary key default gen_random_uuid(),
  -- The org that invited / owns the relationship in *this* row's tenancy view.
  -- Each side may hold a mirror row under its own org_id so RLS stays simple:
  -- members only ever see partnerships where org_id is their org.
  org_id          uuid not null references public.orgs(id),
  partner_org_id  uuid not null references public.orgs(id),
  partner_kind    text not null
                    check (partner_kind in (
                      'subcontractor', 'vendor', 'supplier', 'specialty',
                      'general_contractor', 'restoration'
                    )),
  status          text not null default 'active'
                    check (status in ('pending', 'active', 'paused', 'ended')),
  invite_id       uuid references public.pm_partner_invites(id),
  preferred       boolean not null default false,
  notes           text check (notes is null or length(notes) <= 2000),
  -- Aggregate-only: how often we have worked together on Atmosphere.
  shared_jobs     integer not null default 0 check (shared_jobs >= 0),
  last_collaborated_at timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pm_partnerships_not_self check (org_id <> partner_org_id),
  constraint pm_partnerships_unique unique (org_id, partner_org_id)
);

create index if not exists pm_partnerships_partner_idx
  on public.pm_partnerships (partner_org_id, status);

drop trigger if exists pm_partnerships_touch on public.pm_partnerships;
create trigger pm_partnerships_touch
  before update on public.pm_partnerships
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Adaptive internal threads
-- ----------------------------------------------------------------------------
-- Atmosphere opens a thread when the situation needs a conversation (critical
-- alert cluster, pending approval with nuance, vendor coordination) and leaves
-- it quiet otherwise. `mode` adapts: live for urgent, digest for routine.

create table if not exists public.pm_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid references public.pm_projects(id),
  partnership_id  uuid references public.pm_partnerships(id),

  kind            text not null
                    check (kind in (
                      'project_ops',        -- crew + PM on one job
                      'vendor_coordination',-- with a partner org / vendor
                      'approval_followup',  -- nuance around a pending approval
                      'procurement',        -- dumpster / material decisions
                      'network',            -- invite / partnership onboarding
                      'general'
                    )),
  -- How chatty the thread should be right now. The engine can promote
  -- digest → live when severity rises, and demote when things calm down.
  mode            text not null default 'live'
                    check (mode in ('live', 'digest', 'muted')),
  title           text not null check (length(btrim(title)) between 1 and 200),
  status          text not null default 'open'
                    check (status in ('open', 'resolved', 'archived')),
  -- Why Atmosphere opened this (rule key, approval id, invite id, …).
  origin_key      text check (origin_key is null or length(origin_key) <= 200),
  origin_ref      text check (origin_ref is null or length(origin_ref) <= 200),
  urgency         text not null default 'normal'
                    check (urgency in ('low', 'normal', 'high', 'urgent')),
  last_message_at timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists pm_threads_origin_unique
  on public.pm_threads (org_id, origin_key) where origin_key is not null;
create index if not exists pm_threads_open_idx
  on public.pm_threads (org_id, status, last_message_at desc nulls last)
  where status = 'open';
create index if not exists pm_threads_project_idx
  on public.pm_threads (project_id, status);

drop trigger if exists pm_threads_touch on public.pm_threads;
create trigger pm_threads_touch
  before update on public.pm_threads
  for each row execute function private.touch_updated_at();

drop trigger if exists pm_threads_fill_org on public.pm_threads;
create trigger pm_threads_fill_org
  before insert on public.pm_threads
  for each row execute function private.pm_fill_org_from_project();

create table if not exists public.pm_thread_participants (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  thread_id       uuid not null references public.pm_threads(id),
  -- Either an Atmosphere user in this org, or a partner org as a whole.
  user_id         uuid references auth.users(id),
  partner_org_id  uuid references public.orgs(id),
  role_in_thread  text not null default 'member'
                    check (role_in_thread in ('owner', 'member', 'watcher', 'bot')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  muted           boolean not null default false,
  constraint pm_thread_participants_who check (
    user_id is not null or partner_org_id is not null
  )
);

create unique index if not exists pm_thread_participants_user_unique
  on public.pm_thread_participants (thread_id, user_id) where user_id is not null;
create unique index if not exists pm_thread_participants_partner_unique
  on public.pm_thread_participants (thread_id, partner_org_id) where partner_org_id is not null;

create table if not exists public.pm_thread_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  thread_id       uuid not null references public.pm_threads(id),
  author_user_id  uuid references auth.users(id),
  -- Atmosphere itself can post adaptive system notes (mode changes, digests).
  author_kind     text not null default 'user'
                    check (author_kind in ('user', 'atmosphere', 'partner')),
  body            text not null check (length(btrim(body)) between 1 and 16000),
  -- Optional structured payload (approval card, bid summary, invite status).
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists pm_thread_messages_thread_idx
  on public.pm_thread_messages (thread_id, created_at);

-- Keep last_message_at honest without trusting the client.
create or replace function private.pm_bump_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.pm_threads
     set last_message_at = new.created_at,
         updated_at = pg_catalog.now()
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists pm_thread_messages_bump on public.pm_thread_messages;
create trigger pm_thread_messages_bump
  after insert on public.pm_thread_messages
  for each row execute function private.pm_bump_thread_on_message();

-- Derive org_id on messages / participants from the thread.
create or replace function private.pm_fill_org_from_thread()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org uuid;
begin
  select t.org_id into v_org from public.pm_threads t where t.id = new.thread_id;
  if v_org is null then
    raise exception 'thread % does not exist', new.thread_id using errcode = '23503';
  end if;
  new.org_id := v_org;
  return new;
end;
$$;

drop trigger if exists pm_thread_participants_fill_org on public.pm_thread_participants;
create trigger pm_thread_participants_fill_org
  before insert on public.pm_thread_participants
  for each row execute function private.pm_fill_org_from_thread();

drop trigger if exists pm_thread_messages_fill_org on public.pm_thread_messages;
create trigger pm_thread_messages_fill_org
  before insert on public.pm_thread_messages
  for each row execute function private.pm_fill_org_from_thread();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------

alter table public.pm_partner_profiles     enable row level security;
alter table public.pm_partner_invites      enable row level security;
alter table public.pm_partnerships         enable row level security;
alter table public.pm_threads              enable row level security;
alter table public.pm_thread_participants  enable row level security;
alter table public.pm_thread_messages      enable row level security;

-- Profiles: members can read/update their own; discoverable profiles of *partner*
-- orgs are readable via a partnership. Global discovery of strangers is a later
-- product surface — for now you see partners you already invited/accepted.
drop policy if exists pm_partner_profiles_select on public.pm_partner_profiles;
create policy pm_partner_profiles_select on public.pm_partner_profiles
  for select to authenticated
  using (
    private.is_org_member(org_id)
    or (
      discoverable
      and exists (
        select 1 from public.pm_partnerships p
        where p.status = 'active'
          and (
            (p.org_id = private.pm_current_org() and p.partner_org_id = pm_partner_profiles.org_id)
            or (p.partner_org_id = private.pm_current_org() and p.org_id = pm_partner_profiles.org_id)
          )
      )
    )
  );

drop policy if exists pm_partner_profiles_insert on public.pm_partner_profiles;
create policy pm_partner_profiles_insert on public.pm_partner_profiles
  for insert to authenticated with check (private.pm_can_manage(org_id));

drop policy if exists pm_partner_profiles_update on public.pm_partner_profiles;
create policy pm_partner_profiles_update on public.pm_partner_profiles
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_partner_invites_select on public.pm_partner_invites;
create policy pm_partner_invites_select on public.pm_partner_invites
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_partner_invites_insert on public.pm_partner_invites;
create policy pm_partner_invites_insert on public.pm_partner_invites
  for insert to authenticated
  with check (
    private.pm_can_manage(org_id)
    and (project_id is null or private.pm_project_in_org(project_id, org_id))
  );

drop policy if exists pm_partner_invites_update on public.pm_partner_invites;
create policy pm_partner_invites_update on public.pm_partner_invites
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_partnerships_select on public.pm_partnerships;
create policy pm_partnerships_select on public.pm_partnerships
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_partnerships_insert on public.pm_partnerships;
create policy pm_partnerships_insert on public.pm_partnerships
  for insert to authenticated with check (private.pm_can_manage(org_id));

drop policy if exists pm_partnerships_update on public.pm_partnerships;
create policy pm_partnerships_update on public.pm_partnerships
  for update to authenticated
  using (private.pm_can_manage(org_id)) with check (private.pm_can_manage(org_id));

drop policy if exists pm_threads_select on public.pm_threads;
create policy pm_threads_select on public.pm_threads
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_threads_insert on public.pm_threads;
create policy pm_threads_insert on public.pm_threads
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and (project_id is null or private.pm_project_in_org(project_id, org_id))
  );

drop policy if exists pm_threads_update on public.pm_threads;
create policy pm_threads_update on public.pm_threads
  for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists pm_thread_participants_select on public.pm_thread_participants;
create policy pm_thread_participants_select on public.pm_thread_participants
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_thread_participants_insert on public.pm_thread_participants;
create policy pm_thread_participants_insert on public.pm_thread_participants
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists pm_thread_participants_update on public.pm_thread_participants;
create policy pm_thread_participants_update on public.pm_thread_participants
  for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists pm_thread_messages_select on public.pm_thread_messages;
create policy pm_thread_messages_select on public.pm_thread_messages
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_thread_messages_insert on public.pm_thread_messages;
create policy pm_thread_messages_insert on public.pm_thread_messages
  for insert to authenticated with check (private.is_org_member(org_id));
-- No update on messages — edits are new messages; a log you can rewrite is not a log.

grant select, insert, update on
  public.pm_partner_profiles,
  public.pm_partner_invites,
  public.pm_partnerships,
  public.pm_threads,
  public.pm_thread_participants
to authenticated;

grant select, insert on public.pm_thread_messages to authenticated;

revoke all on
  public.pm_partner_profiles,
  public.pm_partner_invites,
  public.pm_partnerships,
  public.pm_threads,
  public.pm_thread_participants,
  public.pm_thread_messages
from anon;
