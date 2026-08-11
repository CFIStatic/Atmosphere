-- The contributory contact network.
--
-- This is how Seamless, Apollo and Lusha actually get most of their volume:
-- customers connect a CRM or a mailbox, everyone's business contacts are
-- pooled, and each customer searches the pool the others filled. It is the
-- single biggest lever on match rate in the product, and it is also the
-- biggest legal exposure in it, because the people in the pool never agreed
-- to be there.
--
-- So consent is built into the schema rather than bolted on as a checkbox:
--
--   * Contribution is opt-in per organization and off by default. An org that
--     never opts in never contributes a row, and there is no code path that
--     writes one on their behalf.
--   * Only business addresses are ever pooled. Free-mail domains and role
--     mailboxes are rejected by a CHECK, not merely filtered in code, so a
--     bug upstream cannot leak somebody's gmail into a shared table.
--   * Every row records which org contributed it and when, so a contribution
--     can be withdrawn wholesale when an org opts out or leaves.
--   * A global suppression tombstone outranks every row. When a person asks
--     to be removed, the erasure has to survive re-contribution by a
--     different org tomorrow — otherwise "delete me" means "delete me until
--     someone syncs their CRM again", which is not erasure at all.
--
-- Reads are deliberately NOT row-level-scoped to the contributing org: the
-- whole point is cross-org sharing. What protects people here is the
-- narrowness of what may enter, plus the tombstones, plus opt-in.

create table if not exists public.network_contribution_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  -- Off unless a human turned it on. The default is the consent decision.
  contributing boolean not null default false,
  -- Who turned it on, and when, because "we have consent" needs a record.
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.network_contribution_settings is
  'Per-org opt-in to the shared contact network. Off by default; contribution requires an explicit, recorded decision.';

-- Business addresses only. These mirror ROLE_LOCALS / FREE_DOMAINS in
-- verification.ts; duplicated here on purpose, because a constraint the
-- database enforces is worth more than one the application remembers.
create or replace function public.is_poolable_address(addr text)
returns boolean
language sql
immutable
as $$
  select addr is not null
     and addr = lower(addr)
     and addr ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     and split_part(addr, '@', 2) not in (
       'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com',
       'icloud.com','me.com','live.com','msn.com','proton.me','protonmail.com'
     )
     and split_part(addr, '@', 1) not in (
       'info','sales','support','admin','office','contact','hello','help',
       'billing','accounts','noreply','no-reply','postmaster','webmaster',
       'abuse','marketing','jobs','careers','team'
     )
$$;

create table if not exists public.network_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  domain text not null,
  full_name text not null,
  title text,
  company_name text,
  phone text,
  mobile text,
  -- Which org supplied this, so opting out can withdraw everything they gave.
  contributed_by uuid not null references public.orgs (id) on delete cascade,
  contributed_at timestamptz not null default now(),
  -- How many distinct orgs have independently supplied the same pairing.
  -- Agreement between organizations that have never met is the strongest
  -- signal in the pool, and it is what ranks a candidate.
  corroborations integer not null default 1,
  constraint network_contacts_business_only check (public.is_poolable_address(email)),
  constraint network_contacts_named check (length(trim(full_name)) > 2)
);

create unique index if not exists network_contacts_unique
  on public.network_contacts (email, contributed_by);
create index if not exists network_contacts_domain_idx
  on public.network_contacts (domain);
create index if not exists network_contacts_name_idx
  on public.network_contacts (lower(full_name));

comment on table public.network_contacts is
  'Pooled business contacts contributed by opted-in organizations. Business addresses only, enforced by constraint.';

-- Erasure that outlives re-contribution.
--
-- Without this, a deletion is undone the moment another org syncs a CRM that
-- still holds the person. The tombstone is global and permanent, and every
-- read and write path checks it.
create table if not exists public.network_erasures (
  email text primary key,
  reason text,
  erased_at timestamptz not null default now()
);

comment on table public.network_erasures is
  'Permanent global do-not-pool list. Outranks every network_contacts row and survives re-contribution.';

create or replace function public.network_block_erased()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.network_erasures e where e.email = new.email) then
    raise exception 'address_erased' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists network_contacts_erasure_guard on public.network_contacts;
create trigger network_contacts_erasure_guard
  before insert or update on public.network_contacts
  for each row execute function public.network_block_erased();

-- Erasing removes what is already pooled, in the same transaction as the
-- tombstone. A tombstone that only stops future writes would leave the person
-- in the pool indefinitely.
create or replace function public.network_erase(p_email text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.network_erasures (email, reason)
  values (lower(p_email), p_reason)
  on conflict (email) do nothing;

  delete from public.network_contacts where email = lower(p_email);
end;
$$;

-- Contribute one contact, or corroborate one already pooled.
--
-- Refuses silently rather than raising when the org has not opted in: callers
-- contribute in bulk alongside other work, and one un-opted org should not
-- fail somebody's import.
create or replace function public.network_contribute(
  p_org uuid,
  p_email text,
  p_full_name text,
  p_title text default null,
  p_company text default null,
  p_phone text default null,
  p_mobile text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_opted boolean;
begin
  select contributing into v_opted
  from public.network_contribution_settings
  where org_id = p_org;

  if coalesce(v_opted, false) is not true then
    return false;
  end if;

  if not public.is_poolable_address(v_email) then
    return false;
  end if;

  if exists (select 1 from public.network_erasures where email = v_email) then
    return false;
  end if;

  insert into public.network_contacts (
    email, domain, full_name, title, company_name, phone, mobile, contributed_by
  )
  values (
    v_email, split_part(v_email, '@', 2), trim(p_full_name),
    p_title, p_company, p_phone, p_mobile, p_org
  )
  on conflict (email, contributed_by) do update
    set full_name = excluded.full_name,
        title = coalesce(excluded.title, public.network_contacts.title),
        company_name = coalesce(excluded.company_name, public.network_contacts.company_name),
        phone = coalesce(excluded.phone, public.network_contacts.phone),
        mobile = coalesce(excluded.mobile, public.network_contacts.mobile),
        contributed_at = now();

  -- Corroboration counts distinct contributors, so an org re-syncing its own
  -- CRM cannot inflate confidence in its own data.
  update public.network_contacts
     set corroborations = (
       select count(distinct contributed_by)
       from public.network_contacts n2
       where n2.email = v_email
     )
   where email = v_email;

  return true;
end;
$$;

-- Withdraw everything an org ever gave, for when they opt out or leave.
create or replace function public.network_withdraw(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.network_contacts where contributed_by = p_org;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.network_contribution_settings enable row level security;
alter table public.network_contacts enable row level security;
alter table public.network_erasures enable row level security;

-- An org sees and sets only its own contribution decision.
drop policy if exists network_settings_own on public.network_contribution_settings;
create policy network_settings_own on public.network_contribution_settings
  for all
  using (
    org_id in (select m.org_id from public.org_members m where m.user_id = auth.uid())
  )
  with check (
    org_id in (
      select m.org_id from public.org_members m
      where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
  );

-- The pool itself is read through the service role only. Handing clients a
-- direct SELECT over every pooled contact would be handing them the database
-- the product sells access to, one page at a time.
drop policy if exists network_contacts_no_direct_read on public.network_contacts;
create policy network_contacts_no_direct_read on public.network_contacts
  for select using (false);

drop policy if exists network_erasures_no_direct on public.network_erasures;
create policy network_erasures_no_direct on public.network_erasures
  for select using (false);

grant execute on function public.network_erase(text, text) to service_role;
grant execute on function public.network_contribute(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.network_withdraw(uuid) to service_role;
