#!/bin/sh
# Office-app entrypoint. Railway's startCommand replaces the nginx image
# ENTRYPOINT, and a mis-pointed Config File used to inject `node dist/index.js`.
# This script always binds nginx to $PORT and never starts Node.
set -eu

PORT="${PORT:-80}"
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"

# Railway resolves a missing ${{Service.FIELD}} to empty. The old
# http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}} template
# therefore becomes http://: once the BFF was renamed Atmosphere APIs.
# nginx then dies with `invalid port in upstream ":"` and never answers
# /healthz — that is the 60s Network > Healthcheck failure.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

if ! is_usable_upstream "$API_UPSTREAM"; then
  echo "office-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL; falling back so nginx can bind." >&2
  API_UPSTREAM="https://atmosphere-production.up.railway.app"
fi

export PORT API_UPSTREAM

# Substitute only our knobs. A bare envsubst would empty nginx's $uri / $host
# and the process would listen on nothing Railway probes.
envsubst '${PORT} ${API_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
