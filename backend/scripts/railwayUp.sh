#!/usr/bin/env bash
# Upload the current directory to a Railway service and wait until the
# replica is live. `--ci` exits after ~8 minutes while the Metal builder is
# still queued, which is what produced "Deployment failed to build" with no
# Docker layers. Wait for the full deploy instead, and retry a stuck builder.
# RAILWAY_SERVICE selects the target (Atmosphere, Atmosphere-web, website, …).
#
# `railway up --ci` also exits immediately with "Deploys have been paused due
# to an upstream issue" (see https://status.railway.com/incident/VVL3A03V).
# Treat that as retryable instead of failing the GitHub job on the first pause.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
service="${RAILWAY_SERVICE:-Atmosphere APIs}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
max_attempts="${RAILWAY_UP_ATTEMPTS:-8}"
wait_secs="${RAILWAY_UP_TIMEOUT:-900}"

case "$service" in
  Atmosphere) service="Atmosphere APIs" ;;
  Atmosphere-internal) service="Internal Growth Metrics" ;;
  Atmosphere-web) service="Login & Dashboard" ;;
esac

if resolved="$(node "$here/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Deploying Railway service=$service project=$project environment=$environment"

railway status --project "$project" --environment "$environment" || true

dump_build_logs() {
  echo "---- railway build logs (latest) ----"
  railway logs --build --latest --lines 300 \
    --project "$project" --environment "$environment" --service "$service" \
    || true
}

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ] && [ -f "${RAILWAY_UP_STAMP_FILE}" ]; then
    printf '\n# railway-up-retry %s %s\n' "$attempt" "$(date -u +%s)" >> "$RAILWAY_UP_STAMP_FILE"
  fi
  echo "railway up attempt $attempt/$max_attempts (wait ${wait_secs}s)"
  log="$(mktemp)"
  timeout "$wait_secs" railway up \
    --service "$service" \
    --project "$project" \
    --environment "$environment" \
    --verbose >"$log" 2>&1
  status=$?
  cat "$log"
  if grep -qi 'failed with service unavailable' "$log"; then
    echo "railway up reached a failed healthcheck."
    status=1
  fi
  if [ "$status" -eq 0 ]; then
    if grep -qi 'no changes detected in watch paths' "$log"; then
      if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ]; then
        echo "railway up skipped the image build (watch paths). Retrying with a new stamp."
        status=1
      else
        echo "railway up skipped the image build (watch paths); no stamp file, treating as success."
      fi
    fi
  fi
  if [ "$status" -eq 0 ]; then
    rm -f "$log"
    echo "Railway deploy succeeded"
    exit 0
  fi
  echo "railway up exited $status"
  if grep -qi 'paused due to an upstream issue' "$log"; then
    echo "Railway paused deploys (https://status.railway.com/incident/VVL3A03V). Retrying."
    sleep $((attempt * 60))
  else
    dump_build_logs
    sleep $((attempt * 30))
  fi
  rm -f "$log"
  if [ "$attempt" -eq "$max_attempts" ]; then
    exit 1
  fi
  attempt=$((attempt + 1))
done

exit 1
