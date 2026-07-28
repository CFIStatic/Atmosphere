-- ============================================================================
-- App Connectors — curated third-party apps an organization can connect
-- through Web Access (browser agent), Computer Use (desktop agent), or the
-- Construction Estimator's API adapters.
--
-- The catalog itself lives in application code. This table records which
-- catalog entries an org has connected, and (when relevant) which underlying
-- web_connection or estimator provider backs that link.
-- ============================================================================

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

comment on table public.app_connectors is
  'Org links to curated third-party apps (ServiceTitan, AccuLynx, Xactimate, …). Credentials live in web_credentials or estimator credential storage; this row is the catalog membership.';

comment on column public.app_connectors.connector_key is
  'Stable catalog id from the application connector catalog (e.g. servicetitan).';

comment on column public.app_connectors.access_mode is
  'How Atmosphere reaches the app: web (browser agent), computer (desktop agent), or api (estimator vendor adapter).';

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
