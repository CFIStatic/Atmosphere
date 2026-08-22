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
# Do not default to the public https host — that hairpins /api and 502s forms.
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"
PUBLIC_UPSTREAM="https://atmosphere-production.up.railway.app"

# Same crash as Login & Dashboard: a leftover ${{Atmosphere.…}} interpolates
# to http://: and nginx dies with `invalid port in upstream ":"`.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

API_UPSTREAM="${API_UPSTREAM%/}"
if ! is_usable_upstream "$API_UPSTREAM"; then
  echo "website-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL; using public BFF so nginx can bind." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
fi
export API_UPSTREAM

exec /docker-entrypoint.sh nginx -g 'daemon off;'
