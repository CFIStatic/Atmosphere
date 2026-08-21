#!/bin/sh
# Runs before 20-envsubst-on-templates.sh in the nginx image.
# Keep this fast: Railway probes /healthz only after nginx binds. Do not DNS
# probe the BFF here — that hung Autodeploy for minutes and failed the replica.
set -eu

log() { echo "internal: $*" >&2; }

if [ -z "${PORT:-}" ]; then
  log "PORT is required (Railway sets this)."
  exit 1
fi

if [ -z "${API_UPSTREAM:-}" ]; then
  log "API_UPSTREAM is required."
  log "set API_UPSTREAM=http://atmosphere-apis.railway.internal:4000"
  exit 1
fi

case "${API_UPSTREAM}" in
  http://127.0.0.1:*|http://localhost:*|http://[::1]:*)
    log "API_UPSTREAM=${API_UPSTREAM} is loopback inside this container."
    log "set API_UPSTREAM=http://atmosphere-apis.railway.internal:4000"
    exit 1
    ;;
  https://*)
    log "API_UPSTREAM must be private HTTP, not ${API_UPSTREAM}."
    log "the public https BFF URL hairpins and 502s /api."
    exit 1
    ;;
esac

# CLI-set ${{ service.PORT }} is a user variable, not Railway's runtime PORT,
# so the injected value can be http://host: or the raw template.
case "${API_UPSTREAM}" in
  *'${{'*|http://:*)
    API_UPSTREAM="http://atmosphere-apis.railway.internal:4000"
    log "replaced unusable API_UPSTREAM template with ${API_UPSTREAM}"
    ;;
esac

if [ -z "${NGINX_RESOLVER:-}" ]; then
  NGINX_RESOLVER="$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)"
fi
if [ -z "${NGINX_RESOLVER:-}" ]; then
  NGINX_RESOLVER="fd12::10"
fi
case "${NGINX_RESOLVER}" in
  \[*\]|[0-9]*.[0-9]*.[0-9]*.[0-9]*) ;;
  *:*) NGINX_RESOLVER="[${NGINX_RESOLVER}]" ;;
esac

export API_UPSTREAM
export NGINX_RESOLVER
log "proxying /api to ${API_UPSTREAM} (resolver ${NGINX_RESOLVER})"
