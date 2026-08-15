#!/usr/bin/env bash
# Serve the iOS Field Capture browser preview on :5175.
#
# This is a phone-framed host of apps/field-ios/ — not the App Store binary.
# The live crew web app remains /fieldcapture/ on the Vite app (:5174).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ATMOSPHERE_IOS_PORT:-5175}"
DIR="${ROOT}/apps/field-ios/preview"

if [[ ! -d "$DIR" ]]; then
  echo "iOS preview is missing at ${DIR}" >&2
  exit 1
fi

cd "$DIR"
echo "iOS Field Capture preview  http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
