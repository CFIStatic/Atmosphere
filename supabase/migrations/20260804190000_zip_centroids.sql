-- Where a ZIP code is.
--
-- Territories are drawn in ZIPs because that is how routes, drive times and
-- franchise agreements are written. Matching one against a weather alert needs
-- a point, and geocoding 41,000 US ZIPs is neither necessary nor polite: an
-- org uses a few dozen, and a ZIP centroid does not move.
--
-- So this fills lazily and keeps forever. First use of a ZIP costs one
-- geocode; every use after that is a local lookup, and the table is shared
-- across organizations because a ZIP's location is a fact about the world
-- rather than anybody's data.

create table if not exists public.zip_centroids (
  zip        text primary key check (zip ~ '^[0-9]{5}$'),
  state      text,
  place      text,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  -- 'nominatim' today. Recorded so a future bulk import from the Census
  -- gazetteer is distinguishable from a lazily geocoded row.
  source     text not null default 'nominatim',
  created_at timestamptz not null default now()
);

comment on table public.zip_centroids is
  'Lazily geocoded ZIP centroids, shared across orgs. A ZIP location is a fact about the world, not tenant data — so this is deliberately not org-scoped.';

alter table public.zip_centroids enable row level security;

-- Readable by anyone signed in: it is public geography, and org-scoping it
-- would mean geocoding the same ZIP once per customer for no benefit.
drop policy if exists zip_centroids_read on public.zip_centroids;
create policy zip_centroids_read on public.zip_centroids
  for select to authenticated using (true);

-- Written only by the server, so a client cannot poison the shared table by
-- claiming 78664 is in Alaska.
drop policy if exists zip_centroids_no_client_write on public.zip_centroids;
create policy zip_centroids_no_client_write on public.zip_centroids
  for insert to authenticated with check (false);

-- Territories gain an explicit state, so an org working only by city name
-- still has weather coverage rather than silently having none.
alter table public.crm_territories
  add column if not exists state text;
alter table public.crm_territories
  drop constraint if exists crm_territories_state_shape;
alter table public.crm_territories
  add constraint crm_territories_state_shape
  check (state is null or state ~ '^[A-Z]{2}$');

comment on column public.crm_territories.state is
  'Two-letter state. Usually derivable from the ZIPs; explicit for territories described only by city or county name.';
