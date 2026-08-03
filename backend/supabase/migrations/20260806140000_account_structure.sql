-- ---------------------------------------------------------------------------
-- Accounts, as they actually are
-- ---------------------------------------------------------------------------
-- crm_accounts has been a flat list of companies. Real customers are not flat,
-- and every gap below costs somebody money in this trade specifically:
--
--   A property management company signs for forty HOAs. Each HOA is its own
--   customer with its own board and its own budget, and the PM company is who
--   pays and who cancels. A flat list makes those forty look like forty
--   unrelated wins, so nobody notices that losing one relationship loses all
--   forty.
--
--   A carrier is not a customer, it is a party to the job. The adjuster works
--   for the carrier; the carrier insures the property; the property belongs to
--   the owner. Modelling that as "account_id on the job" throws away three of
--   the four facts.
--
--   A facilities director sits on two HOA boards and manages a school. One
--   account_id per contact means picking one and losing the rest — and the
--   ones lost are the referral paths.
--
--   The same HOA arrives three times: once from a web form, once from a
--   carrier portal, once from a sub's referral. Nobody merges them, so the
--   history of a customer is split three ways and the person on the phone has
--   a third of it.
--
-- Four additions, in the order they matter.

-- ---------------------------------------------------------------------------
-- 1. Hierarchy
-- ---------------------------------------------------------------------------

alter table public.crm_accounts
  add column if not exists parent_account_id uuid references public.crm_accounts (id) on delete set null;

create index if not exists crm_accounts_parent_idx
  on public.crm_accounts (org_id, parent_account_id)
  where parent_account_id is not null;

comment on column public.crm_accounts.parent_account_id is
  'The account this one sits under — a management company over an HOA, a '
  'franchisor over a branch. Ownership, not partnership; see crm_account_links '
  'for the latter.';

-- A cycle here is not a data-quality problem, it is an outage: every rollup and
-- every breadcrumb walks this tree, and a loop hangs them. Cheaper to refuse
-- the write than to defend every reader.
create or replace function private.crm_accounts_no_cycles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor uuid := new.parent_account_id;
  v_depth  int := 0;
begin
  if new.parent_account_id is null then return new; end if;

  if new.parent_account_id = new.id then
    raise exception 'An account cannot be its own parent.';
  end if;

  -- Walk up. Twenty is far deeper than any real corporate structure and is
  -- here as a backstop in case a cycle predates this trigger.
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = new.id then
      raise exception 'That would put % under itself.', new.name;
    end if;
    select parent_account_id into v_cursor from public.crm_accounts where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  if v_depth >= 20 then
    raise exception 'Account hierarchy is too deep — twenty levels is already more than any real one.';
  end if;

  return new;
end;
$$;

drop trigger if exists crm_accounts_cycle_guard on public.crm_accounts;
create trigger crm_accounts_cycle_guard
  before insert or update of parent_account_id on public.crm_accounts
  for each row execute function private.crm_accounts_no_cycles();

-- ---------------------------------------------------------------------------
-- 2. Relationships that are not ownership
-- ---------------------------------------------------------------------------
-- A carrier does not own a property management company. They are connected, and
-- the connection has a direction and a meaning. Hierarchy cannot express that
-- and stretching it to try is how a rollup ends up counting a carrier's
-- premiums as a customer's revenue.

do $$ begin
  create type crm_account_link_kind as enum (
    'insures',        -- carrier    → the insured party
    'manages',        -- PM company → the property owner it acts for
    'owns',           -- owner      → an entity it holds, short of a full parent
    'subcontracts_to',-- GC         → a sub it hires
    'refers',         -- referral partner → who they send
    'vendor_to',      -- supplier   → who they supply
    'related'         -- known connection, kind not recorded
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_account_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,

  -- Directed. "Acme insures Cedar Ridge" and "Cedar Ridge insures Acme" are
  -- different claims and only one of them is true.
  from_account_id uuid not null references public.crm_accounts (id) on delete cascade,
  to_account_id   uuid not null references public.crm_accounts (id) on delete cascade,
  kind         crm_account_link_kind not null default 'related',
  note         text check (note is null or length(note) <= 500),

  -- Relationships end. A carrier that no longer insures a property is a fact
  -- about last year's claim, not about this year's, and deleting the row would
  -- lose the ability to say which.
  started_on   date,
  ended_on     date,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint crm_account_links_not_self check (from_account_id <> to_account_id),
  constraint crm_account_links_dates_ordered check (
    started_on is null or ended_on is null or ended_on >= started_on
  )
);

-- One live link of each kind between the same pair. Ended ones are
-- unconstrained, so a relationship can genuinely resume.
create unique index if not exists crm_account_links_live_unique
  on public.crm_account_links (from_account_id, to_account_id, kind)
  where ended_on is null;

create index if not exists crm_account_links_from_idx on public.crm_account_links (org_id, from_account_id);
create index if not exists crm_account_links_to_idx   on public.crm_account_links (org_id, to_account_id);

-- ---------------------------------------------------------------------------
-- 3. People at more than one company
-- ---------------------------------------------------------------------------
-- crm_contacts.account_id stays as the primary employer, because most contacts
-- have exactly one and a join for the common case is a waste. This is for the
-- rest: the facilities director on two boards, the adjuster who moved carriers
-- and still answers about the old claims.

