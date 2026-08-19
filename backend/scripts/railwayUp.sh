#!/usr/bin/env bash
# Upload backend/ to the Atmosphere Railway service and wait until the
# replica is live. `--ci` exits after ~8 minutes while the Metal builder is
# still queued, which is what produced "Deployment failed to build" with no
# Docker layers. Wait for the full deploy instead, and retry a stuck builder.
set -u

service="${RAILWAY_SERVICE:-Atmosphere}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
max_attempts="${RAILWAY_UP_ATTEMPTS:-4}"
wait_secs="${RAILWAY_UP_TIMEOUT:-900}"

echo "Deploying Railway service=$service project=$project environment=$environment"

railway status --project "$project" --environment "$environment" --service "$service" || true

dump_build_logs() {
  echo "---- railway build logs (latest) ----"
  railway logs --build --latest --lines 300 \
    --project "$project" --environment "$environment" --service "$service" \
    || true
}

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  echo "railway up attempt $attempt/$max_attempts (wait ${wait_secs}s)"
  if timeout "$wait_secs" railway up \
    --service "$service" \
    --project "$project" \
    --environment "$environment" \
    --verbose
  then
    echo "Railway deploy succeeded"
    exit 0
  fi
  status=$?
  echo "railway up exited $status"
  dump_build_logs
  if [ "$attempt" -eq "$max_attempts" ]; then
    exit 1
  fi
  sleep $((attempt * 30))
  attempt=$((attempt + 1))
done

exit 1
