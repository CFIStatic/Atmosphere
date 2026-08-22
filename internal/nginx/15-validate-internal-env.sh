#!/bin/sh
# Runs before 20-envsubst-on-templates.sh in the nginx image.
# Keep this fast: Railway probes /healthz only after nginx binds.
set -eu

log() { echo "internal: $*" >&2; }

if [ -z "${PORT:-}" ]; then
  log "PORT is required (Railway sets this)."
  exit 1
fi

if [ -z "${API_UPSTREAM:-}" ]; then
  log "API_UPSTREAM is required."
  log "set API_UPSTREAM=https://atmosphere-production.up.railway.app"
  exit 1
fi

case "${API_UPSTREAM}" in
  http://127.0.0.1:*|http://localhost:*|http://[::1]:*)
    log "API_UPSTREAM=${API_UPSTREAM} is loopback inside this container."
    log "set API_UPSTREAM=https://atmosphere-production.up.railway.app"
    exit 1
    ;;
  https://atmosphere-production.up.railway.app|https://atmosphere-production.up.railway.app/)
    ;;
  https://*)
    log "API_UPSTREAM must be the Atmosphere APIs public https host or private HTTP, not ${API_UPSTREAM}."
    exit 1
    ;;
  *'${{'*|http://:*)
    API_UPSTREAM="https://atmosphere-production.up.railway.app"
    log "replaced unusable API_UPSTREAM template with ${API_UPSTREAM}"
    ;;
esac

export API_UPSTREAM
log "proxying /api to ${API_UPSTREAM}"
