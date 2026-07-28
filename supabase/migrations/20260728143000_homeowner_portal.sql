-- ============================================================================
-- HomeOwner Report Portal
-- ============================================================================
-- A customer-facing surface keyed to a Project Manager project. Restoration
-- companies mint a share link, choose what the homeowner can see, and the
-- homeowner opens `/report/:token` to follow schedule/progress, message the
-- company, see who to call, and ask insurance questions (optionally with an
-- uploaded policy).
--
-- Guest access never uses a staff JWT. The BFF validates a share token hash
-- and projects a safe DTO from pm_* rows under the visibility flags below.
-- Staff manage shares and visibility through normal org-member RLS.
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1. Share links
-- ----------------------------------------------------------------------------

create table if not exists public.homeowner_portal_shares (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),

  -- SHA-256 hex of the raw token handed to the customer. The raw value is
  -- shown once at mint time and never stored.
  token_hash      text not null unique
                    check (token_hash ~ '^[0-9a-f]{64}$'),

  label           text check (label is null or length(btrim(label)) between 1 and 120),
  customer_name   text check (customer_name is null or length(customer_name) <= 160),
  customer_email  text check (customer_email is null or length(customer_email) <= 320),

  status          text not null default 'active'
                    check (status in ('active', 'revoked', 'expired')),
  expires_at      timestamptz,
  last_accessed_at timestamptz,

  welcome_note    text check (welcome_note is null or length(welcome_note) <= 2000),

  created_by      uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id)
);

create index if not exists homeowner_portal_shares_project_idx
  on public.homeowner_portal_shares (project_id, created_at desc);
create index if not exists homeowner_portal_shares_org_idx
  on public.homeowner_portal_shares (org_id, status, created_at desc);
create index if not exists homeowner_portal_shares_token_idx
  on public.homeowner_portal_shares (token_hash)
  where status = 'active';

comment on table public.homeowner_portal_shares is
  'Tokenized homeowner access to one PM project. Raw tokens are never stored.';

drop trigger if exists homeowner_portal_shares_touch on public.homeowner_portal_shares;
create trigger homeowner_portal_shares_touch
  before update on public.homeowner_portal_shares
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Visibility / disclosure controls
-- ----------------------------------------------------------------------------
-- One row per project. The restoration company decides what leaves the shop.
-- Defaults favour useful customer updates without exposing crew notes, alerts,
-- or full financials.

create table if not exists public.homeowner_portal_visibility (
  project_id              uuid primary key references public.pm_projects(id) on delete cascade,
  org_id                  uuid not null references public.orgs(id),

  show_schedule           boolean not null default true,
  show_phase_progress     boolean not null default true,
  show_milestones         boolean not null default true,
  show_customer_updates   boolean not null default true,
  show_drying_summary     boolean not null default true,
  show_documents          boolean not null default false,
  show_claim_basics       boolean not null default true,
  show_deductible         boolean not null default false,
  show_office_contact     boolean not null default true,
  show_adjuster_contact   boolean not null default true,
  show_field_contact      boolean not null default false,
  allow_chat              boolean not null default true,
  allow_adjuster_chat     boolean not null default true,
  allow_group_chat        boolean not null default true,
  allow_policy_upload     boolean not null default true,
  allow_insurance_qa      boolean not null default true,

  -- Company brand on the guest chat portal (e.g. ServiceMaster Recovery Services).
  brand_name              text check (brand_name is null or length(btrim(brand_name)) between 1 and 160),
  logo_url                text check (logo_url is null or (
                            length(logo_url) between 8 and 2000
                            and logo_url ~* '^https?://'
                          )),

  -- Optional overrides shown under "Who to call".
  office_name             text check (office_name is null or length(office_name) <= 160),
  office_phone            text check (office_phone is null or length(office_phone) <= 40),
  office_email            text check (office_email is null or length(office_email) <= 320),
  field_contact_name      text check (field_contact_name is null or length(field_contact_name) <= 160),
  field_contact_phone     text check (field_contact_phone is null or length(field_contact_phone) <= 40),
  custom_message          text check (custom_message is null or length(custom_message) <= 2000),

  updated_by              uuid references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists homeowner_portal_visibility_org_idx
  on public.homeowner_portal_visibility (org_id);

comment on table public.homeowner_portal_visibility is
  'Per-project disclosure flags for the homeowner report portal.';

drop trigger if exists homeowner_portal_visibility_touch on public.homeowner_portal_visibility;
create trigger homeowner_portal_visibility_touch
  before update on public.homeowner_portal_visibility
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Conversations + messages (communications platform)
-- ----------------------------------------------------------------------------
-- Side conversations for the homeowner portal:
--   assistant — job / insurance Q&A bot
--   company   — homeowner ↔ restoration company DM
--   adjuster  — homeowner ↔ insurance adjuster DM
--   group     — homeowner + company + adjuster on the same thread

create table if not exists public.homeowner_portal_conversations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  share_id        uuid not null references public.homeowner_portal_shares(id) on delete cascade,

  kind            text not null check (kind in ('assistant', 'company', 'adjuster', 'group')),
  title           text not null check (length(btrim(title)) between 1 and 160),

  -- Who is on this thread (drives UI labels and who may post).
  includes_homeowner  boolean not null default true,
  includes_company    boolean not null default false,
  includes_adjuster   boolean not null default false,
  includes_assistant  boolean not null default false,

  status          text not null default 'open'
                    check (status in ('open', 'archived')),
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One thread of each kind per share (group can be expanded later).
  unique (share_id, kind)
);

