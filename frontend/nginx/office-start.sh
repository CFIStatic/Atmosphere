#!/bin/sh
# Office-app entrypoint. Railway's startCommand replaces the nginx image
# ENTRYPOINT, and a mis-pointed Config File used to inject `node dist/index.js`.
# This script always binds nginx to $PORT and never starts Node.
set -eu

PORT="${PORT:-80}"
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"
PUBLIC_UPSTREAM="https://atmosphere-production.up.railway.app"

# Railway resolves a missing ${{Service.FIELD}} to empty. The old
# http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}} template
# therefore becomes http://: once the BFF was renamed Atmosphere APIs.
# nginx then dies with `invalid port in upstream ":"` and never answers
# /healthz — that is the 60s Network > Healthcheck failure.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

# A syntactically valid private-mesh URL still 504s when the BFF is IPv4-only
# or the mesh is down. Login then shows "Cannot reach the Atmosphere API"
# while the public host is healthy. Probe before nginx binds. Do not do this
# for compose/localhost — those backends start after this container.
is_private_mesh() {
  echo "$1" | grep -Eq 'railway\.internal'
}

upstream_answers() {
  wget -q -T 2 -O /dev/null "$1/api/health" 2>/dev/null
}

if ! is_usable_upstream "$API_UPSTREAM"; then
  echo "office-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL; falling back so nginx can bind." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
elif is_private_mesh "$API_UPSTREAM" && ! upstream_answers "$API_UPSTREAM"; then
  echo "office-start: $API_UPSTREAM did not answer /api/health (private mesh 504); using public BFF." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
fi

export PORT API_UPSTREAM

# Substitute only our knobs. A bare envsubst would empty nginx's $uri / $host
# and the process would listen on nothing Railway probes.
envsubst '${PORT} ${API_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