create table if not exists public.crm_contact_roles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  contact_id   uuid not null references public.crm_contacts (id) on delete cascade,
  account_id   uuid not null references public.crm_accounts (id) on delete cascade,

  role         text not null default 'contact' check (length(btrim(role)) between 2 and 80),
  -- The one to use when the CRM has to pick. Enforced to at most one below.
  is_primary   boolean not null default false,

  started_on   date,
  ended_on     date,

  created_at   timestamptz not null default now(),
  constraint crm_contact_roles_unique unique (contact_id, account_id, role),
  constraint crm_contact_roles_dates_ordered check (
    started_on is null or ended_on is null or ended_on >= started_on
  )
);

create unique index if not exists crm_contact_roles_one_primary
  on public.crm_contact_roles (contact_id)
  where is_primary and ended_on is null;

create index if not exists crm_contact_roles_account_idx
  on public.crm_contact_roles (org_id, account_id);

-- ---------------------------------------------------------------------------
-- 4. Merging duplicates
-- ---------------------------------------------------------------------------
-- The same customer arriving three times is the most common data problem in
-- this trade, and the most damaging: whoever picks up the phone gets a third of
-- the history and sounds like it.
--
-- Merging never deletes. The losing account stays as a tombstone pointing at
-- the winner, so a bookmark, an old export or a stale integration id still
-- resolves to the right customer instead of 404ing — and so "who merged that,
-- and when" has an answer.

alter table public.crm_accounts
  add column if not exists merged_into_id uuid references public.crm_accounts (id) on delete set null,
  add column if not exists merged_at timestamptz;

create index if not exists crm_accounts_merged_idx
  on public.crm_accounts (org_id, merged_into_id)
  where merged_into_id is not null;

-- A tombstone cannot be a parent, cannot be merged into itself, and cannot
-- collect new records. The check covers the second; the API covers the rest.
alter table public.crm_accounts
  drop constraint if exists crm_accounts_merge_not_self;
alter table public.crm_accounts
  add constraint crm_accounts_merge_not_self check (merged_into_id is null or merged_into_id <> id);

create table if not exists public.crm_account_merges (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,

  winner_id    uuid not null references public.crm_accounts (id) on delete cascade,
  loser_id     uuid not null references public.crm_accounts (id) on delete cascade,
  -- What moved, counted. A merge that quietly moved four hundred records is
  -- one somebody needs to be able to see the size of afterwards.
  moved        jsonb not null default '{}'::jsonb,
  -- The losing row as it stood, so a bad merge can be reasoned about even
  -- though it cannot be undone in one click.
  loser_snapshot jsonb,

  merged_by    uuid references public.profiles (id) on delete set null,
  merged_at    timestamptz not null default now(),

  constraint crm_account_merges_distinct check (winner_id <> loser_id)
);

create index if not exists crm_account_merges_winner_idx
  on public.crm_account_merges (org_id, winner_id, merged_at desc);

create or replace function private.crm_account_merges_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A merge is a record of something that happened. It cannot be edited away.';
end;
$$;

drop trigger if exists crm_account_merges_immutable on public.crm_account_merges;
create trigger crm_account_merges_immutable
  before update or delete on public.crm_account_merges
  for each row execute function private.crm_account_merges_append_only();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['crm_account_links', 'crm_contact_roles', 'crm_account_merges'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t || '_insert', t);
  end loop;

  -- Links and roles end; merges do not change.
  foreach t in array array['crm_account_links', 'crm_contact_roles'] loop
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
-- The tree, with its numbers
-- ---------------------------------------------------------------------------
-- Recursive, because a rollup that only added the direct children would report
-- a management company's revenue as zero — all of it sits two levels down.

create or replace view public.crm_account_tree
with (security_invoker = true) as
with recursive walk as (
  select
    a.id,
    a.org_id,
    a.id            as root_id,
    a.parent_account_id,
    a.name,
    a.type,
    0               as depth,
    array[a.name]   as path
  from public.crm_accounts a
  where a.parent_account_id is null
    and a.merged_into_id is null

  union all

  select
    c.id,
    c.org_id,
    w.root_id,
    c.parent_account_id,
    c.name,
    c.type,
    w.depth + 1,
    w.path || c.name
  from public.crm_accounts c
  join walk w on c.parent_account_id = w.id
  -- The trigger prevents cycles going in; this bounds the walk regardless,
  -- because a view that can hang is a page that never loads.
  where w.depth < 20
    and c.merged_into_id is null
)
select * from walk;

comment on view public.crm_account_tree is
  'Every account with its root, depth and path. Merged tombstones are excluded '
  'so a customer never appears twice.';

create or replace view public.crm_account_rollup
with (security_invoker = true) as
select
  t.root_id,
  t.org_id,
  count(distinct t.id)                                           as accounts,
  count(distinct j.id)                                           as jobs,
  coalesce(sum(j.contract_amount), 0)                            as contract_total,
  coalesce(sum(j.invoiced_amount), 0)                            as invoiced_total,
  coalesce(sum(j.paid_amount), 0)                                as paid_total,
  count(distinct j.id) filter (
    where j.status in ('draft', 'scheduled', 'in_progress', 'on_hold')
  )                                                              as open_jobs
from public.crm_account_tree t
left join public.crm_jobs j on j.account_id = t.id and j.org_id = t.org_id
group by t.root_id, t.org_id;

comment on view public.crm_account_rollup is
  'Jobs and money across a whole account tree. A management company''s own row '
  'is usually empty; the relationship is worth what sits under it.';
