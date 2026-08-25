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
  website) service="Corporate Website" ;;
esac

if resolved="$(node "$here/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Deploying Railway service=$service project=$project environment=$environment"

# Official CLI 5.43+ treats $CI=true as --ci (stream build logs, then
# exit). GitHub Actions always sets CI=true, so a bare `railway up`
# returns after the Metal image push and the Railway dashboard often
# never shows a finished replica. This script waits on purpose.
message="${RAILWAY_UP_MESSAGE:-}"
if [ -z "$message" ] && [ -n "${GITHUB_SHA:-}" ]; then
  message="${GITHUB_REF_NAME:-ci} ${GITHUB_SHA:0:7}"
fi
if [ -n "$message" ]; then
  echo "Railway deployment message: $message"
fi

railway status --project "$project" --environment "$environment" || true

dump_build_logs() {
  echo "---- railway build logs (latest) ----"
  railway logs --build --latest --lines 300 \
    --project "$project" --environment "$environment" --service "$service" \
    || true
}

extract_deploy_id() {
  grep -oE 'id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$1" \
    | head -1 | cut -d= -f2
}

wait_for_deployment() {
  local id="$1"
  local deadline=$((SECONDS + wait_secs))
  echo "Waiting for Railway deployment $id"
  echo "https://railway.com/project/${project}/service/${service}?id=${id}"
  while [ "$SECONDS" -lt "$deadline" ]; do
    list="$(railway deployment list \
      --service "$service" \
      --project "$project" \
      --environment "$environment" \
      --limit 10 2>/dev/null || true)"
    echo "$list"
    line="$(printf '%s\n' "$list" | grep -i "$id" || true)"
    case "$line" in
      *SUCCESS*)
        echo "Deployment $id is SUCCESS"
        return 0
        ;;
      *FAILED*|*CRASHED*|*REMOVED*)
        echo "Deployment $id finished unsuccessfully: $line"
        return 1
        ;;
    esac
    sleep 15
  done
  echo "Timed out waiting for deployment $id"
  return 1
}

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  if [ -n "${RAILWAY_UP_STAMP_FILE:-}" ] && [ -f "${RAILWAY_UP_STAMP_FILE}" ]; then
    printf '\n# railway-up-retry %s %s\n' "$attempt" "$(date -u +%s)" >> "$RAILWAY_UP_STAMP_FILE"
  fi
  echo "railway up attempt $attempt/$max_attempts (wait ${wait_secs}s)"
  log="$(mktemp)"
  up_args=(
    up
    --service "$service"
    --project "$project"
    --environment "$environment"
    --verbose
    --no-gitignore
  )
  if [ -n "$message" ]; then
    up_args+=(--message "$message")
  fi
  timeout "$wait_secs" env -u CI railway "${up_args[@]}" >"$log" 2>&1
  status=$?
  cat "$log"
  # Railway logs "Attempt #N failed with service unavailable. Continuing to
  # retry" while the probe window is still open. That is normal startup, not
  # a finished failure — treating it as fatal aborted healthy website deploys
  # and the next attempt then hit "no changes in watch paths" and was marked
  # success. Only a completed failed deploy is fatal.
  if grep -qiE 'Deployment failed|Healthcheck failed|healthcheck failure' "$log"; then
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
    deploy_id="$(extract_deploy_id "$log")"
    rm -f "$log"
    if [ -z "$deploy_id" ]; then
      echo "railway up returned without a deployment id"
      status=1
    elif ! wait_for_deployment "$deploy_id"; then
      status=1
    fi
  fi
  if [ "$status" -eq 0 ]; then
    echo "---- railway deployment list (latest 5) ----"
    railway deployment list \
      --service "$service" \
      --project "$project" \
      --environment "$environment" \
      --limit 5 || true
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
