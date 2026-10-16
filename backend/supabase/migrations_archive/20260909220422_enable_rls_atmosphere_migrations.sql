-- Internal migrate ledger must not be readable via PostgREST anon/authenticated.
-- service_role bypasses RLS. Applied live earlier; file aligns git with remote.

alter table public.atmosphere_migrations enable row level security;
alter table public.atmosphere_migrations force row level security;
