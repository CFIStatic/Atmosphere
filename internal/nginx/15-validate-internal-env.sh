#!/bin/sh
# Runs before 20-envsubst-on-templates.sh in the nginx image.
# Fail immediately with a readable log instead of hanging on Railway's probe.
set -eu

if [ -z "${PORT:-}" ]; then
  echo "internal: PORT is required (Railway sets this)." >&2
  exit 1
fi

if [ -z "${API_UPSTREAM:-}" ]; then
  echo "internal: API_UPSTREAM is required." >&2
  echo "internal: set API_UPSTREAM=http://\${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:\${{Atmosphere.PORT}}" >&2
  exit 1
fi
