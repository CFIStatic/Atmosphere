-- Live crew positions.
--
-- The use is real and it is operational: when a loss comes in at 2am, the
-- question is which technician is closest, and when a storm warning lands the
-- question is who is already in that territory. Neither is answerable from a
-- schedule.
--
-- It is also location tracking of employees, which is a different kind of
-- feature from everything else in this codebase, and the schema is built to
-- reflect that rather than to apologise for it afterwards:
--
--   * Sharing is opt-in BY THE PERSON BEING TRACKED, not by their employer.
--     An owner cannot switch it on for somebody else. That is the whole
--     difference between a tool a crew accepts and one they work around by
--     leaving the phone in the truck.
--
--   * Positions expire. A live position answers "where is Ken now"; keeping
--     six months of them answers "where was Ken every Tuesday evening in
--     March", which is a different product nobody asked for. Default 24 hours.
--
--   * There is a hard off switch that also deletes. Stopping sharing without
--     removing what was already collected is not stopping.
--
--   * Several US states — California, Connecticut, Delaware, New York among
--     them — require notice or consent before tracking an employee, and
--     tracking outside working hours is a much harder thing to justify
--     anywhere. `share_window` exists so an org can confine it to shifts.

create table if not exists public.crew_location_consent (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,

  -- Off until the person themselves turns it on. No admin path writes this.
  sharing      boolean not null default false,

  -- 'always' | 'shift' — whether to share around the clock or only while on
  -- shift. Defaults to the narrower of the two.
  share_window text not null default 'shift' check (share_window in ('always', 'shift')),

  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.crew_location_consent is
  'Per-person opt-in to location sharing. Written only by the person themselves — no admin path sets this for somebody else.';

create table if not exists public.crew_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,

  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  -- Metres. A 2km fix is not a location and the UI says so rather than drawing
  -- a confident dot in the wrong place.
  accuracy_m  double precision,
  heading     double precision,
  speed_mps   double precision,

  -- 'browser' today. Recorded so a phone fix is distinguishable from one a
  -- future vehicle tracker supplies.
  source      text not null default 'browser',

  captured_at timestamptz not null default now(),
  -- When this row deletes itself. Set on insert from the org's retention
  -- setting, so expiry is a property of the row rather than of a cron job
  -- somebody might disable.
  expires_at  timestamptz not null
);

create index if not exists crew_locations_org_idx
  on public.crew_locations (org_id, captured_at desc);
create index if not exists crew_locations_user_idx
  on public.crew_locations (user_id, captured_at desc);
create index if not exists crew_locations_expiry_idx
  on public.crew_locations (expires_at);

comment on table public.crew_locations is
  'Crew positions, self-expiring. Answers "who is closest right now" — deliberately not "where was somebody last March".';

-- The current position of everyone sharing, and nothing historical.
--
-- A view rather than a query the UI writes, so "latest per person, only if
-- they consented, only if unexpired" cannot be got wrong by a future caller
-- who forgets one of the three.
create or replace view public.crew_live_positions as
  select distinct on (l.user_id)
    l.user_id,
    l.org_id,
    l.lat,
    l.lon,
    l.accuracy_m,
    l.heading,
    l.speed_mps,
    l.captured_at
  from public.crew_locations l
  join public.crew_location_consent c on c.user_id = l.user_id
  where c.sharing = true
    and l.expires_at > now()
  order by l.user_id, l.captured_at desc;

alter view public.crew_live_positions set (security_invoker = true);

comment on view public.crew_live_positions is
  'Latest unexpired position per consenting person. The consent join is here so no caller can forget it.';

/**
 * Record a position.
 *
 * SECURITY DEFINER, and it refuses when the caller has not opted in. Putting
 * that check here rather than in the route means there is no second way to
 * write a row — a future endpoint, a background job, an import — that could
 * bypass it.
 */
create or replace function public.record_crew_location(
  p_lat double precision,
  p_lon double precision,
  p_accuracy double precision default null,
  p_heading double precision default null,
  p_speed double precision default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consent public.crew_location_consent%rowtype;
  v_hours integer;
begin
  select * into v_consent
  from public.crew_location_consent
  where user_id = auth.uid();

  -- No consent, no row. Silently, because the client may still be finishing a
  -- watch it started before the person switched sharing off, and that is not
  -- an error worth surfacing to them.
  if not found or v_consent.sharing is not true then
    return false;
  end if;

  select coalesce(location_retention_hours, 24) into v_hours
  from public.orgs where id = v_consent.org_id;

  insert into public.crew_locations (org_id, user_id, lat, lon, accuracy_m, heading, speed_mps, expires_at)
  values (
    v_consent.org_id, auth.uid(), p_lat, p_lon, p_accuracy, p_heading, p_speed,
    now() + make_interval(hours => coalesce(v_hours, 24))
  );

  return true;
end;
$$;

/**
 * Stop sharing, and erase what was collected.
 *
 * One function because they are one action. Turning sharing off while leaving
 * a day of positions in the table is not turning it off, and making erasure a
 * separate button somebody has to find is the same thing with extra steps.
 */
create or replace function public.stop_sharing_location()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  update public.crew_location_consent
     set sharing = false, decided_at = now(), updated_at = now()
   where user_id = auth.uid();

  delete from public.crew_locations where user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- How long positions live. On the org because it is an operational policy, but
-- bounded here so no setting can turn this into a movement history.
alter table public.orgs
  add column if not exists location_retention_hours integer not null default 24;
alter table public.orgs
  drop constraint if exists orgs_location_retention_bounds;
alter table public.orgs
  add constraint orgs_location_retention_bounds
  check (location_retention_hours between 1 and 168);

-- Sweep expired rows. expires_at makes each row self-describing, so this is a
-- tidy-up rather than the thing enforcing the policy.
create or replace function public.sweep_expired_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from public.crew_locations where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter table public.crew_location_consent enable row level security;
alter table public.crew_locations enable row level security;

-- A person reads and writes only their own consent row. Deliberately no
-- admin-write policy: an owner who could switch this on for somebody else
-- would make the opt-in meaningless.
drop policy if exists crew_consent_own on public.crew_location_consent;
create policy crew_consent_own on public.crew_location_consent
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.is_org_member(org_id));

-- Colleagues can see positions — that is the point of the feature — but only
-- within their own organization.
drop policy if exists crew_locations_read on public.crew_locations;
create policy crew_locations_read on public.crew_locations
  for select to authenticated
  using (private.is_org_member(org_id));

-- Writes go through record_crew_location, which checks consent. No direct
-- insert policy exists, so there is no path around that check.
drop policy if exists crew_locations_delete_own on public.crew_locations;
create policy crew_locations_delete_own on public.crew_locations
  for delete to authenticated
  using (user_id = auth.uid());

grant execute on function public.record_crew_location(double precision, double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.stop_sharing_location() to authenticated;
grant execute on function public.sweep_expired_locations() to service_role;
