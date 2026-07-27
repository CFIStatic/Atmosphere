#!/usr/bin/env bash
#
# Runs the Agent Memory migration against a throwaway local Postgres and
# exercises it — the memory triggers, the retention guarantees, and the
# cross-organization isolation.
#
# This is deliberately not run against a Supabase project: the test asserts that
# history cannot be deleted, so it needs a database it is allowed to throw away.
#
# Usage:  supabase/tests/run.sh [connection-args...]
#         supabase/tests/run.sh -h /tmp -p 55432 -U postgres
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="$HERE/../migrations/20260727000000_agent_memory.sql"
DB="${AGENT_MEMORY_TEST_DB:-agent_memory_test}"
PSQL=(psql "$@")

echo "==> Recreating $DB"
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase stand-in (auth.uid, orgs, org_members, profiles)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_local_stub.sql"

echo "==> Migration"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" 2>&1 |
  grep -v 'NOTICE:.*does not exist, skipping' || true

echo "==> Assertions"
"${PSQL[@]}" -d "$DB" -f "$HERE/01_agent_memory_test.sql"

echo
echo "==> Done. Sections 8-12 and 14 are expected to print ERRORs — those are the"
echo "    retention and isolation guarantees refusing the operation."
