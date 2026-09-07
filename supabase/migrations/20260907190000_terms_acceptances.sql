-- ============================================================================
-- Terms of Service acknowledgments
-- ============================================================================
-- Users must accept the current terms version before using Platform or
-- Field Capture. Re-accept when CURRENT_TERMS_VERSION changes (today:
-- 2026-07-31, matching website/terms.html "Last updated July 31, 2026").
-- One row per user per version; later versions do not overwrite history.
-- ============================================================================

create table if not exists public.terms_acceptances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  terms_version  text not null,
  accepted_at    timestamptz not null default now(),
  ip             text,
  user_agent     text,
  unique (user_id, terms_version)
);

create index if not exists terms_acceptances_user_idx
  on public.terms_acceptances (user_id, accepted_at desc);

comment on table public.terms_acceptances is
  'Explicit Terms of Service acknowledgments. One row per user per terms version.';

comment on column public.terms_acceptances.terms_version is
  'Version string the user accepted, e.g. 2026-07-31.';

alter table public.terms_acceptances enable row level security;

revoke all on table public.terms_acceptances from public, anon, authenticated;
grant select, insert on table public.terms_acceptances to authenticated;
grant all on table public.terms_acceptances to service_role;

drop policy if exists terms_acceptances_self_select on public.terms_acceptances;
create policy terms_acceptances_self_select on public.terms_acceptances
  for select
  using (auth.uid() = user_id);

drop policy if exists terms_acceptances_self_insert on public.terms_acceptances;
create policy terms_acceptances_self_insert on public.terms_acceptances
  for insert
  with check (auth.uid() = user_id);
