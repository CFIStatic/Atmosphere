#!/usr/bin/env bash
# Create the Field Capture Railway service if it is not on the canvas yet.
# Safe to re-run: resolve-or-add, never a second service.
#
#   RAILWAY_TOKEN=… ./fieldcapture/scripts/ensure-railway-service.sh
set -uo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
service="${RAILWAY_FIELD_SERVICE:-Field Capture}"
project="${RAILWAY_PROJECT_ID:-d0af58bd-0eec-431d-bad3-4da4b4a2e2ae}"
environment="${RAILWAY_ENVIRONMENT:-production}"

case "$service" in
  Atmosphere-field|Atmosphere-Field|field|Field|fieldcapture|FieldCapture)
    service="Field Capture"
    ;;
esac

export RAILWAY_PROJECT_ID="$project"
export RAILWAY_ENVIRONMENT="$environment"

if resolved="$(node "$repo/backend/scripts/resolveRailwayService.mjs" "$service")"; then
  echo "Field Capture already on the canvas: $resolved"
  printf '%s\n' "$resolved"
  exit 0
fi

echo "Creating Railway service '$service' in project $project"
if ! added="$(railway add --service "$service" --project "$project" --environment "$environment" --json)"; then
  echo "warn: railway add failed. Create an empty service named Field Capture on the Atmosphere canvas."
  exit 1
fi
echo "$added"

if resolved="$(node "$repo/backend/scripts/resolveRailwayService.mjs" "$service")"; then
  printf '%s\n' "$resolved"
  exit 0
fi

echo "warn: created '$service' but could not resolve its id"
exit 1
