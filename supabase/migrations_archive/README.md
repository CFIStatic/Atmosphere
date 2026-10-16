# Archived migrations (squashed 2026-10-15)

These 220 files are the hand-applied history of the Atmosphere database up to
2026-10-15. They cannot rebuild a database from scratch (out-of-order and
missing dependencies), so they were squashed into
`supabase/migrations/20261015120000_production_schema_baseline.sql`, a
schema-only snapshot introspected from production (generator:
`supabase/baseline/introspect_schema.sql`).

Kept for history and for the focused schema tests in `supabase/tests/` and
`backend/test/` that load individual files. Do not add new files here; add new
migrations to `supabase/migrations/` (and mirror to `backend/supabase/migrations/`).
