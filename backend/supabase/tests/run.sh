#!/usr/bin/env bash
#
# Runs the Agent Memory migration against a throwaway local Postgres and
# exercises it: the capture triggers, the retention guarantees, and the
# cross-organization isolation.
#
# Agent Memory hangs off crm_jobs, so the real CRM migration is applied first —
# the test exercises the actual integration, not a stub of it. Only the pieces
# that live outside this repo (auth.uid, the onboarding tables) are stubbed.
#
# Not run against a Supabase project by design: it asserts that history cannot
# be deleted, so it needs a database it is allowed to throw away.
#
# Usage:  backend/supabase/tests/run.sh -h /tmp -p 5432 -U postgres
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="${AGENT_MEMORY_TEST_DB:-agent_memory_test}"
PSQL=(psql "$@")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

run() {
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1 |
    grep -v 'NOTICE:.*skipping' || true
}

echo "==> Supabase stand-in (auth.uid, orgs, org_members, profiles)"
run "$HERE/00_local_stub.sql"

echo "==> CRM core (the real migration — crm_jobs is what Agent Memory hangs off)"
run "$MIGRATIONS/20260726000001_crm_core.sql"

echo "==> Agent Memory"
run "$MIGRATIONS/20260727000000_agent_memory.sql"

echo "==> Memory capture must never block opening a job"
run "$MIGRATIONS/20260818193000_memory_capture_never_blocks_jobs.sql"

echo "==> Assertions"
"${PSQL[@]}" -d "$DB" -f "$HERE/01_agent_memory_test.sql"

echo
echo "==> Done. Sections 8-11 and 13 are expected to print ERRORs — those are"
echo "    the retention and isolation guarantees refusing the operation."
