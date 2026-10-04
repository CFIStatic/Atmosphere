-- ============================================================================
-- Computer › Logins: saved usernames and passwords, so Computer can sign
-- itself back in to a site on the Logins list.
--
-- The username and password are sealed in the backend with AES-256-GCM
-- (key: COMPUTER_CREDENTIAL_KEY, never in the database) before they are
-- written here. Each sealed value is bound to its org, login and field, so a
-- value copied to another row does not open. Plaintext never reaches this
-- table, the audit log, the AI model or the browser API responses.
--
-- One saved credential per site (login_id is the key). Removing the site
-- deletes it (on delete cascade). status = 'needs_attention' after a saved
-- password stops working, until an admin saves a new one.
--
-- Service role only (RLS on, no member access), like the other computer_*
-- tables. Safe to re-run.
-- ============================================================================

create table if not exists public.computer_login_credentials (
  login_id          uuid primary key references public.computer_logins (id) on delete cascade,
  org_id            uuid not null references public.orgs (id) on delete cascade,
  username_sealed   text not null check (username_sealed like 'v1.%' and char_length(username_sealed) <= 2048),
  password_sealed   text not null check (password_sealed like 'v1.%' and char_length(password_sealed) <= 2048),
  key_fingerprint   text not null check (char_length(key_fingerprint) between 8 and 64),
  login_url         text check (login_url is null or (login_url ~* '^https?://' and char_length(login_url) <= 2048)),
  status            text not null default 'ok' check (status in ('ok', 'needs_attention')),
  attention_reason  text check (attention_reason is null or char_length(attention_reason) <= 300),
  last_used_at      timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists computer_login_credentials_org_idx
  on public.computer_login_credentials (org_id);

comment on table public.computer_login_credentials is
  'Saved sign-ins for Computer (Logins page). Username and password are '
  'AES-256-GCM sealed by the backend (COMPUTER_CREDENTIAL_KEY); never plaintext.';

alter table public.computer_login_credentials enable row level security;

drop policy if exists computer_login_credentials_no_user_access on public.computer_login_credentials;
create policy computer_login_credentials_no_user_access on public.computer_login_credentials
  for select to authenticated using (false);

revoke all on public.computer_login_credentials from anon, authenticated;
