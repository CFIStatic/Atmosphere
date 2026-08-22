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
PUBLIC_UPSTREAM="https://atmosphere-production.up.railway.app"

# Same crash as Login & Dashboard: a leftover ${{Atmosphere.…}} interpolates
# to http://: and nginx dies with `invalid port in upstream ":"` at
# default.conf:63 (proxy_pass). /health never answers. Sanitize before the
# image entrypoint runs envsubst.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

is_private_mesh() {
  echo "$1" | grep -Eq 'railway\.internal'
}

upstream_answers() {
  wget -q -T 2 -O /dev/null "$1/api/health" 2>/dev/null
}

if [ -n "${RAILWAY_ENVIRONMENT:-}${RAILWAY_PROJECT_ID:-}" ]; then
  echo "website-start: Railway replica — using public BFF (private mesh 504s from this nginx)." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
elif ! is_usable_upstream "$API_UPSTREAM"; then
  echo "website-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL; falling back so nginx can bind." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
elif is_private_mesh "$API_UPSTREAM" && ! upstream_answers "$API_UPSTREAM"; then
  echo "website-start: $API_UPSTREAM did not answer /api/health (private mesh 504); using public BFF." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
fi

export API_UPSTREAM

exec /docker-entrypoint.sh nginx -g 'daemon off;'
