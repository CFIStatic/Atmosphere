-- Remote schema_migrations version 20260907172826 (Management API).
-- Idempotent; aligns git so Supabase Preview can resolve remote versions.

-- ============================================================================
-- terms_acceptances: table + GRANTs so service_role (and authenticated) can
-- persist acknowledgments. Production accept uses the service_role client
-- (upsert needs INSERT + UPDATE). Railway does not run migrations on boot —
-- apply via backend/scripts/applyTermsAcceptances.mjs or paste this in the
-- Supabase SQL editor for the SAME project the BFF's SUPABASE_URL points at.
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

alter table public.terms_acceptances enable row level security;

revoke all on table public.terms_acceptances from public, anon;
grant select, insert, update on table public.terms_acceptances to authenticated;
grant all on table public.terms_acceptances to service_role;

drop policy if exists terms_acceptances_self_select on public.terms_acceptances;
create policy terms_acceptances_self_select on public.terms_acceptances
  for select
  using (auth.uid() = user_id);

drop policy if exists terms_acceptances_self_insert on public.terms_acceptances;
create policy terms_acceptances_self_insert on public.terms_acceptances
  for insert
  with check (auth.uid() = user_id);

drop policy if exists terms_acceptances_self_update on public.terms_acceptances;
create policy terms_acceptances_self_update on public.terms_acceptances
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
