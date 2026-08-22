#!/bin/sh
# Corporate-site entrypoint. Railway startCommand replaces CMD (and sometimes
# ENTRYPOINT). Always boot through the nginx image entrypoint so:
#   - ${PORT} / ${API_UPSTREAM} are substituted
#   - IPv6 listen is added when the replica has it
#   - we never start `node dist/index.js`
# A previous version called `nginx` directly after a hand-rolled envsubst.
# That skipped the image helpers and Railway's GET /health came back
# "service unavailable" for the whole 60s probe window.
set -eu

export PORT="${PORT:-8080}"
# Local default only. Railway sets the BFF private-mesh URL from api.upstream.
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"

# Same crash as Login & Dashboard: a leftover ${{Atmosphere.…}} interpolates
# to http://: and nginx dies with `invalid port in upstream ":"` at
# default.conf:63 (proxy_pass). /health never answers. Sanitize before the
# image entrypoint runs envsubst.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

if ! is_usable_upstream "$API_UPSTREAM"; then
  echo "website-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL; falling back so nginx can bind." >&2
  API_UPSTREAM="https://atmosphere-production.up.railway.app"
fi

export API_UPSTREAM

exec /docker-entrypoint.sh nginx -g 'daemon off;'
