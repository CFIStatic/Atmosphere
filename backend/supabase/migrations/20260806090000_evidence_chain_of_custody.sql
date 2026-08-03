-- ---------------------------------------------------------------------------
-- Evidence, and its chain of custody
-- ---------------------------------------------------------------------------
-- Digital evidence management, borrowed wholesale from how police forces handle
-- body-camera footage — because the problem is the same one.
--
-- A general contractor and a subcontractor end up in front of a mediator, or an
-- adjuster, or each other's lawyers, arguing about what happened on a Tuesday
-- in August. Video of that Tuesday is worth nothing on its own. What makes it
-- worth something is being able to say: this file has not been altered since it
-- arrived, here is everyone who has ever opened it, here is when, and here is
-- why it still exists.
--
-- That is chain of custody, and it is the whole reason a police evidence system
-- looks the way it does. Three things follow from it:
--
--   Every access is a row. Viewing is an event, not a non-event. "You never
--   showed me that video" and "you watched it on the 4th at 09:12" are the two
--   halves of the argument this table settles.
--
--   Nothing is deleted on a schedule that a dispute has not been told about.
--   Retention runs per category, and a legal hold outranks it — the same
--   arrangement every records system in a regulated industry uses, for the same
--   reason.
--
--   The log is append-only at the database, not by convention. A custody record
--   that the custodian can edit is not a custody record.

-- ---------------------------------------------------------------------------
-- Evidence metadata on the proof itself
-- ---------------------------------------------------------------------------

do $$ begin
  create type job_evidence_category as enum (
    'before',          -- start of a work day
    'after',           -- end of a work day
    'condition',       -- pre-existing damage, filmed to establish it was there first
    'issue',           -- something wrong, filmed to raise it
    'completion',      -- final walkthrough
    'other'
  );
exception when duplicate_object then null; end $$;

alter table public.job_proofs
  add column if not exists category job_evidence_category,
  add column if not exists title text,
  add column if not exists tags text[] not null default '{}',
  -- When this may be destroyed. Null means nobody has decided, which is not the
  -- same as "keep forever" and is reported as an open question rather than
  -- quietly treated as either.
  add column if not exists retention_until date,
  -- Outranks retention entirely. Set while a day is disputed; nothing on hold
  -- is ever purged, whatever the policy says.
  add column if not exists legal_hold boolean not null default false,
  add column if not exists hold_reason text;

comment on column public.job_proofs.legal_hold is
  'Outranks retention. A day somebody is arguing about does not expire in the '
  'middle of the argument.';

-- Backfill the category from the phase, which is what it always meant.
update public.job_proofs
   set category = phase::text::job_evidence_category
 where category is null;

create index if not exists job_proofs_category_idx
  on public.job_proofs (org_id, category, work_date desc);
create index if not exists job_proofs_hold_idx
  on public.job_proofs (org_id) where legal_hold;

-- ---------------------------------------------------------------------------
-- The chain of custody
-- ---------------------------------------------------------------------------
-- One row per thing anybody ever did to a piece of evidence, including looking
-- at it.

do $$ begin
  create type job_evidence_action as enum (
    'uploaded',
    'viewed',
    'downloaded',
    'analysed',    -- the model read the frames
    'accepted',
    'rejected',
    'held',        -- placed on legal hold
    'released',    -- hold lifted
    'shared'       -- a link handed to somebody outside
  );
exception when duplicate_object then null; end $$;

create table if not exists public.job_evidence_access (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  job_id       uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id     uuid references public.job_proofs (id) on delete cascade,

  action       job_evidence_action not null,

  -- Exactly one of these, or neither for something the system did on its own.
  actor_id     uuid references public.profiles (id) on delete set null,
  party_id     uuid references public.job_parties (id) on delete set null,
  -- Copied in at the time. Resolving who by join would rewrite history the day
  -- somebody changes their name or leaves the company.
  actor_label  text not null,
  actor_role   text,

  detail       text check (detail is null or length(detail) <= 500),
  occurred_at  timestamptz not null default now()
);

create index if not exists job_evidence_access_proof_idx
  on public.job_evidence_access (proof_id, occurred_at desc);
create index if not exists job_evidence_access_job_idx
  on public.job_evidence_access (job_id, occurred_at desc);

comment on table public.job_evidence_access is
  'Chain of custody. One row per access, including views. A custody record the '
  'custodian can edit is not a custody record.';

-- Append-only at the database. Not a convention, not a code path — the two
-- statements that would let somebody tidy up an inconvenient view simply fail.
create or replace function private.job_evidence_access_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The chain of custody cannot be edited or deleted.';
end;
$$;

drop trigger if exists job_evidence_access_immutable on public.job_evidence_access;
create trigger job_evidence_access_immutable
  before update or delete on public.job_evidence_access
  for each row execute function private.job_evidence_access_append_only();

alter table public.job_evidence_access enable row level security;

drop policy if exists job_evidence_access_select on public.job_evidence_access;
create policy job_evidence_access_select on public.job_evidence_access
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists job_evidence_access_insert on public.job_evidence_access;
create policy job_evidence_access_insert on public.job_evidence_access
  for insert to authenticated with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Retention policy, per org
-- ---------------------------------------------------------------------------
-- Deliberately dull and deliberately explicit. Storage grows by two videos per
-- crew per day forever, so somebody has to decide — and a system that quietly
-- decided for them would eventually delete the one file a dispute needed.

create table if not exists public.job_evidence_policy (
  org_id       uuid primary key references public.orgs (id) on delete cascade,
  -- Years to keep, per category. Completion footage outlives a daily before.
  keep_years   jsonb not null default
    '{"before": 2, "after": 2, "condition": 7, "issue": 7, "completion": 7, "other": 2}'::jsonb,
  -- Nothing is ever actually destroyed by this system. The date is computed and
  -- shown; a human still has to act on it, because an automatic purge is how a
  -- file disappears the week before it was needed.
  auto_purge   boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.job_evidence_policy enable row level security;

drop policy if exists job_evidence_policy_select on public.job_evidence_policy;
create policy job_evidence_policy_select on public.job_evidence_policy
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists job_evidence_policy_write on public.job_evidence_policy;
create policy job_evidence_policy_write on public.job_evidence_policy
  for all to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- The evidence list, as a table wants it
-- ---------------------------------------------------------------------------

create or replace view public.job_evidence_items
with (security_invoker = true) as
select
  p.id,
  p.org_id,
  p.job_id,
  p.party_id,
  y.company                       as party_company,
  y.trade                         as party_trade,
  p.work_date,
  p.phase,
  p.category,
  coalesce(p.title, initcap(p.phase::text) || ' — ' || to_char(p.work_date, 'Mon DD')) as title,
  p.tags,
  p.duration_seconds,
  p.byte_size,
  p.captured_at,
  p.received_at,
  p.lat,
  p.lon,
  p.state,
  p.checks,
  p.ai_summary,
  p.legal_hold,
  p.retention_until,
  p.content_hash,
  -- How many times it has been opened, and when last. The two numbers somebody
  -- looks for first when they are asked whether the other side had seen it.
  (select count(*) from public.job_evidence_access a
    where a.proof_id = p.id and a.action in ('viewed', 'downloaded'))  as view_count,
  (select max(a.occurred_at) from public.job_evidence_access a
    where a.proof_id = p.id and a.action in ('viewed', 'downloaded'))  as last_viewed_at
from public.job_proofs p
left join public.job_parties y on y.id = p.party_id;

comment on view public.job_evidence_items is
  'Evidence as a list wants it: one row per file, with who filed it and how '
  'often it has been opened.';
