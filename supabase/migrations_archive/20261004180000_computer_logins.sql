-- ============================================================================
-- Computer › Logins: sites an org signs in to ahead of time.
--
-- A person opens a site in the org's persistent Browserbase context, signs in
-- themselves through the live view, and presses Done. The sign-in lives in the
-- browser profile (cookies). This table only lists the site; it never holds a
-- password, a cookie value or a live-view URL. cookie_domains is the list of
-- domain names whose cookies changed during that sign-in, so Remove can clear
-- them from the profile.
--
-- computer_sessions gains purpose/login columns so a sign-in session counts
-- toward the existing one-live-session-per-org rule.
--
-- Service role only (RLS on, no member access), like the other computer_*
-- tables. Members reach it through /api/chat-computer/logins, scoped by org.
-- Safe to re-run.
-- ============================================================================

create table if not exists public.computer_logins (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  label              text not null check (char_length(label) between 1 and 80),
  url                text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  host               text not null check (char_length(host) between 1 and 253),
  cookie_domains     text[] not null default '{}',
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  last_signed_in_at  timestamptz,
  last_signed_in_by  uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create unique index if not exists computer_logins_org_host_key
  on public.computer_logins (org_id, lower(host));

comment on table public.computer_logins is
  'Sites an org signed in to for Computer (Logins page). No passwords, cookie '
  'values or live-view URLs; cookie_domains lists domain names only.';

alter table public.computer_sessions
  add column if not exists purpose text not null default 'task',
  add column if not exists login_id uuid references public.computer_logins (id) on delete set null,
  add column if not exists target_url text,
  add column if not exists target_label text,
  add column if not exists started_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'computer_sessions_purpose_check'
  ) then
    alter table public.computer_sessions
      add constraint computer_sessions_purpose_check
      check (purpose in ('task', 'login', 'logout'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'computer_sessions_target_url_check'
  ) then
    alter table public.computer_sessions
      add constraint computer_sessions_target_url_check
      check (target_url is null or (target_url ~* '^https?://' and char_length(target_url) <= 2048));
  end if;
end $$;

alter table public.computer_logins enable row level security;

drop policy if exists computer_logins_no_user_access on public.computer_logins;
create policy computer_logins_no_user_access on public.computer_logins
  for select to authenticated using (false);

revoke all on public.computer_logins from anon, authenticated;
