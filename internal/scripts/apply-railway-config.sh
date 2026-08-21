#!/usr/bin/env bash
# Write internal/railway.json onto a Railway service so GitHub Autodeploy
# does not need the dashboard Config File field (new services cannot set it).
#
#   RAILWAY_TOKEN=… ./internal/scripts/apply-railway-config.sh
#
# Safe to re-run. Does not deploy.
set -uo pipefail

service="${RAILWAY_INTERNAL_SERVICE:-Atmosphere-internal}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
dockerfile_path="internal/Dockerfile"
start_command="/docker-entrypoint.sh nginx -g 'daemon off;'"
healthcheck_path="/healthz"
healthcheck_timeout="120"
restart_policy="ON_FAILURE"
restart_retries="10"
message="Apply Atmosphere-internal config from internal/railway.json"

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

here="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$here/api.upstream" ]; then
  tr -d '\n' < "$here/api.upstream" | railway variable set API_UPSTREAM \
    --stdin --skip-deploys --service "$service" \
    --project "$project" --environment "$environment" \
    || echo "warn: could not set API_UPSTREAM"
fi

echo "Service $service now uses nginx + GET /healthz (not node dist/index.js / /api/health)."
