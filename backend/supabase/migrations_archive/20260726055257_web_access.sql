-- Atmosphere — Web Access
-- Org-scoped connections to external websites the AI signs into, plus the runs
-- it performs against them. All three tables are RLS-protected and reachable
-- only through the caller's JWT.

create table if not exists public.web_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  created_by       uuid not null references auth.users (id) on delete cascade,
  label            text not null check (char_length(label) between 2 and 80),
  site_url         text not null,
  login_url        text,
  username         text not null,
  status           text not null default 'unverified'
                     check (status in ('unverified', 'verified', 'failed')),
  last_verified_at timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, label)
);

create index if not exists web_connections_org_idx on public.web_connections (org_id, created_at desc);

-- Sealed credentials live apart from the connection so a routine read of a
-- connection can never carry the secret material with it.
create table if not exists public.web_credentials (
  connection_id uuid primary key references public.web_connections (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,
  ciphertext    text not null,
  iv            text not null,
  auth_tag      text not null,
  key_version   integer not null default 1,
  updated_at    timestamptz not null default now()
);

create table if not exists public.web_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  connection_id uuid not null references public.web_connections (id) on delete cascade,
  created_by    uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('pull', 'push')),
  instruction   text not null check (char_length(instruction) between 4 and 4000),
  input_data    jsonb,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'succeeded', 'failed')),
  result        jsonb,
  steps         jsonb not null default '[]'::jsonb,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists web_runs_org_idx on public.web_runs (org_id, created_at desc);
create index if not exists web_runs_connection_idx on public.web_runs (connection_id, created_at desc);

-- Membership is read straight off org_members. That table's own policies still
-- apply to the subquery, so this cannot widen a caller's view — and because no
-- policy reads the table it protects, there is no recursion to work around.
alter table public.web_connections enable row level security;
alter table public.web_credentials enable row level security;
alter table public.web_runs        enable row level security;

drop policy if exists web_connections_rw on public.web_connections;
create policy web_connections_rw on public.web_connections
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists web_credentials_rw on public.web_credentials;
create policy web_credentials_rw on public.web_credentials
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists web_runs_rw on public.web_runs;
create policy web_runs_rw on public.web_runs
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

create or replace function public.web_access_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists web_connections_touch on public.web_connections;
create trigger web_connections_touch
  before update on public.web_connections
  for each row execute function public.web_access_touch_updated_at();

drop trigger if exists web_credentials_touch on public.web_credentials;
create trigger web_credentials_touch
  before update on public.web_credentials
  for each row execute function public.web_access_touch_updated_at();