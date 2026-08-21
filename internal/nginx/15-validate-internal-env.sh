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

# Dockerfile used to default this to loopback, which starts nginx and 502s every
# /api call (the SPA still loads). The public https BFF URL hairpins across
# Railway edges and also 502s. Require the private mesh URL.
case "${API_UPSTREAM}" in
  http://127.0.0.1:*|http://localhost:*|http://[::1]:*)
    echo "internal: API_UPSTREAM=${API_UPSTREAM} is loopback inside this container." >&2
    echo "internal: set API_UPSTREAM=http://\${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:\${{Atmosphere.PORT}}" >&2
    exit 1
    ;;
  https://*)
    echo "internal: API_UPSTREAM must be private HTTP, not ${API_UPSTREAM}." >&2
    echo "internal: the public https BFF URL hairpins and 502s /api." >&2
    echo "internal: set API_UPSTREAM=http://\${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:\${{Atmosphere.PORT}}" >&2
    exit 1
    ;;
esac