create index if not exists homeowner_portal_conversations_share_idx
  on public.homeowner_portal_conversations (share_id, last_message_at desc nulls last);
create index if not exists homeowner_portal_conversations_project_idx
  on public.homeowner_portal_conversations (project_id, last_message_at desc nulls last);

comment on table public.homeowner_portal_conversations is
  'Side conversations on a homeowner portal share: company DM, adjuster DM, group, or assistant.';

drop trigger if exists homeowner_portal_conversations_touch on public.homeowner_portal_conversations;
create trigger homeowner_portal_conversations_touch
  before update on public.homeowner_portal_conversations
  for each row execute function private.touch_updated_at();

create table if not exists public.homeowner_portal_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  share_id        uuid not null references public.homeowner_portal_shares(id),
  conversation_id uuid not null references public.homeowner_portal_conversations(id) on delete cascade,

  author_kind     text not null
                    check (author_kind in ('homeowner', 'staff', 'adjuster', 'assistant', 'system')),
  author_user_id  uuid references auth.users(id),
  author_name     text check (author_name is null or length(author_name) <= 160),

  body            text not null check (length(btrim(body)) between 1 and 4000),
  topic           text check (topic is null or topic in (
                    'general', 'schedule', 'progress', 'insurance', 'policy', 'contact'
                  )),

  created_at      timestamptz not null default now()
);

create index if not exists homeowner_portal_messages_conversation_idx
  on public.homeowner_portal_messages (conversation_id, created_at);
create index if not exists homeowner_portal_messages_share_idx
  on public.homeowner_portal_messages (share_id, created_at);
create index if not exists homeowner_portal_messages_project_idx
  on public.homeowner_portal_messages (project_id, created_at desc);

comment on table public.homeowner_portal_messages is
  'Messages inside a portal conversation — homeowner, company staff, adjuster, or assistant.';

-- Keep last_message_at fresh so the sidebar can sort by activity.
create or replace function private.homeowner_portal_bump_conversation()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  update public.homeowner_portal_conversations
     set last_message_at = new.created_at,
         updated_at = pg_catalog.now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists homeowner_portal_messages_bump on public.homeowner_portal_messages;
create trigger homeowner_portal_messages_bump
  after insert on public.homeowner_portal_messages
  for each row execute function private.homeowner_portal_bump_conversation();

-- ----------------------------------------------------------------------------
-- 4. Uploaded policies (text extracted / pasted)
-- ----------------------------------------------------------------------------
-- Blob storage is a separate design. For the first cut we keep extracted text
-- (and a small optional base64 preview) so the insurance Q&A assistant can
-- ground answers without a storage bucket.

