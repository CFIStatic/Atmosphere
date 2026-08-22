#!/bin/sh
# Sourced by the nginx image entrypoint (do not chmod +x — a subprocess
# cannot export into envsubst). Also sourced by website-start.sh.
#
# Railway resolves a missing ${{Service.FIELD}} to empty. After the BFF was
# renamed Atmosphere APIs, http://${{Atmosphere.…}} became http://: and
# nginx died with `invalid port in upstream ":"` — that is the 5-minute
# Network > Healthcheck failure on Corporate Website. Fall back so /health
# still answers; careers/contact can be pointed at a real host later.
#
# docker-entrypoint.sh runs with `set -e`. Do not `grep` inside a function:
# BusyBox ash exits on grep status 1 even when the function is used as
# `if ! is_usable_upstream` — that killed the replica on http://: and the
# CI smoke failed with "Couldn't connect to server" on :8080.

case "${API_UPSTREAM:-}" in
  http://[A-Za-z0-9._-]*|https://[A-Za-z0-9._-]*)
    ;;
  *)
    echo "website: API_UPSTREAM='${API_UPSTREAM:-}' is not a host:port URL; falling back so nginx can bind." >&2
    API_UPSTREAM="https://atmosphere-production.up.railway.app"
    ;;
esac

export API_UPSTREAM
