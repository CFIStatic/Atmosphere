-- ---------------------------------------------------------------------------
-- Job locations (room / site tree)
-- ---------------------------------------------------------------------------
-- Required by video_work_verification and llm_verifier_ontology_graph, which
-- attach scenes and ontology nodes to a job's physical hierarchy. The full
-- work_episodes stack lives in backend/supabase/migrations; Supabase Preview
-- only applies supabase/migrations/, so this file mirrors the location table
-- those later migrations reference.

do $$ begin
  create type work_location_kind as enum (
    'site', 'building', 'floor', 'zone', 'room', 'surface', 'assembly'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.job_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  parent_id   uuid references public.job_locations (id) on delete cascade,

  kind        work_location_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 120),
  detail      text check (detail is null or length(detail) <= 200),

  model_element_id text,
  model_source     text check (model_source is null or length(model_source) <= 40),

  created_at  timestamptz not null default now()
);

create index if not exists job_locations_job_idx on public.job_locations (job_id, kind);
create index if not exists job_locations_parent_idx on public.job_locations (parent_id);

create or replace function private.job_location_no_cycle()
returns trigger
language plpgsql
as $$
declare
  walker uuid := new.parent_id;
  hops   int := 0;
begin
  while walker is not null loop
    if walker = new.id then
      raise exception 'A location cannot be inside itself.';
    end if;
    hops := hops + 1;
    if hops > 20 then
      raise exception 'Location nesting is too deep to be real.';
    end if;
    select parent_id into walker from public.job_locations where id = walker;
  end loop;
  return new;
end;
$$;

drop trigger if exists job_locations_acyclic on public.job_locations;
create trigger job_locations_acyclic
  before insert or update of parent_id on public.job_locations
  for each row execute function private.job_location_no_cycle();

alter table public.job_locations enable row level security;

drop policy if exists job_locations_all on public.job_locations;
create policy job_locations_all on public.job_locations
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
