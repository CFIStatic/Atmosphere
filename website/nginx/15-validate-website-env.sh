#!/bin/sh
# Sourced by the nginx image entrypoint (do not chmod +x — a subprocess
# cannot export into envsubst). Also sourced by website-start.sh.
#
# Railway resolves a missing ${{Service.FIELD}} to empty. After the BFF was
# renamed Atmosphere APIs, http://${{Atmosphere.…}} became http://: and
# nginx died with `invalid port in upstream ":"` — that is the 5-minute
# Network > Healthcheck failure on Corporate Website. Fall back so /health
# still answers; careers/contact can be pointed at a real host later.
#
# Do not `set -e` here. docker-entrypoint.sh sources this into its own shell.

is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

if [ -z "${API_UPSTREAM:-}" ] || ! is_usable_upstream "$API_UPSTREAM"; then
  echo "website: API_UPSTREAM='${API_UPSTREAM:-}' is not a host:port URL; falling back so nginx can bind." >&2
  API_UPSTREAM="https://atmosphere-production.up.railway.app"
fi

export API_UPSTREAM
