#!/usr/bin/env bash
#
# Runs the Project Manager Agent migrations against a throwaway local Postgres
# and exercises what the schema promises: cross-organization isolation, the
# role split between planning and reporting, the append-only moisture log, the
# alert de-duplication the automation engine depends on, and the orchestration
# tables (platforms, messaging, procurement, approvals).
#
# Deliberately not run against a Supabase project — the test asserts that data
# cannot be deleted, so it needs a database it is allowed to throw away.
#
# Usage:  supabase/tests/run.sh [psql-connection-args...]
#         supabase/tests/run.sh -h /var/run/postgresql -U postgres
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_PM="$HERE/../migrations/20260727181539_project_manager_agent.sql"
MIGRATION_ORCH="$HERE/../migrations/20260728142600_pm_orchestration.sql"
DB="${PM_AGENT_TEST_DB:-pm_agent_test}"
PSQL=(psql "$@")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in (auth.uid, orgs, org_members, profiles)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_local_stub.sql" 2>&1 |
  grep -vE 'NOTICE:.*(does not exist, skipping|already exists|skipping)' || true

echo "==> Migration (Project Manager Agent)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION_PM" 2>&1 |
  grep -vE 'NOTICE:.*(does not exist, skipping|already exists, skipping)' || true

echo "==> Migration (PM orchestration)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION_ORCH" 2>&1 |
  grep -vE 'NOTICE:.*(does not exist, skipping|already exists, skipping)' || true

echo "==> Assertions (core PM)"
"${PSQL[@]}" -d "$DB" -f "$HERE/01_project_manager_test.sql"

echo "==> Assertions (orchestration)"
"${PSQL[@]}" -d "$DB" -f "$HERE/02_pm_orchestration_test.sql"

echo
echo "==> Done. Core PM sections that say 'expect ERROR' are the guarantees"
echo "    refusing the operation. Orchestration section 3 (event update) and 4"
echo "    (delete) are the same — an ERROR there is the pass."
