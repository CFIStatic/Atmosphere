#!/bin/sh
# Corporate-site entrypoint. Railway's startCommand replaces the nginx image
# ENTRYPOINT, and a mis-pointed Config File used to inject `node dist/index.js`.
# This script always binds nginx to $PORT and never starts Node.
set -eu

PORT="${PORT:-8080}"
API_UPSTREAM="${API_UPSTREAM:-https://atmosphere-production.up.railway.app}"
export PORT API_UPSTREAM

# Substitute only our knobs. A bare envsubst would empty nginx's $uri / $host
# / $http_upgrade and the process would listen on nothing Railway probes.
envsubst '${PORT} ${API_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
