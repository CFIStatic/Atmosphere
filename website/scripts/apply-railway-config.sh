#!/usr/bin/env bash
# Write website/railway.json onto the Corporate Website service so GitHub
# Autodeploy does not inherit the backend /railway.toml (wrong Dockerfile,
# 300s /api/health probe). That is the "Deployment failed during network
# process → Healthcheck failure" after ~5 minutes on commits that never
# touched website/.
#
#   RAILWAY_TOKEN=… ./website/scripts/apply-railway-config.sh
#
# Safe to re-run. Does not deploy.
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/.." && pwd)"
service="${RAILWAY_WEBSITE_SERVICE:-${RAILWAY_SERVICE:-Corporate Website}}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"
dockerfile_path="website/Dockerfile"
start_command="/usr/local/bin/website-start.sh"
healthcheck_path="/health"
healthcheck_timeout="120"
restart_policy="ON_FAILURE"
restart_retries="5"
message="Apply Corporate Website config from website/railway.json"

case "$service" in
  website|Website|Atmosphere-website) service="Corporate Website" ;;
esac

if resolved="$(node "$repo/backend/scripts/resolveRailwayService.mjs" "$service")"; then
  echo "Resolved Railway service '$service' to $resolved"
  service="$resolved"
fi

echo "Applying website config to service='$service' project='$project' environment='$environment'"

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

echo "Service $service now uses nginx + GET /health (not node dist/index.js / 300s /api/health)."
