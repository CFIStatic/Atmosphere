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
export API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"

# Rewrite http://: / unresolved ${{…}} before envsubst. See
# 15-validate-website-env.sh — that is the Corporate Website healthcheck loop.
if [ -f /docker-entrypoint.d/15-validate-website-env.sh ]; then
  # shellcheck disable=SC1091
  . /docker-entrypoint.d/15-validate-website-env.sh
fi

exec /docker-entrypoint.sh nginx -g 'daemon off;'
