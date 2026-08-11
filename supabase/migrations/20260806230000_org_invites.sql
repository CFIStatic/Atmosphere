-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
-- Joining has always worked by code: the org has a join_code, a new person
-- types it at onboarding. That stays — it is simple and it works on a job site.
--
-- What was missing is the other half of "add a team member": the record of who
-- was asked. Without it, the manager who shared the code has no way to see who
-- has not turned up, no way to withdraw an invitation that went to the wrong
-- address, and no answer to "did we ever invite Sam or did everyone assume
-- somebody else had".
--
-- An invite grants nothing the join code does not already grant — every member
-- can read the code in settings, so this table is bookkeeping, not access
-- control. That is why revoking an invite does not rotate the code: the code
-- is the credential, and rotating it is an org-level decision, not a row here.

create table if not exists public.org_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,

  -- Lowercased on write so "Sam@" and "sam@" cannot hold two live invites.
  email        text not null check (position('@' in email) > 1),
  -- Advisory. The joiner picks their own role at onboarding; this records what
  -- the inviter had in mind so the discrepancy is visible, not prevented.
  role         text not null default 'field_technician',
  note         text check (note is null or length(note) <= 500),

  status       text not null default 'pending'
                 check (status in ('pending', 'joined', 'revoked')),

  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  joined_at    timestamptz,
  revoked_at   timestamptz
);

-- One live invitation per address per org. History rows are unconstrained so
-- somebody revoked by mistake can simply be invited again.
create unique index if not exists org_invites_live_unique
  on public.org_invites (org_id, lower(email))
  where status = 'pending';

create index if not exists org_invites_org_idx
  on public.org_invites (org_id, created_at desc);

comment on table public.org_invites is
  'Who was asked to join. Bookkeeping, not access control — the join code is '
  'the credential and every member can already read it.';

alter table public.org_invites enable row level security;

drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists org_invites_insert on public.org_invites;
create policy org_invites_insert on public.org_invites
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists org_invites_update on public.org_invites;
create policy org_invites_update on public.org_invites
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));
