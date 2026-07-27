#!/usr/bin/env bash
#
# Runs the Project Manager Agent migration against a throwaway local Postgres
# and exercises what the schema promises: cross-organization isolation, the
# role split between planning and reporting, the append-only moisture log, and
# the alert de-duplication the automation engine depends on.
#
# Deliberately not run against a Supabase project — the test asserts that data
# cannot be deleted, so it needs a database it is allowed to throw away.
#
# Usage:  supabase/tests/run.sh [psql-connection-args...]
#         supabase/tests/run.sh -h /var/run/postgresql -U postgres
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="$HERE/../migrations/20260727150000_project_manager_agent.sql"
DB="${PM_AGENT_TEST_DB:-pm_agent_test}"
PSQL=(psql "$@")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in (auth.uid, orgs, org_members, profiles)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_local_stub.sql" 2>&1 |
  grep -vE 'NOTICE:.*(does not exist, skipping|already exists, skipping)' || true

echo "==> Migration"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" 2>&1 |
  grep -vE 'NOTICE:.*(does not exist, skipping|already exists, skipping)' || true

echo "==> Assertions"
"${PSQL[@]}" -d "$DB" -f "$HERE/01_project_manager_test.sql"

echo
echo "==> Done. Sections 2, 4, 5, 6, 8-14 (13b included), 16 and 17 are expected"
echo "    to print ERRORs — those are the guarantees refusing the operation. Each"
echo "    section heading says which outcome is the pass."