create table if not exists public.homeowner_portal_policies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),
  share_id        uuid not null references public.homeowner_portal_shares(id),

  file_name       text not null check (length(btrim(file_name)) between 1 and 260),
  mime_type       text not null default 'text/plain'
                    check (length(mime_type) between 3 and 120),
  byte_size       integer check (byte_size is null or (byte_size >= 0 and byte_size <= 2_000_000)),
  content_text    text not null check (length(content_text) between 1 and 200_000),
  summary         text check (summary is null or length(summary) <= 4000),

  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists homeowner_portal_policies_share_idx
  on public.homeowner_portal_policies (share_id, uploaded_at desc);
create index if not exists homeowner_portal_policies_project_idx
  on public.homeowner_portal_policies (project_id, uploaded_at desc);

comment on table public.homeowner_portal_policies is
  'Homeowner-uploaded policy text for portal Q&A. Not a general document store.';

-- ----------------------------------------------------------------------------
-- 5. RLS — org members only for staff paths; guests go through the BFF
-- ----------------------------------------------------------------------------

alter table public.homeowner_portal_shares      enable row level security;
alter table public.homeowner_portal_visibility  enable row level security;
alter table public.homeowner_portal_conversations enable row level security;
alter table public.homeowner_portal_messages    enable row level security;
alter table public.homeowner_portal_policies    enable row level security;

-- Shares
drop policy if exists homeowner_portal_shares_select on public.homeowner_portal_shares;
create policy homeowner_portal_shares_select on public.homeowner_portal_shares
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists homeowner_portal_shares_insert on public.homeowner_portal_shares;
create policy homeowner_portal_shares_insert on public.homeowner_portal_shares
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.is_org_member(org_id));

drop policy if exists homeowner_portal_shares_update on public.homeowner_portal_shares;
create policy homeowner_portal_shares_update on public.homeowner_portal_shares
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Visibility
drop policy if exists homeowner_portal_visibility_select on public.homeowner_portal_visibility;
create policy homeowner_portal_visibility_select on public.homeowner_portal_visibility
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists homeowner_portal_visibility_insert on public.homeowner_portal_visibility;
create policy homeowner_portal_visibility_insert on public.homeowner_portal_visibility
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.is_org_member(org_id));

drop policy if exists homeowner_portal_visibility_update on public.homeowner_portal_visibility;
create policy homeowner_portal_visibility_update on public.homeowner_portal_visibility
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Conversations
drop policy if exists homeowner_portal_conversations_select on public.homeowner_portal_conversations;
create policy homeowner_portal_conversations_select on public.homeowner_portal_conversations
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists homeowner_portal_conversations_insert on public.homeowner_portal_conversations;
create policy homeowner_portal_conversations_insert on public.homeowner_portal_conversations
  for insert to authenticated
  with check (private.pm_can_manage(org_id) and private.is_org_member(org_id));

drop policy if exists homeowner_portal_conversations_update on public.homeowner_portal_conversations;
create policy homeowner_portal_conversations_update on public.homeowner_portal_conversations
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Messages: any org member can read/reply; homeowners insert via service role BFF
drop policy if exists homeowner_portal_messages_select on public.homeowner_portal_messages;
create policy homeowner_portal_messages_select on public.homeowner_portal_messages
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists homeowner_portal_messages_insert on public.homeowner_portal_messages;
create policy homeowner_portal_messages_insert on public.homeowner_portal_messages
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and author_kind in ('staff', 'adjuster', 'system', 'assistant')
  );

-- Policies (documents)
drop policy if exists homeowner_portal_policies_select on public.homeowner_portal_policies;
create policy homeowner_portal_policies_select on public.homeowner_portal_policies
  for select to authenticated
  using (private.is_org_member(org_id));

-- Grants match the PM tables pattern.
grant select, insert, update on public.homeowner_portal_shares to authenticated;
grant select, insert, update on public.homeowner_portal_visibility to authenticated;
grant select, insert, update on public.homeowner_portal_conversations to authenticated;
grant select, insert on public.homeowner_portal_messages to authenticated;
grant select on public.homeowner_portal_policies to authenticated;
