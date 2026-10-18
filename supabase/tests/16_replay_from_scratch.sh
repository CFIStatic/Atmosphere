#!/usr/bin/env bash
#
# Builds a database from nothing using only supabase/migrations (the squashed
# production baseline plus every migration after it), on a throwaway Postgres
# with a minimal Supabase stand-in. Fails on the first error.
#
# Usage:  supabase/tests/16_replay_from_scratch.sh [psql-connection-args...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${REPLAY_TEST_DB:-replay_from_scratch_test}"
PSQL=(psql "$@")

# The baseline needs pgvector (Supabase ships it). A server without it cannot
# replay the schema at all; say so loudly instead of failing on an unrelated
# image limitation. CI installs it (see .github/workflows/ci.yml).
if [ "$("${PSQL[@]}" -tA -d postgres -c "select count(*) from pg_available_extensions where name = 'vector'")" = "0" ]; then
  if [ "${REQUIRE_REPLAY:-0}" = "1" ]; then
    echo "::error::Replay from scratch cannot run: pgvector is not installed, and REQUIRE_REPLAY=1 forbids skipping."
    exit 1
  fi
  echo "::warning::SKIPPED replay from scratch: pgvector is not installed on this Postgres server."
  exit 0
fi

"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_supabase_bootstrap_stub.sql"

count=0
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for f in "$HERE"/../migrations/*.sql; do
  echo "==> $(basename "$f")"
  if ! "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >"$log" 2>&1; then
    grep -v 'NOTICE:' "$log" >&2 || true
    echo "FAIL: $(basename "$f") did not apply" >&2
    exit 1
  fi
  count=$((count + 1))
done

tables=$("${PSQL[@]}" -tA -d "$DB" -c \
  "select count(*) from pg_tables where schemaname in ('public','private','memory')")
echo "==> Replayed $count migration(s); $tables tables."
if [ "$tables" -lt 150 ]; then
  echo "FAIL: expected at least 150 tables after replay" >&2
  exit 1
fi
"${PSQL[@]}" -q -d postgres -c "drop database if exists $DB;"
echo "==> Replay from scratch OK"
