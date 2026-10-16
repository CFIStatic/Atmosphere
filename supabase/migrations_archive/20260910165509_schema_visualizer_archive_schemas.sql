-- Atmosphere schema visualizer cleanup — STEP 1 (SAFE)
-- Creates empty schemas only. No table moves. No drops.
-- Coordinator: review, then apply via Supabase SQL editor / migration pipeline.

create schema if not exists archive;
create schema if not exists pm;
create schema if not exists research;
create schema if not exists portal;

comment on schema archive is
  'Legacy / dead product tables moved out of public for Schema Visualizer clarity. Not exposed to PostgREST.';
comment on schema pm is
  'Project Manager agent tables (not office sold-path). Not exposed to PostgREST by default.';
comment on schema research is
  'Geometry/twins, crew geo, and research-adjacent tables pending product decision.';
comment on schema portal is
  'Homeowner portal tables (API may still need grants — review before revoke).';

-- Optional: revoke default API usage once Dashboard exposed-schemas is updated.
-- revoke usage on schema archive from anon, authenticated;
-- revoke usage on schema pm from anon, authenticated;
-- revoke usage on schema research from anon, authenticated;
-- revoke usage on schema portal from anon, authenticated;
