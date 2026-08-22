#!/bin/sh
# Office-app entrypoint. Railway's startCommand replaces the nginx image
# ENTRYPOINT, and a leftover Config File used to inject `node dist/index.js`.
# Sanitize API_UPSTREAM, then boot through the image entrypoint so:
#   - ${PORT} / ${API_UPSTREAM} / ${NGINX_RESOLVER} are substituted
#   - IPv6 listen is added when the replica has it
#   - we never start Node
set -eu

PORT="${PORT:-80}"
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"
PUBLIC_UPSTREAM="https://atmosphere-production.up.railway.app"

# Railway resolves a missing ${{Service.FIELD}} to empty. The old
# http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}} template
# becomes http://: once the BFF was renamed Atmosphere APIs. nginx then dies
# with `invalid port in upstream ":"` and never answers /healthz.
is_usable_upstream() {
  echo "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$'
}

# Strip a trailing slash so `proxy_pass $api_upstream` keeps /api on the
# original URI. `http://host:4000/` would otherwise send /auth/login.
API_UPSTREAM="${API_UPSTREAM%/}"

if ! is_usable_upstream "$API_UPSTREAM"; then
  echo "office-start: API_UPSTREAM='$API_UPSTREAM' is not a host:port URL (empty ${{Service}} interpolation becomes http://:); using public BFF so nginx can bind." >&2
  API_UPSTREAM="$PUBLIC_UPSTREAM"
fi

# Variable proxy_pass needs an explicit resolver. Railway private DNS is
# [fd12::10]; Compose is 127.0.0.11. Prefer whatever /etc/resolv.conf has.
NGINX_RESOLVER=""
if [ -r /etc/resolv.conf ]; then
  ns="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf || true)"
  case "$ns" in
    *:*) NGINX_RESOLVER="[$ns]" ;;
    ?*) NGINX_RESOLVER="$ns" ;;
  esac
fi
if [ -z "$NGINX_RESOLVER" ]; then
  if [ -n "${RAILWAY_ENVIRONMENT:-}${RAILWAY_PROJECT_ID:-}" ]; then
    NGINX_RESOLVER="[fd12::10]"
  else
    NGINX_RESOLVER="127.0.0.11"
  fi
fi

export PORT API_UPSTREAM NGINX_RESOLVER
echo "office-start: proxying /api to ${API_UPSTREAM} (resolver ${NGINX_RESOLVER})" >&2

script="$(basename "$0")"
if [ "$#" -eq 0 ] || [ "$(basename "${1:-}")" = "$script" ]; then
  set -- nginx -g 'daemon off;'
fi
exec /docker-entrypoint.sh "$@"
