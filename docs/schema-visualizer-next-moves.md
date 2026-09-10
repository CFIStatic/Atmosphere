# Schema visualizer — next moves (gated)

**Shipped:** `20260910180000_schema_visualizer_move_dead_to_archive.sql` records
the 14 dead/legacy tables already moved live to `archive` on project
`ccxatzfsvzetciiwsjlj` (idempotent `ALTER TABLE IF EXISTS … SET SCHEMA archive`).

## Do not move yet

These clusters stay in `public` until code + views + PostgREST exposure are
ready. Prefer Dashboard **Settings → API → Exposed schemas** (add `pm`,
`portal`, `research`) or Management API before any move; PostgREST only
exposes `public` by default, so `.schema('pm').from(...)` alone is not enough.

| Cluster | Target schema | Blockers |
| --- | --- | --- |
| `credit_*`, `experiments*`, `agent_runs*` | `archive` | SQL functions: `charge_feature_credits`, `assign_experiment`, `track_experiment_event`, `agent_audit_*`, etc. |
| `dataset_*`, `work_ontology_*` | `archive` (or `research`) | `backend/src/verification` still `.from()` them; need schema-qualified clients + exposed schemas |
| `pm_*` | `pm` | View `public.crm_job_delivery` depends on `pm_projects`; `backend/src/pm/**` and fieldApp still query |
| `homeowner_portal_*` | `portal` | `backend/src/portal/store.ts`; FK to `pm_projects` |
| `crew_locations`, `crew_location_consent`, `property_twins`, `geometry_capture_sessions`, `zip_centroids` | `research` | View `public.crew_live_positions`; `geometry/persist.ts` |

## Safe follow-up checklist (next PR)

1. Recreate `public.crm_job_delivery` and `public.crew_live_positions` with
   schema-qualified underlying tables (`pm.pm_projects`, `research.crew_locations`, …).
2. Move `pm_*` → `pm`, `homeowner_portal_*` → `portal`, crew/geometry/twins/zip → `research`.
3. Update backend TypeScript to `.schema('pm'|'portal'|'research').from(...)`.
4. Expose `pm` / `portal` / `research` in PostgREST (Dashboard or Management API).
5. Do **not** DROP tables; do **not** move pipeline/core/support.

Atmosphere = product; Work Verification = activity; Jettx LLC = holding only.
