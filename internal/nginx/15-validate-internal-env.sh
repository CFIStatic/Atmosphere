#!/bin/sh
# Runs before 20-envsubst-on-templates.sh in the nginx image.
# Fail immediately with a readable log instead of hanging on Railway's probe.
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

# Dockerfile used to default this to loopback, which starts nginx and 502s every
# /api call (the SPA still loads). The public https BFF URL hairpins across
# Railway edges and also 502s. Require the private mesh URL.
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

# ${{ service.PORT }} is a user variable, not Railway's runtime PORT, so CLI-set
# templates often become http://host: with an empty port. Uninterpolated
# ${{ ... }} strings also get injected as-is. Probe private DNS names the BFF
# actually listens on (runtime mesh, not build).
probe() {
  wget -qO- -T 3 "$1/api/health" >/dev/null 2>&1
}

usable() {
  case "$1" in
    ''|*'${{'*|http://:*|http://:*) return 1 ;;
  esac
  return 0
}

pick=""
for candidate in \
  "$API_UPSTREAM" \
  "http://atmosphere-apis.railway.internal:4000" \
  "http://atmosphere.railway.internal:4000" \
  "http://atmosphere-apis.railway.internal:8080" \
  "http://atmosphere.railway.internal:8080"
do
  usable "$candidate" || continue
  log "probing $candidate"
  if probe "$candidate"; then
    pick="$candidate"
    log "BFF reachable at $candidate"
    break
  fi
done

if [ -n "$pick" ]; then
  API_UPSTREAM="$pick"
else
  log "no private upstream answered /api/health (mesh DNS, port, or IPv6)."
  if ! usable "$API_UPSTREAM"; then
    API_UPSTREAM="http://atmosphere-apis.railway.internal:4000"
    log "replaced unusable template with $API_UPSTREAM"
  fi
fi

# nginx proxy_pass with a hostname can miss IPv6-only Railway mesh records.
# Prefer a literal address so envsubst bakes an IP into default.conf.
hostport="${API_UPSTREAM#http://}"
host="${hostport%:*}"
port="${hostport##*:}"
case "$host" in
  \[*\]|*[0-9].[0-9]*)
    ;;
  *)
    ip=""
    if command -v getent >/dev/null 2>&1; then
      ip="$(getent hosts "$host" 2>/dev/null | awk '{ print $1; exit }' || true)"
    fi
    if [ -n "${ip:-}" ]; then
      case "$ip" in
        *:*) API_UPSTREAM="http://[${ip}]:${port}" ;;
        *) API_UPSTREAM="http://${ip}:${port}" ;;
      esac
      log "resolved $host to $API_UPSTREAM"
    fi
    ;;
esac

export API_UPSTREAM
log "proxying /api to ${API_UPSTREAM}"
