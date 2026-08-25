#!/usr/bin/env bash
# Write fieldcapture/railway.json onto a Railway service so GitHub Autodeploy
# does not inherit the backend /railway.toml (wrong Dockerfile, 300s
# /api/health probe).
#
#   RAILWAY_TOKEN=… ./fieldcapture/scripts/apply-railway-config.sh
#
# Safe to re-run. Does not deploy.
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/.." && pwd)"
service="${RAILWAY_FIELD_SERVICE:-${RAILWAY_SERVICE:-Field Capture}}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
dockerfile_path="fieldcapture/Dockerfile"
start_command="/usr/local/bin/field-start.sh"
healthcheck_path="/healthz"
healthcheck_timeout="60"
restart_policy="ON_FAILURE"
restart_retries="5"
message="Apply Field Capture config from fieldcapture/railway.json"

case "$service" in
  Atmosphere-field|Atmosphere-Field|field|Field|fieldcapture|FieldCapture)
    service="Field Capture"
    ;;
esac

if resolved="$(node "$repo/backend/scripts/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Applying Field Capture config to service='$service' project='$project' environment='$environment'"

edit() {
  local path="$1"
  local value="$2"
  echo "  $path = $value"
  if ! railway environment edit \
    --project "$project" \
    --environment "$environment" \
    --message "$message" \
    --service-config "$service" "$path" "$value"
  then
    echo "  warn: could not set $path (new service, CLI, or token). railway up still copies railway.toml."
  fi
}

edit build.builder DOCKERFILE
edit build.dockerfilePath "$dockerfile_path"
edit deploy.startCommand "$start_command"
edit deploy.healthcheckPath "$healthcheck_path"
edit deploy.healthcheckTimeout "$healthcheck_timeout"
edit deploy.restartPolicyType "$restart_policy"
edit deploy.restartPolicyMaxRetries "$restart_retries"
edit deploy.preDeployCommand ""

printf '%s' "$dockerfile_path" | railway variable set RAILWAY_DOCKERFILE_PATH \
  --stdin --skip-deploys --service "$service" \
  --project "$project" --environment "$environment" \
  || echo "warn: could not set RAILWAY_DOCKERFILE_PATH"

if ! RAILWAY_SERVICE="$service" node "$repo/backend/scripts/applyRailwayConfigFile.mjs" \
  "$service" "fieldcapture/railway.json"
then
  echo "  warn: could not set the Config File. Set it by hand: Settings → Config-as-code → /fieldcapture/railway.json"
fi

echo "Service $service now uses nginx + GET /healthz (not node dist/index.js / /api/health)."
