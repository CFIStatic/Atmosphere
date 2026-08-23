#!/usr/bin/env bash
# Write internal/railway.json onto a Railway service so GitHub Autodeploy
# does not need the dashboard Config File field (new services cannot set it).
#
#   RAILWAY_TOKEN=… ./internal/scripts/apply-railway-config.sh
#
# Safe to re-run. Does not deploy.
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/.." && pwd)"
service="${RAILWAY_INTERNAL_SERVICE:-${RAILWAY_SERVICE:-Internal Growth Metrics}}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
dockerfile_path="internal/Dockerfile"
start_command="/docker-entrypoint.sh nginx -g 'daemon off;'"
healthcheck_path="/healthz"
healthcheck_timeout="120"
restart_policy="ON_FAILURE"
restart_retries="10"
message="Apply Internal Growth Metrics config from internal/railway.json"

case "$service" in
  Atmosphere-internal|Atmosphere-Internal) service="Internal Growth Metrics" ;;
esac

if resolved="$(node "$repo/backend/scripts/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Applying internal site config to service='$service' project='$project' environment='$environment'"

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

printf '%s' "$dockerfile_path" | railway variable set RAILWAY_DOCKERFILE_PATH \
  --stdin --skip-deploys --service "$service" \
  --project "$project" --environment "$environment" \
  || echo "warn: could not set RAILWAY_DOCKERFILE_PATH"

if [ -f "$here/api.upstream" ]; then
  tr -d '\n' < "$here/api.upstream" | railway variable set API_UPSTREAM \
    --stdin --skip-deploys --service "$service" \
    --project "$project" --environment "$environment" \
    || echo "warn: could not set API_UPSTREAM"
fi

# Config-as-code outranks every stamp above, so a service whose Config File
# was never set still reads the repo-root /railway.toml and still builds the
# backend image. This is the one setting `railway environment edit` cannot
# reach. See docs/production.md.
if ! RAILWAY_SERVICE="$service" node "$repo/backend/scripts/applyRailwayConfigFile.mjs" \
  "$service" "internal/railway.json"
then
  echo "  warn: could not set the Config File. Set it by hand: Settings → Config-as-code → /internal/railway.json"
fi

echo "Service $service now uses nginx + GET /healthz (not node dist/index.js / /api/health)."
