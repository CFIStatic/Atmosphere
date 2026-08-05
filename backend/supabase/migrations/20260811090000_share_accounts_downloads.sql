-- ---------------------------------------------------------------------------
-- Shares become account-to-account; downloads become a ledger
-- ---------------------------------------------------------------------------
-- Two policy changes to the evidence portal, both structural.
--
-- First: a Verifier share stops being an anonymous link and becomes a grant
-- to a *person with an Atmosphere account*. The share is pinned to the
-- recipient's email at issue time; opening it requires signing in as that
-- email. What this buys is the thing the custody log always wanted — a
-- verified identity on every external view, instead of "whoever held the
-- link". (It also means every adjuster and attorney who reviews evidence
-- ends up with an Atmosphere account, which is not an accident.)
--
-- Second: watching is free, keeping a copy is not. Streaming a clip inside
-- the portal costs the org nothing but bandwidth; a download leaves the
-- custody boundary forever, and it is the operation outside counsel and
-- carriers actually need. The fee is the org's to set, the ledger is
-- append-once, and no signed download URL exists for an external account
-- until its ledger row reads paid.

alter table public.verifier_shares
  add column if not exists recipient_email text
    check (recipient_email is null or position('@' in recipient_email) > 1);

comment on column public.verifier_shares.recipient_email is
  'Who this share was issued to. Opening requires a session whose email '
  'matches (case-insensitive). Null only on legacy rows issued before shares '
  'became account-to-account.';

-- What an org charges for a download. One row per org, service-role managed.
create table if not exists public.evidence_download_policy (
  org_id             uuid primary key references public.orgs (id) on delete cascade,
  download_fee_cents integer not null default 2500
                       check (download_fee_cents between 0 and 100000),
  updated_at         timestamptz not null default now()
);

alter table public.evidence_download_policy enable row level security;

drop policy if exists evidence_download_policy_select on public.evidence_download_policy;
create policy evidence_download_policy_select on public.evidence_download_policy
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists evidence_download_policy_write on public.evidence_download_policy;
create policy evidence_download_policy_write on public.evidence_download_policy
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- The download ledger. One row per requested copy, whoever requested it.
create table if not exists public.evidence_downloads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  proof_id      uuid not null references public.job_proofs (id) on delete cascade,
  share_id      uuid references public.verifier_shares (id) on delete set null,

  -- The account that asked. Always a real account now — that is the point.
  requested_by  uuid not null references auth.users (id) on delete cascade,
  requester_email text not null,

  fee_cents     integer not null check (fee_cents >= 0),
  status        text not null default 'pending_payment'
                  check (status in ('pending_payment', 'paid', 'waived')),
  -- How it was settled: 'stripe' when the checkout wired to the webhooks
  -- router settles it, 'org_member' for the free internal path, 'dev' for
  -- development. A paid row without a method cannot exist.
  paid_via      text,
  paid_at       timestamptz,
  constraint evidence_download_paid_is_stamped
    check (status = 'pending_payment' or (paid_at is not null and paid_via is not null)),

  created_at    timestamptz not null default now()
);

create index if not exists evidence_downloads_proof_idx
  on public.evidence_downloads (proof_id, created_at desc);
create index if not exists evidence_downloads_requester_idx
  on public.evidence_downloads (requested_by, created_at desc);

comment on table public.evidence_downloads is
  'One row per requested copy of a clip. No signed download URL is minted '
  'for an external account until its row reads paid or waived.';

-- A settled ledger row is a record of money. The status may move forward
-- (pending -> paid/waived) exactly once; nothing moves backward or sideways.
create or replace function private.evidence_downloads_settle_once()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending_payment' then
    raise exception 'A settled download is a record. It cannot change.';
  end if;
  if new.status = 'pending_payment' then
    raise exception 'A download can only move from pending to paid or waived.';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_downloads_settle on public.evidence_downloads;
create trigger evidence_downloads_settle
  before update on public.evidence_downloads
  for each row execute function private.evidence_downloads_settle_once();

alter table public.evidence_downloads enable row level security;

-- The org sees its evidence's download history; a requester sees their own.
drop policy if exists evidence_downloads_org_select on public.evidence_downloads;
create policy evidence_downloads_org_select on public.evidence_downloads
  for select to authenticated
  using (private.is_org_member(org_id) or requested_by = auth.uid());

-- Writes happen server-side only: the fee is computed there, and letting a
-- client insert its own ledger row would let it insert one marked paid.
revoke all on public.evidence_downloads, public.evidence_download_policy from anon;
