-- Atmosphere — App Connectors
-- Org links to curated third-party apps (ServiceTitan, AccuLynx, Xactimate, …).
-- Apply once. Prefer the dated migration under supabase/migrations/ when using
-- the Supabase CLI; this copy is for manual installs alongside web_access.sql.

create table if not exists public.app_connectors (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs (id) on delete cascade,
  created_by          uuid not null references auth.users (id) on delete cascade,
  connector_key       text not null
                        check (char_length(connector_key) between 2 and 64),
  access_mode         text not null
                        check (access_mode in ('web', 'computer', 'api')),
  label               text not null
                        check (char_length(label) between 2 and 80),
  status              text not null default 'connected'
                        check (status in ('connected', 'needs_attention', 'disabled')),
  web_connection_id   uuid references public.web_connections (id) on delete set null,
  estimator_provider  text
                        check (
                          estimator_provider is null
                          or estimator_provider in ('docusketch', 'dash', 'xactimate')
                        ),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, connector_key)
);

create index if not exists app_connectors_org_idx
  on public.app_connectors (org_id, created_at desc);

create index if not exists app_connectors_web_connection_idx
  on public.app_connectors (web_connection_id)
  where web_connection_id is not null;

alter table public.app_connectors enable row level security;

drop policy if exists app_connectors_rw on public.app_connectors;
create policy app_connectors_rw on public.app_connectors
  for all
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

create or replace function public.app_connectors_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_connectors_touch on public.app_connectors;
create trigger app_connectors_touch
  before update on public.app_connectors
  for each row execute function public.app_connectors_touch_updated_at();
