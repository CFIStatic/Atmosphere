#!/bin/sh
# Office-app entrypoint. Railway's startCommand replaces the nginx image
# ENTRYPOINT, and a mis-pointed Config File used to inject `node dist/index.js`.
# This script always binds nginx to $PORT and never starts Node.
set -eu

PORT="${PORT:-80}"
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"
# Unresolved Railway references (`${{Service.FIELD}}`) or an empty value make
# nginx refuse to start, which is the 60s Network > Healthcheck failure.
# Fall back so /healthz still answers; /api can be pointed later.
case "$API_UPSTREAM" in
  ''|*'$'*) API_UPSTREAM="https://atmosphere-production.up.railway.app" ;;
esac
export PORT API_UPSTREAM

# Substitute only our knobs. A bare envsubst would empty nginx's $uri / $host
# and the process would listen on nothing Railway probes.
envsubst '${PORT} ${API_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
