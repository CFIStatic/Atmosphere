-- OAuth grants against customers' own CRMs.
--
-- The mirror's standing rule is that credentials come from the environment and
-- the database stores only the *name* of a secret. That rule is right when we
-- hold one account with a vendor, and it cannot work here: a Salesforce
-- refresh token belongs to one customer's org, and there are as many as there
-- are customers. They have to live somewhere.
--
-- So this table is the deliberate exception, and it is built to earn it:
--
--   * The token is sealed with AES-256-GCM before it arrives. These columns
--     hold ciphertext, IV and auth tag — never anything usable.
--   * The sealing key lives only in INTEGRATIONS_OAUTH_KEY, deliberately not
--     in the database. A dump of this table on its own is inert.
--   * No SELECT policy exists for authenticated users. Members can see that a
--     CRM is connected through an endpoint that reads it with the service
--     role; nobody reads these rows with a user session, because no user-facing
--     feature needs to.
--
-- A refresh token is the strongest credential in the system: long-lived, and
-- it grants whatever the connecting user could do. That is exactly why it is
-- better than the alternative — a stored password, which grants that *and*
-- defeats the customer's MFA and cannot be revoked without changing it.

create table if not exists public.crm_oauth_grants (
  org_id       uuid not null references public.orgs (id) on delete cascade,
  -- 'salesforce', and whatever else grows an OAuth flow later.
  system       text not null check (length(btrim(system)) between 1 and 40),

  -- The sealed grant. Never readable without the environment key.
  iv           text not null,
  tag          text not null,
  ciphertext   text not null,

  -- Enough to tell which account is connected, and nothing more.
  -- The instance hostname, not a token and not a password.
  account_label text,

  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),

  primary key (org_id, system)
);

comment on table public.crm_oauth_grants is
  'Sealed OAuth refresh tokens for customers'' own CRMs. Ciphertext only; the key lives in INTEGRATIONS_OAUTH_KEY, never here. Service-role access only.';

alter table public.crm_oauth_grants enable row level security;

-- Deliberately no policy granting anything to `authenticated`.
--
-- With RLS enabled and no permissive policy, every user-session query returns
-- nothing — which is the intent. The connect flow writes with the service role
-- and the sync path reads with it; a member never touches this table directly,
-- and an accidental `select *` from a user session cannot leak ciphertext that
-- a future key compromise would then unlock.
drop policy if exists crm_oauth_grants_no_user_access on public.crm_oauth_grants;
create policy crm_oauth_grants_no_user_access on public.crm_oauth_grants
  for select using (false);
